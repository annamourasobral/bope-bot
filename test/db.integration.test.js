// Testa as queries de verdade contra um Postgres de teste. Só roda com
// TEST_DATABASE_URL definido (ex: um Postgres local). NUNCA aponte para o banco de
// produção: o teste apaga todas as tabelas.
const test = require('node:test');
const assert = require('node:assert');

const url = process.env.TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;
const db = url ? require('../src/db') : null;

const opts = { skip: url ? false : 'defina TEST_DATABASE_URL para rodar', concurrency: false };

async function resetDatabase() {
  await db.pool.query(`
    DROP TABLE IF EXISTS account_completions, account_points, accounts, settings,
      season_completions, weekly_points, members, seasons CASCADE`);
  await db.init();
}

async function createSeason() {
  const start = new Date();
  return db.createSeason('Temporada Teste', start.toISOString().slice(0, 10));
}

// Enche a guilda com N contas ativas de pessoas fictícias.
async function fillGuild(n) {
  await db.pool.query(
    `INSERT INTO members (discord_id, nick, nome, origem)
     SELECT 'fill' || i, 'Fill' || i, 'Fill', 'BR' FROM generate_series(1, $1) i`,
    [n]
  );
  await db.pool.query(
    `INSERT INTO accounts (member_id, nick, is_main, status)
     SELECT 'fill' || i, 'Fill' || i, true, 'ativo' FROM generate_series(1, $1) i`,
    [n]
  );
}

const PERSON = { nome: 'Anna', origem: 'BR', telefone: '+5511987654321' };

