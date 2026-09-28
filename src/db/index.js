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

const SEASON_TOTAL_MAX = 2400;
const WEEK_MAX = 600;
const WEEKS_PER_SEASON = 4;
// Limite de contas ativas na guilda do jogo.
const GUILD_MAX = 140;

const REGISTRATION_MODES = ['aberto', 'aprovacao'];
const DEFAULT_REGISTRATION_MODE = 'aberto';

// IDs dos advisory locks do Postgres: um para a migração, outro para toda operação
// que cria ou ativa contas (garante o limite de 140 e nicks únicos mesmo com
// registros simultâneos).
const MIGRATION_LOCK = 814000;
const ACCOUNTS_LOCK = 814001;

// Uma pessoa (members) pode ter várias contas do jogo (accounts): a principal e smurfs.
// Pontos e status (ativo / lista de espera / inativo) são por conta; nome, origem,
// telefone e patente são da pessoa. As tabelas antigas weekly_points e
// season_completions ficam intactas (não são mais usadas) para permitir voltar atrás.
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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(discord_id) ON DELETE CASCADE,
  nick TEXT NOT NULL,
  is_main BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL CHECK (status IN ('ativo', 'espera', 'inativo')),
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS accounts_member_idx ON accounts (member_id);
CREATE INDEX IF NOT EXISTS accounts_nick_idx ON accounts (lower(nick));

CREATE TABLE IF NOT EXISTS account_points (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  points INTEGER NOT NULL DEFAULT 0 CHECK (points BETWEEN 0 AND 600),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT,
  PRIMARY KEY (account_id, season_id, week_number)
);

CREATE TABLE IF NOT EXISTS account_completions (
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, season_id)
);
`;

// Cada membro antigo vira uma pessoa com uma conta principal, e os pontos dele
// passam para essa conta.
const MIGRATE_TO_ACCOUNTS = `
INSERT INTO accounts (member_id, nick, is_main, status, status_changed_at, created_at)
SELECT m.discord_id, m.nick, true, CASE WHEN m.active THEN 'ativo' ELSE 'inativo' END,
       m.updated_at, m.created_at
FROM members m
WHERE NOT EXISTS (SELECT 1 FROM accounts a WHERE a.member_id = m.discord_id);

INSERT INTO account_points (account_id, season_id, week_number, points, updated_at, updated_by)
SELECT a.id, wp.season_id, wp.week_number, wp.points, wp.updated_at, wp.updated_by
FROM weekly_points wp
JOIN accounts a ON a.member_id = wp.member_id AND a.is_main
ON CONFLICT DO NOTHING;

INSERT INTO account_completions (account_id, season_id, completed_at)
SELECT a.id, sc.season_id, sc.completed_at
FROM season_completions sc
JOIN accounts a ON a.member_id = sc.member_id AND a.is_main
ON CONFLICT DO NOTHING;
`;

// Violação de uma regra da guilda (nick em uso, guilda cheia, ...). `code` diz qual.
class RuleError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    Object.assign(this, details);
  }
}

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function lockAccounts(client) {
  return client.query('SELECT pg_advisory_xact_lock($1)', [ACCOUNTS_LOCK]);
}

async function init() {
  await pool.query(SCHEMA);
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    const version = Number(await getSetting('schema_version', '1', client));
    if (version < 2) {
      await client.query(MIGRATE_TO_ACCOUNTS);
      await setSetting('schema_version', '2', client);
      console.log('Banco migrado para contas (principal + smurfs).');
    }
  });
}

async function getSetting(key, fallback = null, client = pool) {
  const { rows } = await client.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : fallback;
}

async function setSetting(key, value, client = pool) {
  await client.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, String(value)]
  );
}

function getRegistrationMode(client = pool) {
  return getSetting('registration_mode', DEFAULT_REGISTRATION_MODE, client);
}

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

// --- Pessoas ---------------------------------------------------------------

async function getMember(discordId) {
  const { rows } = await pool.query('SELECT * FROM members WHERE discord_id = $1', [discordId]);
  return rows[0] || null;
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

async function assertNickFree(client, nick, exceptAccountId = null) {
  const { rows } = await client.query(
    'SELECT member_id FROM accounts WHERE lower(nick) = lower($1) AND ($2::int IS NULL OR id <> $2)',
    [nick, exceptAccountId]
  );
  if (rows[0]) throw new RuleError('nick_taken', { nick, ownerId: rows[0].member_id });
}

async function countActive(client = pool) {
  const { rows } = await client.query("SELECT count(*) AS n FROM accounts WHERE status = 'ativo'");
  return Number(rows[0].n);
}

// Com o registro aberto (ou feito por um oficial, `approved`) e vaga livre a conta entra
// ativa; senão vai para a lista de espera.
async function statusForNewAccount(client, approved) {
  if (!approved && (await getRegistrationMode(client)) !== 'aberto') return 'espera';
  return (await countActive(client)) < GUILD_MAX ? 'ativo' : 'espera';
}

async function insertAccount(client, discordId, nick, isMain, approved) {
  const status = await statusForNewAccount(client, approved);
  const { rows } = await client.query(
    `INSERT INTO accounts (member_id, nick, is_main, status)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [discordId, nick, isMain, status]
  );
  return rows[0];
}

