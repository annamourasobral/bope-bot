const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const {
  parseNicks,
  saveMember,
  resolveActiveAccount,
  savePoints,
  addMemberAccount,
} = require('../src/members');
const remover = require('../src/commands/remover');

const MEMBER = {
  discord_id: '42',
  nome: 'Maria Silva',
  nick: 'MeuNick',
  origem: 'BR',
  telefone: null,
  patente: 'RECRUTA',
};
const MAIN = { id: 1, member_id: '42', nick: 'MeuNick', is_main: true, status: 'ativo' };
const SMURF = { id: 2, member_id: '42', nick: 'Malvada', is_main: false, status: 'ativo' };
const SEASON = { id: 1, name: 'Temporada 1', start_date: new Date().toISOString() };

function stubDb(t, stubs) {
  for (const [name, fn] of Object.entries(stubs)) {
    t.mock.method(db, name, fn);
  }
}

test('smurfs aceitam vírgula, ponto e vírgula e espaços', () => {
  assert.deepStrictEqual(parseNicks(' Malvada, Outra ;Terceira,, '), [
    'Malvada',
    'Outra',
    'Terceira',
  ]);
  assert.deepStrictEqual(parseNicks(''), []);
  assert.deepStrictEqual(parseNicks(undefined), []);
});

test('registro recusa telefone inválido e nick repetido no mesmo envio', async (t) => {
  stubDb(t, { getMember: async () => null });
  const phone = await saveMember(null, '42', {
    nome: 'Maria',
    nick: 'A',
    origem: 'BR',
    telefone: '11987654321',
  });
  assert.match(phone.error, /Telefone inválido/);

  const dup = await saveMember(null, '42', {
    nome: 'Maria',
    nick: 'Athirst',
    origem: 'BR',
    smurfs: 'athirst',
  });
  assert.match(dup.error, /informado duas vezes/);
});

test('nick de outra pessoa vira mensagem com o dono', async (t) => {
  stubDb(t, {
    getMember: async () => null,
    registerMember: async () => {
      throw new db.RuleError('nick_taken', { nick: 'Athirst', ownerId: '99' });
    },
  });
  const result = await saveMember(null, '42', { nome: 'Maria', nick: 'Athirst', origem: 'BR' });
  assert.match(result.error, /Athirst\*\* já está registrado por <@99>/);
});

test('segundo envio do registro vira atualização em vez de erro', async (t) => {
  let getMemberCalls = 0;
  stubDb(t, {
    getMember: async () => (getMemberCalls++ === 0 ? null : MEMBER),
    registerMember: async () => null,
    getAccounts: async () => [MAIN],
    updateMember: async (id, f) => ({ ...MEMBER, ...f }),
  });
  const result = await saveMember(null, '42', {
    nome: 'Maria Silva',
    nick: 'MeuNick',
    origem: 'BR',
  });
  assert.strictEqual(result.error, undefined);
  assert.strictEqual(result.created, false);
});

test('mudar o nick no registro renomeia a conta principal', async (t) => {
  const renameAccount = t.mock.fn(async () => {});
  stubDb(t, {
    getMember: async () => MEMBER,
    getAccounts: async () => [MAIN, SMURF],
    renameAccount,
    updateMember: async () => MEMBER,
  });
  await saveMember(null, '42', { nick: 'NovoNick' });
  assert.deepStrictEqual(renameAccount.mock.calls[0].arguments, [1, 'NovoNick']);
});

test('pontos: com duas contas ativas é preciso dizer qual', async (t) => {
  stubDb(t, { getMember: async () => MEMBER, getAccounts: async () => [MAIN, SMURF] });
  const without = await resolveActiveAccount('42');
  assert.match(without.error, /Mais de uma conta ativa.*MeuNick.*Malvada/);
  const withNick = await resolveActiveAccount('42', 'malvada');
  assert.strictEqual(withNick.account.id, 2);
});