test.describe('banco (integração)', opts, () => {
  test.after(() => db?.pool.end());
  test.beforeEach(() => resetDatabase());

  test('migração transforma cada membro antigo numa conta principal com os pontos', async () => {
    // Estado antigo: sem contas, pontos em weekly_points.
    await db.pool.query(`DELETE FROM settings; DELETE FROM accounts;`);
    const season = await createSeason();
    await db.pool.query(
      `INSERT INTO members (discord_id, nick, nome, origem, active) VALUES
         ('100', 'Athirst', 'Anna', 'BR', true), ('300', 'Sumido', 'Fulano', 'BR', false)`
    );
    await db.pool.query(
      `INSERT INTO weekly_points (member_id, season_id, week_number, points) VALUES
         ('100', $1, 1, 600), ('100', $1, 2, 600), ('100', $1, 3, 600), ('100', $1, 4, 600),
         ('300', $1, 1, 100)`,
      [season.id]
    );
    await db.pool.query(
      `INSERT INTO season_completions (member_id, season_id) VALUES ('100', $1)`,
      [season.id]
    );

    await db.init();
    await db.init(); // Segunda vez não pode duplicar nada.

    const [anna] = await db.getAccounts('100');
    const [fulano] = await db.getAccounts('300');
    assert.deepStrictEqual(
      [anna.nick, anna.is_main, anna.status, fulano.status],
      ['Athirst', true, 'ativo', 'inativo']
    );
    assert.strictEqual(await db.getSeasonTotal(anna.id, season.id), 2400);
    assert.strictEqual(await db.getSeasonTotal(fulano.id, season.id), 100);
    assert.strictEqual((await db.listAccounts()).length, 2);
    const ranking = await db.getRanking(season.id);
    assert.ok(ranking[0].completed_at, 'conclusão da temporada migrada');
  });

  test('registro com smurf cria duas contas ativas, só a primeira é principal', async () => {
    const { accounts } = await db.registerMember('100', PERSON, ['Athirst', 'Malvada']);
    assert.deepStrictEqual(
      accounts.map((a) => [a.nick, a.is_main, a.status]),
      [
        ['Athirst', true, 'ativo'],
        ['Malvada', false, 'ativo'],
      ]
    );
    const counts = await db.getAccountCounts();
    assert.deepStrictEqual([counts.ativo, counts.pessoas], [2, 1]);
  });

  test('nick já usado por outra pessoa é recusado, sem diferenciar maiúsculas', async () => {
    await db.registerMember('100', PERSON, ['Athirst']);
    await assert.rejects(db.registerMember('200', PERSON, ['athirst']), { code: 'nick_taken' });
    await assert.rejects(db.addAccount('100', 'ATHIRST'), { code: 'already_yours' });
    assert.strictEqual(await db.getMember('200'), null, 'nada foi criado pela metade');
  });

  test('registro enviado várias vezes ao mesmo tempo cria uma pessoa só', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => db.registerMember('100', PERSON, ['Athirst']))
    );
    assert.strictEqual(results.filter(Boolean).length, 1);
    assert.strictEqual((await db.getAccounts('100')).length, 1);
  });

  test('com a guilda cheia a conta nova vai para a lista de espera', async () => {
    await fillGuild(db.GUILD_MAX);
    const { accounts } = await db.registerMember('100', PERSON, ['Athirst']);
    assert.strictEqual(accounts[0].status, 'espera');
    await assert.rejects(db.approveAccount(accounts[0].id), { code: 'full' });

    await db.deactivateAccount((await db.findAccountByNick('Fill1')).id);
    const approved = await db.approveAccount(accounts[0].id);
    assert.strictEqual(approved.status, 'ativo');
    assert.strictEqual((await db.getAccountCounts()).ativo, db.GUILD_MAX);
  });

  test('várias contas disputando a última vaga: só uma entra', async () => {
    await fillGuild(db.GUILD_MAX - 1);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        db.registerMember(`p${i}`, { ...PERSON, nome: `P${i}` }, [`Nick${i}`])
      )
    );
    const statuses = results.map((r) => r.accounts[0].status);
    assert.strictEqual(statuses.filter((s) => s === 'ativo').length, 1);
    assert.strictEqual(statuses.filter((s) => s === 'espera').length, 9);
    assert.strictEqual((await db.getAccountCounts()).ativo, db.GUILD_MAX);
  });

  test('duas pessoas registrando o mesmo nick ao mesmo tempo: só uma fica com ele', async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        db.registerMember(`p${i}`, { ...PERSON, nome: `P${i}` }, ['Disputado'])
      )
    );
    assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok(
      results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'nick_taken')
    );
  });

  test('em modo aprovação toda conta nova espera, na ordem de chegada', async () => {
    await db.setSetting('registration_mode', 'aprovacao');
    await db.registerMember('100', PERSON, ['Athirst', 'Malvada']);
    await db.registerMember('200', { ...PERSON, nome: 'Zeca' }, ['Zeca']);
    const waitlist = await db.getWaitlist();
    assert.deepStrictEqual(
      waitlist.map((a) => a.nick),
      ['Athirst', 'Malvada', 'Zeca']
    );
    await assert.rejects(db.approveAccount(9999), { code: 'not_waiting' });
  });

  test('pontos são por conta e só contas ativas pontuam', async () => {
    const season = await createSeason();
    const { accounts } = await db.registerMember('100', PERSON, ['Athirst', 'Malvada']);
    const [main, smurf] = accounts;
    for (const w of [1, 2, 3, 4]) await db.setWeeklyPoints(main.id, season.id, w, 600, '100');
    await db.setWeeklyPoints(smurf.id, season.id, 1, 300, '100');

    const ranking = await db.getRanking(season.id);
    assert.deepStrictEqual(
      ranking.map((r) => [r.nick, Number(r.total), Boolean(r.completed_at)]),
      [
        ['Athirst', 2400, true],
        ['Malvada', 300, false],
      ]
    );

    await db.deactivateAccount(smurf.id);
    await assert.rejects(db.setWeeklyPoints(smurf.id, season.id, 2, 100, '100'), {
      code: 'not_active',
    });
    assert.deepStrictEqual(
      (await db.getAccountsWithoutPoints(season.id, 2)).map((a) => a.nick),
      [],
      'conta inativa não aparece como pendente'
    );
  });

  test('conta inativa volta pelo Adicionar conta com o histórico', async () => {
    const season = await createSeason();
    const { accounts } = await db.registerMember('100', PERSON, ['Athirst', 'Malvada']);
    await db.setWeeklyPoints(accounts[1].id, season.id, 1, 300, '100');
    await db.deactivateAccount(accounts[1].id);

    const { account, reactivated } = await db.addAccount('100', 'malvada');
    assert.deepStrictEqual(
      [account.id, account.status, reactivated],
      [accounts[1].id, 'ativo', true]
    );
    assert.strictEqual(await db.getSeasonTotal(account.id, season.id), 300);
  });

  test('apagar a principal promove a smurf; apagar a última apaga a pessoa', async () => {
    const { accounts } = await db.registerMember('100', PERSON, ['Athirst', 'Malvada']);
    const first = await db.deleteAccount(accounts[0].id);
    assert.strictEqual(first.memberDeleted, false);
    const [remaining] = await db.getAccounts('100');
    assert.deepStrictEqual([remaining.nick, remaining.is_main], ['Malvada', true]);
    assert.strictEqual((await db.getMember('100')).nick, 'Malvada');

    const last = await db.deleteAccount(remaining.id);
    assert.strictEqual(last.memberDeleted, true);
    assert.strictEqual(await db.getMember('100'), null);
  });

  test('renomear a principal não pode usar nick de outra pessoa', async () => {
    const { accounts } = await db.registerMember('100', PERSON, ['Athirst']);
    await db.registerMember('200', PERSON, ['Zeca']);
    await assert.rejects(db.renameAccount(accounts[0].id, 'zeca'), { code: 'nick_taken' });
    const renamed = await db.renameAccount(accounts[0].id, 'Athirst2');
    assert.strictEqual(renamed.nick, 'Athirst2');
    assert.strictEqual((await db.getMember('100')).nick, 'Athirst2');
  });

  test('exportação traz todas as contas com os pontos por semana', async () => {
    const season = await createSeason();
    const { accounts } = await db.registerMember('100', PERSON, ['Athirst', 'Malvada']);
    await db.setWeeklyPoints(accounts[1].id, season.id, 2, 450, '100');
    const rows = await db.getExportRows(season.id);
    const malvada = rows.find((r) => r.nick === 'Malvada');
    assert.deepStrictEqual(
      [malvada.is_main, Number(malvada.semana2), Number(malvada.total), malvada.telefone],
      [false, 450, 450, '+5511987654321']
    );
    assert.strictEqual((await db.getExportRows(null)).length, 2, 'funciona sem temporada');
  });
});