// Primeiro registro: cria a pessoa e as contas (a primeira é a principal).
// Retorna null se a pessoa já existir (ex: formulário enviado duas vezes).
// `approved`: registro feito por oficial, não passa pela aprovação.
async function registerMember(discordId, { nome, origem, telefone }, nicks, { approved } = {}) {
  return transaction(async (client) => {
    await lockAccounts(client);
    const existing = await client.query('SELECT 1 FROM members WHERE discord_id = $1', [discordId]);
    if (existing.rows[0]) return null;

    for (const nick of nicks) await assertNickFree(client, nick);

    const { rows } = await client.query(
      `INSERT INTO members (discord_id, nick, nome, origem, telefone)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [discordId, nicks[0], nome, origem, telefone || null]
    );
    const accounts = [];
    for (const [i, nick] of nicks.entries()) {
      accounts.push(await insertAccount(client, discordId, nick, i === 0, approved));
    }
    return { member: rows[0], accounts };
  });
}

async function deleteMember(discordId) {
  const { rows } = await pool.query('DELETE FROM members WHERE discord_id = $1 RETURNING *', [
    discordId,
  ]);
  return rows[0] || null;
}

// --- Contas ----------------------------------------------------------------

const ACCOUNT_WITH_MEMBER = `
  SELECT a.*, m.nome, m.origem, m.telefone, m.patente
  FROM accounts a JOIN members m ON m.discord_id = a.member_id`;

async function getAccounts(discordId) {
  const { rows } = await pool.query(
    'SELECT * FROM accounts WHERE member_id = $1 ORDER BY is_main DESC, created_at, id',
    [discordId]
  );
  return rows;
}

async function getAccount(accountId) {
  const { rows } = await pool.query(`${ACCOUNT_WITH_MEMBER} WHERE a.id = $1`, [accountId]);
  return rows[0] || null;
}

async function findAccountByNick(nick) {
  const { rows } = await pool.query(`${ACCOUNT_WITH_MEMBER} WHERE lower(a.nick) = lower($1)`, [
    nick,
  ]);
  return rows[0] || null;
}

// Conta nova para uma pessoa já registrada. Se o nick for de uma conta inativa dela,
// a conta volta (ativa ou na lista de espera, com o histórico de pontos mantido).
async function addAccount(discordId, nick, { approved } = {}) {
  return transaction(async (client) => {
    await lockAccounts(client);
    const own = await client.query(
      'SELECT * FROM accounts WHERE member_id = $1 AND lower(nick) = lower($2)',
      [discordId, nick]
    );
    if (own.rows[0]) {
      if (own.rows[0].status !== 'inativo') throw new RuleError('already_yours', { nick });
      const status = await statusForNewAccount(client, approved);
      const { rows } = await client.query(
        `UPDATE accounts SET status = $2, status_changed_at = now() WHERE id = $1 RETURNING *`,
        [own.rows[0].id, status]
      );
      return { account: rows[0], reactivated: true };
    }

    await assertNickFree(client, nick);
    const count = await client.query('SELECT count(*) AS n FROM accounts WHERE member_id = $1', [
      discordId,
    ]);
    const account = await insertAccount(
      client,
      discordId,
      nick,
      Number(count.rows[0].n) === 0,
      approved
    );
    return { account, reactivated: false };
  });
}

async function renameAccount(accountId, nick) {
  return transaction(async (client) => {
    await lockAccounts(client);
    await assertNickFree(client, nick, accountId);
    const { rows } = await client.query('UPDATE accounts SET nick = $2 WHERE id = $1 RETURNING *', [
      accountId,
      nick,
    ]);
    const account = rows[0];
    if (account?.is_main) {
      await client.query('UPDATE members SET nick = $2 WHERE discord_id = $1', [
        account.member_id,
        nick,
      ]);
    }
    return account || null;
  });
}

// Oficial aprova uma conta da lista de espera, se houver vaga.
async function approveAccount(accountId) {
  return transaction(async (client) => {
    await lockAccounts(client);
    const { rows } = await client.query('SELECT * FROM accounts WHERE id = $1 FOR UPDATE', [
      accountId,
    ]);
    if (!rows[0] || rows[0].status !== 'espera') throw new RuleError('not_waiting');
    if ((await countActive(client)) >= GUILD_MAX) throw new RuleError('full');
    const updated = await client.query(
      `UPDATE accounts SET status = 'ativo', status_changed_at = now() WHERE id = $1 RETURNING *`,
      [accountId]
    );
    return updated.rows[0];
  });
}

async function deactivateAccount(accountId) {
  const { rows } = await pool.query(
    `UPDATE accounts SET status = 'inativo', status_changed_at = now()
     WHERE id = $1 AND status <> 'inativo'
     RETURNING *`,
    [accountId]
  );
  return rows[0] || null;
}

async function deactivateMember(discordId) {
  const { rows } = await pool.query(
    `UPDATE accounts SET status = 'inativo', status_changed_at = now()
     WHERE member_id = $1 AND status <> 'inativo'
     RETURNING *`,
    [discordId]
  );
  return rows;
}

// Apaga uma conta e os pontos dela. Se era a principal, a smurf mais antiga vira a
// principal; se era a única conta, a pessoa também é apagada.
async function deleteAccount(accountId) {
  return transaction(async (client) => {
    await lockAccounts(client);
    const { rows } = await client.query('DELETE FROM accounts WHERE id = $1 RETURNING *', [
      accountId,
    ]);
    const account = rows[0];
    if (!account) return null;

    const remaining = await client.query(
      'SELECT * FROM accounts WHERE member_id = $1 ORDER BY created_at, id',
      [account.member_id]
    );
    if (remaining.rows.length === 0) {
      await client.query('DELETE FROM members WHERE discord_id = $1', [account.member_id]);
      return { account, memberDeleted: true };
    }
    if (account.is_main) {
      const next = remaining.rows[0];
      await client.query('UPDATE accounts SET is_main = true WHERE id = $1', [next.id]);
      await client.query('UPDATE members SET nick = $2 WHERE discord_id = $1', [
        account.member_id,
        next.nick,
      ]);
    }
    return { account, memberDeleted: false };
  });
}

// Pessoas registradas, em ordem de nick principal, para escolher num menu. `search`
// procura no nome e no nick de qualquer conta. Retorna `{ people, total }`.
async function listPeople({ search = null, offset = 0, limit = 25 } = {}) {
  const pattern = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const where = `
    WHERE $1::text IS NULL OR m.nome ILIKE $1
       OR EXISTS (SELECT 1 FROM accounts s WHERE s.member_id = m.discord_id AND s.nick ILIKE $1)`;
  const { rows } = await pool.query(
    `SELECT m.discord_id, m.nome, m.patente,
            COALESCE(main.nick, m.nick) AS main_nick,
            count(a.id) AS accounts,
            count(a.id) FILTER (WHERE a.status = 'ativo') AS active
     FROM members m
     LEFT JOIN accounts a ON a.member_id = m.discord_id
     LEFT JOIN accounts main ON main.member_id = m.discord_id AND main.is_main
     ${where}
     GROUP BY m.discord_id, main.nick
     ORDER BY lower(COALESCE(main.nick, m.nick)), m.discord_id
     LIMIT $2 OFFSET $3`,
    [pattern, limit, offset]
  );
  const count = await pool.query(`SELECT count(*) AS n FROM members m ${where}`, [pattern]);
  return {
    people: rows.map((r) => ({ ...r, accounts: Number(r.accounts), active: Number(r.active) })),
    total: Number(count.rows[0].n),
  };
}

async function listAccounts(status = null) {
  const { rows } = await pool.query(
    `${ACCOUNT_WITH_MEMBER}
     WHERE ($1::text IS NULL OR a.status = $1)
     ORDER BY lower(a.nick)`,
    [status]
  );
  return rows;
}

async function getAccountCounts() {
  const { rows } = await pool.query(
    `SELECT count(*) FILTER (WHERE status = 'ativo') AS ativo,
            count(*) FILTER (WHERE status = 'espera') AS espera,
            count(*) FILTER (WHERE status = 'inativo') AS inativo,
            count(DISTINCT member_id) FILTER (WHERE status = 'ativo') AS pessoas
     FROM accounts`
  );
  const r = rows[0];
  return {
    ativo: Number(r.ativo),
    espera: Number(r.espera),
    inativo: Number(r.inativo),
    pessoas: Number(r.pessoas),
  };
}

// Lista de espera na ordem de chegada.
async function getWaitlist() {
  const { rows } = await pool.query(
    `${ACCOUNT_WITH_MEMBER}
     WHERE a.status = 'espera'
     ORDER BY a.status_changed_at, a.id`
  );
  return rows;
}

// --- Pontos (por conta) ------------------------------------------------------

async function getSeasonTotal(accountId, seasonId) {
  const { rows } = await pool.query(
    'SELECT COALESCE(SUM(points), 0) AS total FROM account_points WHERE account_id = $1 AND season_id = $2',
    [accountId, seasonId]
  );
  return Number(rows[0].total);
}

async function getSeasonTotals(seasonId) {
  const { rows } = await pool.query(
    'SELECT account_id, SUM(points) AS total FROM account_points WHERE season_id = $1 GROUP BY account_id',
    [seasonId]
  );
  return new Map(rows.map((r) => [r.account_id, Number(r.total)]));
}

async function getWeeklyPoints(accountId, seasonId) {
  const { rows } = await pool.query(
    'SELECT week_number, points FROM account_points WHERE account_id = $1 AND season_id = $2 ORDER BY week_number ASC',
    [accountId, seasonId]
  );
  return rows;
}

// Salva os pontos e atualiza a conclusão da temporada numa única transação. O lock
// na linha da conta faz dois envios simultâneos para a mesma conta rodarem em fila.
async function setWeeklyPoints(accountId, seasonId, weekNumber, points, updatedBy) {
  return transaction(async (client) => {
    const account = await client.query('SELECT status FROM accounts WHERE id = $1 FOR UPDATE', [
      accountId,
    ]);
    if (account.rows[0]?.status !== 'ativo') throw new RuleError('not_active');

    const { rows } = await client.query(
      `INSERT INTO account_points (account_id, season_id, week_number, points, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_id, season_id, week_number)
       DO UPDATE SET points = $4, updated_by = $5, updated_at = now()
       RETURNING *`,
      [accountId, seasonId, weekNumber, points, updatedBy]
    );

    const totalResult = await client.query(
      'SELECT COALESCE(SUM(points), 0) AS total FROM account_points WHERE account_id = $1 AND season_id = $2',
      [accountId, seasonId]
    );
    if (Number(totalResult.rows[0].total) >= SEASON_TOTAL_MAX) {
      await client.query(
        `INSERT INTO account_completions (account_id, season_id)
         VALUES ($1, $2)
         ON CONFLICT (account_id, season_id) DO NOTHING`,
        [accountId, seasonId]
      );
    } else {
      await client.query(
        'DELETE FROM account_completions WHERE account_id = $1 AND season_id = $2',
        [accountId, seasonId]
      );
    }
    return rows[0];
  });
}

async function getRanking(seasonId) {
  const { rows } = await pool.query(
    `SELECT a.id, a.nick, a.member_id AS discord_id, m.origem,
            COALESCE(SUM(p.points), 0) AS total,
            c.completed_at
     FROM accounts a
     JOIN members m ON m.discord_id = a.member_id
     LEFT JOIN account_points p ON p.account_id = a.id AND p.season_id = $1
     LEFT JOIN account_completions c ON c.account_id = a.id AND c.season_id = $1
     WHERE a.status = 'ativo'
     GROUP BY a.id, m.origem, c.completed_at
     ORDER BY (c.completed_at IS NULL) ASC, c.completed_at ASC, total DESC`,
    [seasonId]
  );
  return rows;
}

// Contas ativas que ainda não registraram pontos na semana.
async function getAccountsWithoutPoints(seasonId, weekNumber) {
  const { rows } = await pool.query(
    `${ACCOUNT_WITH_MEMBER}
     WHERE a.status = 'ativo'
       AND NOT EXISTS (
         SELECT 1 FROM account_points p
         WHERE p.account_id = a.id AND p.season_id = $1 AND p.week_number = $2
       )
     ORDER BY lower(a.nick)`,
    [seasonId, weekNumber]
  );
  return rows;
}

// Todas as contas com os pontos de cada semana da temporada, para o CSV.
async function getExportRows(seasonId) {
  const weeks = Array.from(
    { length: WEEKS_PER_SEASON },
    (_, i) => `COALESCE(SUM(p.points) FILTER (WHERE p.week_number = ${i + 1}), 0) AS semana${i + 1}`
  ).join(', ');
  const { rows } = await pool.query(
    `SELECT a.nick, a.is_main, a.status, a.member_id, m.nome, m.origem, m.telefone, m.patente,
            ${weeks}, COALESCE(SUM(p.points), 0) AS total
     FROM accounts a
     JOIN members m ON m.discord_id = a.member_id
     LEFT JOIN account_points p ON p.account_id = a.id AND p.season_id = $1
     GROUP BY a.id, m.discord_id
     ORDER BY lower(a.nick)`,
    [seasonId]
  );
  return rows;
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

module.exports = {
  pool,
  init,
  RuleError,
  getSetting,
  setSetting,
  getRegistrationMode,
  getActiveSeason,
  createSeason,
  currentWeekNumber,
  getMember,
  updateMember,
  registerMember,
  deleteMember,
  getAccounts,
  getAccount,
  findAccountByNick,
  addAccount,
  renameAccount,
  approveAccount,
  deactivateAccount,
  deactivateMember,
  deleteAccount,
  listAccounts,
  listPeople,
  getAccountCounts,
  getWaitlist,
  getSeasonTotal,
  getSeasonTotals,
  getWeeklyPoints,
  setWeeklyPoints,
  getRanking,
  getAccountsWithoutPoints,
  getExportRows,
  startKeepAlive,
  SEASON_TOTAL_MAX,
  WEEK_MAX,
  WEEKS_PER_SEASON,
  GUILD_MAX,
  REGISTRATION_MODES,
};