test('pontos numa conta que deixou de ser ativa viram mensagem, não erro', async (t) => {
  stubDb(t, {
    getActiveSeason: async () => SEASON,
    setWeeklyPoints: async () => {
      throw new db.RuleError('not_active');
    },
  });
  const result = await savePoints(MAIN, 100, 1, '42');
  assert.match(result.error, /não está ativa/);
});

test('limite de 5 contas por pessoa', async (t) => {
  const accounts = [1, 2, 3, 4, 5].map((id) => ({ ...SMURF, id, nick: `C${id}` }));
  stubDb(t, { getMember: async () => MEMBER, getAccounts: async () => accounts });
  const result = await addMemberAccount(null, '42', 'Sexta');
  assert.match(result.error, /No máximo 5 contas/);
});

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
      getString: (name) => options[name] ?? null,
    },
    reply: async (p) => calls.reply.push(p),
    update: async (p) => calls.update.push(p),
  };
}

const buttonIds = (reply) => reply.components[0].toJSON().components.map((b) => b.custom_id);

test('/remover é só para oficiais', async (t) => {
  stubDb(t, { getMember: async () => MEMBER });
  const i = fakeInteraction({ officer: false, options: { membro: '42', acao: 'apagar' } });
  await remover.execute(i);
  assert.match(i.calls.reply[0].content, /Apenas oficiais/);
});

test('/remover desativar com conta desativa só aquela conta', async (t) => {
  const deactivateAccount = t.mock.fn(async () => SMURF);
  const deactivateMember = t.mock.fn(async () => []);
  stubDb(t, {
    getMember: async () => MEMBER,
    getAccounts: async () => [MAIN, SMURF],
    deactivateAccount,
    deactivateMember,
    getAccountCounts: async () => ({ ativo: 1, espera: 0 }),
  });
  const i = fakeInteraction({
    officer: true,
    options: { membro: '42', acao: 'desativar', conta: 'Malvada' },
  });
  await remover.execute(i);
  assert.deepStrictEqual(deactivateAccount.mock.calls[0].arguments, [2]);
  assert.strictEqual(deactivateMember.mock.callCount(), 0);
  assert.match(i.calls.reply[0].content, /Malvada\*\* foi desativada/);
});

test('/remover apagar pede confirmação: uma conta ou a pessoa inteira', async (t) => {
  const deleteAccount = t.mock.fn();
  const deleteMember = t.mock.fn();
  stubDb(t, {
    getMember: async () => MEMBER,
    getAccounts: async () => [MAIN, SMURF],
    deleteAccount,
    deleteMember,
  });

  const one = fakeInteraction({
    officer: true,
    options: { membro: '42', acao: 'apagar', conta: 'Malvada' },
  });
  await remover.execute(one);
  assert.deepStrictEqual(buttonIds(one.calls.reply[0]), [
    'remover:apagar-conta:2',
    'remover:cancelar',
  ]);

  const all = fakeInteraction({ officer: true, options: { membro: '42', acao: 'apagar' } });
  await remover.execute(all);
  assert.deepStrictEqual(buttonIds(all.calls.reply[0]), [
    'remover:apagar-pessoa:42',
    'remover:cancelar',
  ]);
  assert.strictEqual(deleteAccount.mock.callCount() + deleteMember.mock.callCount(), 0);
});

test('confirmar apaga a conta; cancelar não apaga nada', async (t) => {
  const deleteAccount = t.mock.fn(async () => ({ account: SMURF, memberDeleted: false }));
  stubDb(t, { deleteAccount, getAccountCounts: async () => ({ ativo: 1, espera: 0 }) });

  const cancel = fakeInteraction({ officer: true, customId: 'remover:cancelar' });
  await remover.handleButton(cancel);
  assert.strictEqual(deleteAccount.mock.callCount(), 0);

  const confirm = fakeInteraction({ officer: true, customId: 'remover:apagar-conta:2' });
  await remover.handleButton(confirm);
  assert.deepStrictEqual(deleteAccount.mock.calls[0].arguments, [2]);
  assert.match(confirm.calls.update[0].content, /Malvada\*\* e os pontos dela foram apagados/);
});
