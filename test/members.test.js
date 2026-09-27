const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const { saveMember } = require('../src/members');
const remover = require('../src/commands/remover');

const MEMBER = {
  discord_id: '42',
  nome: 'Maria Silva',
  nick: 'MeuNick',
  origem: 'BR',
  telefone: null,
  patente: 'RECRUTA',
  active: true,
};

function stubDb(t, stubs) {
  for (const [name, fn] of Object.entries(stubs)) {
    t.mock.method(db, name, fn);
  }
}

// Interação falsa de /remover ou dos botões dele.
function fakeInteraction({ officer, options = {}, customId }) {
  const calls = { reply: [], update: [] };
  return {
    calls,
    customId,
    user: { id: '1' },
    guild: null,
    memberPermissions: { has: () => officer },
    member: { roles: { cache: { has: () => false } } },
    options: {
      getUser: () => ({ id: options.membro }),
      getString: () => options.acao,
    },
    reply: async (p) => calls.reply.push(p),
    update: async (p) => calls.update.push(p),
  };
}

test('segundo envio do registro vira atualização em vez de erro', async (t) => {
  stubDb(t, {
    getMember: async () => null,
    createMember: async () => ({ ...MEMBER, inserted: false }),
  });
  const result = await saveMember(null, '42', {
    nome: 'Maria Silva',
    nick: 'MeuNick',
    origem: 'BR',
  });
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.created, false);
});

test('membro desativado que se registra de novo volta a ficar ativo', async (t) => {
  let fields;
  stubDb(t, {
    getMember: async () => ({ ...MEMBER, active: false }),
    updateMember: async (id, f) => (fields = f) && { ...MEMBER, ...f },
  });
  await saveMember(null, '42', { nick: 'NovoNick' });
  assert.deepStrictEqual(fields, { nick: 'NovoNick', active: true });
});

test('pontos são salvos numa transação com lock no membro', async (t) => {
  const queries = [];
  const fakeClient = {
    query: async (sql) => {
      queries.push(sql.trim().split(/\s+/).slice(0, 2).join(' '));
      return { rows: [{ total: 600 }] };
    },
    release: () => queries.push('release'),
  };
  t.mock.method(db.pool, 'connect', async () => fakeClient);
  await db.setWeeklyPoints('42', 1, 1, 600, '42');
  assert.deepStrictEqual(queries, [
    'BEGIN',
    'SELECT 1',
    'INSERT INTO',
    'SELECT COALESCE(SUM(points),',
    'DELETE FROM',
    'COMMIT',
    'release',
  ]);
});

test('erro no meio dos pontos desfaz a transação', async (t) => {
  const queries = [];
  const fakeClient = {
    query: async (sql) => {
      queries.push(sql.trim().split(/\s+/)[0]);
      if (sql.includes('INSERT INTO weekly_points')) throw new Error('falhou');
      return { rows: [] };
    },
    release: () => queries.push('release'),
  };
  t.mock.method(db.pool, 'connect', async () => fakeClient);
  await assert.rejects(db.setWeeklyPoints('42', 1, 1, 100, '42'), /falhou/);
  assert.deepStrictEqual(queries.slice(-2), ['ROLLBACK', 'release']);
});

test('/remover é só para oficiais', async (t) => {
  stubDb(t, { getMember: async () => MEMBER });
  const i = fakeInteraction({ officer: false, options: { membro: '42', acao: 'apagar' } });
  await remover.execute(i);
  assert.match(i.calls.reply[0].content, /Apenas oficiais/);
});

test('/remover desativar marca o membro como inativo', async (t) => {
  let fields;
  stubDb(t, {
    getMember: async () => MEMBER,
    updateMember: async (id, f) => (fields = f),
  });
  const i = fakeInteraction({ officer: true, options: { membro: '42', acao: 'desativar' } });
  await remover.execute(i);
  assert.deepStrictEqual(fields, { active: false });
});

test('/remover apagar pede confirmação antes de apagar', async (t) => {
  const deleteMember = t.mock.fn(async () => MEMBER);
  stubDb(t, { getMember: async () => MEMBER, deleteMember });
  const i = fakeInteraction({ officer: true, options: { membro: '42', acao: 'apagar' } });
  await remover.execute(i);
  assert.strictEqual(deleteMember.mock.callCount(), 0);
  const buttons = i.calls.reply[0].components[0].toJSON().components;
  assert.deepStrictEqual(
    buttons.map((b) => b.custom_id),
    ['remover:apagar:42', 'remover:cancelar']
  );
});

test('confirmar apaga o membro; cancelar não apaga', async (t) => {
  const deleteMember = t.mock.fn(async () => MEMBER);
  stubDb(t, { deleteMember });

  const cancel = fakeInteraction({ officer: true, customId: 'remover:cancelar' });
  await remover.handleButton(cancel);
  assert.strictEqual(deleteMember.mock.callCount(), 0);

  const confirm = fakeInteraction({ officer: true, customId: 'remover:apagar:42' });
  await remover.handleButton(confirm);
  assert.deepStrictEqual(deleteMember.mock.calls[0].arguments, ['42']);
  assert.match(confirm.calls.update[0].content, /foram apagados/);
});

test('keep-alive consulta o banco no intervalo configurado', (t) => {
  let tick;
  let intervalMs;
  t.mock.method(global, 'setInterval', (fn, ms) => {
    tick = fn;
    intervalMs = ms;
    return { unref: () => {} };
  });
  const query = t.mock.method(db.pool, 'query', async () => ({ rows: [] }));
  db.startKeepAlive(4);
  assert.strictEqual(intervalMs, 4 * 60 * 1000);
  tick();
  assert.strictEqual(query.mock.calls[0].arguments[0], 'SELECT 1');
});
