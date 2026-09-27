const { Pool } = require('pg');
const { DEFAULT_RANK, RANK_NAMES } = require('../ranks');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

// O Neon encerra conexões ociosas quando o banco hiberna. Sem este handler o
// processo inteiro cai; com ele o pg descarta a conexão e abre outra na próxima query.
pool.on('error', (err) => {
  console.error('Conexão com o banco encerrada:', err.message);
});

const RANK_LIST_SQL = RANK_NAMES.map((n) => `'${n}'`).join(', ');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS seasons (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  discord_id TEXT PRIMARY KEY,
  nick TEXT NOT NULL,
  nome TEXT NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('BR', 'PT')),
  telefone TEXT,
  patente TEXT NOT NULL DEFAULT '${DEFAULT_RANK}' CHECK (patente IN (${RANK_LIST_SQL})),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE members ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE members ADD COLUMN IF NOT EXISTS nome TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN IF NOT EXISTS patente TEXT NOT NULL DEFAULT '${DEFAULT_RANK}' CHECK (patente IN (${RANK_LIST_SQL}));

CREATE TABLE IF NOT EXISTS weekly_points (
  id SERIAL PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(discord_id) ON DELETE CASCADE,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  points INTEGER NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 600),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  UNIQUE (member_id, season_id, week_number)
);

CREATE TABLE IF NOT EXISTS season_completions (
  member_id TEXT NOT NULL REFERENCES members(discord_id) ON DELETE CASCADE,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, season_id)
);
`;

async function init() {
  await pool.query(SCHEMA);
}

const SEASON_TOTAL_MAX = 2400;
const WEEK_MAX = 600;
const WEEKS_PER_SEASON = 4;

async function getActiveSeason() {
  const { rows } = await pool.query(
    'SELECT * FROM seasons WHERE active = true ORDER BY start_date DESC LIMIT 1'
  );
  return rows[0] || null;
}

async function createSeason(name, startDate) {
  await pool.query('UPDATE seasons SET active = false WHERE active = true');
  const { rows } = await pool.query(
    'INSERT INTO seasons (name, start_date, active) VALUES ($1, $2, true) RETURNING *',
    [name, startDate]
  );
  return rows[0];
}

function currentWeekNumber(season) {
  if (!season) return 1;
  const start = new Date(season.start_date);
  const now = new Date();
  const diffDays = Math.floor((now - start) / (1000 * 60 * 60 * 24));
  const week = Math.floor(diffDays / 7) + 1;
  return Math.min(Math.max(week, 1), WEEKS_PER_SEASON);
}

// Se o membro já existir (ex: dois envios seguidos do formulário), atualiza os dados
// em vez de falhar. `inserted` diz se o registro foi realmente criado agora.
async function createMember(discordId, { nick, nome, origem, telefone }) {
  const { rows } = await pool.query(
    `INSERT INTO members (discord_id, nick, nome, origem, telefone)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (discord_id) DO UPDATE
       SET nick = EXCLUDED.nick, nome = EXCLUDED.nome, origem = EXCLUDED.origem,
           telefone = EXCLUDED.telefone, active = true, updated_at = now()
     RETURNING *, (xmax = 0) AS inserted`,
    [discordId, nick, nome, origem, telefone || null]
  );
  return rows[0];
}

async function updateMember(discordId, fields) {
  const columns = Object.keys(fields);
  if (columns.length === 0) return getMember(discordId);

  const setClause = columns.map((col, i) => `${col} = $${i + 2}`).join(', ');
  const { rows } = await pool.query(
    `UPDATE members SET ${setClause}, updated_at = now()
     WHERE discord_id = $1
     RETURNING *`,
    [discordId, ...columns.map((col) => fields[col])]
  );
  return rows[0] || null;
}

async function getMember(discordId) {
  const { rows } = await pool.query('SELECT * FROM members WHERE discord_id = $1', [discordId]);
  return rows[0] || null;
}

async function listMembers() {
  const { rows } = await pool.query('SELECT * FROM members ORDER BY nick ASC');
  return rows;
}

async function getSeasonTotal(memberId, seasonId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(SUM(points), 0) AS total FROM weekly_points WHERE member_id = $1 AND season_id = $2',
    [memberId, seasonId]
  );
  return Number(rows[0].total);
}

async function getSeasonTotals(seasonId) {
  const { rows } = await pool.query(
    'SELECT member_id, SUM(points) AS total FROM weekly_points WHERE season_id = $1 GROUP BY member_id',
    [seasonId]
  );
  return new Map(rows.map((r) => [r.member_id, Number(r.total)]));
}

async function getWeeklyPoints(memberId, seasonId) {
  const { rows } = await pool.query(
    'SELECT week_number, points FROM weekly_points WHERE member_id = $1 AND season_id = $2 ORDER BY week_number ASC',
    [memberId, seasonId]
  );
  return rows;
}

// Salva os pontos e atualiza a conclusão da temporada numa única transação. O lock
// na linha do membro faz dois envios simultâneos para o mesmo membro rodarem em fila.
async function setWeeklyPoints(memberId, seasonId, weekNumber, points, updatedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT 1 FROM members WHERE discord_id = $1 FOR UPDATE', [memberId]);

    const { rows } = await client.query(
      `INSERT INTO weekly_points (member_id, season_id, week_number, points, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (member_id, season_id, week_number)
       DO UPDATE SET points = $4, updated_by = $5, updated_at = now()
       RETURNING *`,
      [memberId, seasonId, weekNumber, points, updatedBy]
    );

    const totalResult = await client.query(
      'SELECT COALESCE(SUM(points), 0) AS total FROM weekly_points WHERE member_id = $1 AND season_id = $2',
      [memberId, seasonId]
    );
    if (Number(totalResult.rows[0].total) >= SEASON_TOTAL_MAX) {
      await client.query(
        `INSERT INTO season_completions (member_id, season_id)
         VALUES ($1, $2)
         ON CONFLICT (member_id, season_id) DO NOTHING`,
        [memberId, seasonId]
      );
    } else {
      await client.query('DELETE FROM season_completions WHERE member_id = $1 AND season_id = $2', [
        memberId,
        seasonId,
      ]);
    }

    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function deleteMember(discordId) {
  const { rows } = await pool.query('DELETE FROM members WHERE discord_id = $1 RETURNING *', [
    discordId,
  ]);
  return rows[0] || null;
}

// Uma query mínima a cada X minutos impede o Neon de hibernar (ver README).
function startKeepAlive(minutes) {
  const timer = setInterval(
    () => {
      pool
        .query('SELECT 1')
        .catch((err) => console.error('Keep-alive do banco falhou:', err.message));
    },
    minutes * 60 * 1000
  );
  timer.unref();
  return timer;
}

async function getRanking(seasonId) {
  const { rows } = await pool.query(
    `SELECT m.discord_id, m.nick, m.origem,
            COALESCE(SUM(wp.points), 0) AS total,
            sc.completed_at
     FROM members m
     LEFT JOIN weekly_points wp ON wp.member_id = m.discord_id AND wp.season_id = $1
     LEFT JOIN season_completions sc ON sc.member_id = m.discord_id AND sc.season_id = $1
     WHERE m.active = true
     GROUP BY m.discord_id, m.nick, m.origem, sc.completed_at
     ORDER BY (sc.completed_at IS NULL) ASC, sc.completed_at ASC, total DESC`,
    [seasonId]
  );
  return rows;
}

module.exports = {
  pool,
  init,
  getActiveSeason,
  createSeason,
  currentWeekNumber,
  createMember,
  updateMember,
  getMember,
  listMembers,
  getSeasonTotal,
  getSeasonTotals,
  getWeeklyPoints,
  setWeeklyPoints,
  deleteMember,
  startKeepAlive,
  getRanking,
  SEASON_TOTAL_MAX,
  WEEK_MAX,
  WEEKS_PER_SEASON,
};
