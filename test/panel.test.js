const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const {
  buildPanelMessage,
  buildRegisterModal,
  buildAddAccountModal,
  buildPointsModal,
  isPanelInteraction,
  handlePanelInteraction,
} = require('../src/panel');

const SEASON = { id: 1, name: 'Temporada 1', start_date: new Date().toISOString() };
const MEMBER = {
  discord_id: '42',
  nome: 'Maria Silva',
  nick: 'MeuNick',
  origem: 'PT',
  telefone: '+351912345678',
  patente: 'RECRUTA',
};
const MAIN = { id: 1, member_id: '42', nick: 'MeuNick', is_main: true, status: 'ativo' };
const SMURF = { id: 2, member_id: '42', nick: 'Malvada', is_main: false, status: 'ativo' };

// Substitui funções do banco durante um teste e restaura depois.
function stubDb(t, stubs) {
  for (const [name, fn] of Object.entries(stubs)) {
    t.mock.method(db, name, fn);
  }
}

// Interação falsa com o mínimo que o painel usa.
function fakeInteraction({ customId, text = {}, selects = {}, modal = false }) {
  const calls = { reply: [], showModal: [] };
  return {
    calls,
    customId,
    user: { id: '42' },
    guild: null,
    isButton: () => !modal,
    isModalSubmit: () => modal,
    fields: {
      getTextInputValue: (id) => {
        if (!(id in text)) throw new Error(`campo ${id} não existe no formulário`);
        return text[id];
      },
      getStringSelectValues: (id) => selects[id] ?? [],
    },
    reply: async (payload) => calls.reply.push(payload),
    showModal: async (m) => calls.showModal.push(m.toJSON()),
  };
}

const fieldIds = (modal) => modal.components.map((c) => c.component.custom_id);

test('painel e formulários passam na validação do Discord', () => {
  const panel = buildPanelMessage();
  panel.embeds.forEach((e) => e.toJSON());
  panel.components.forEach((c) => c.toJSON());
  buildRegisterModal(null).toJSON();
  buildRegisterModal(MEMBER, 'MeuNick').toJSON();
  buildAddAccountModal().toJSON();
  buildPointsModal(SEASON, [MAIN]).toJSON();
  buildPointsModal(SEASON, [MAIN, SMURF]).toJSON();
  buildPointsModal({ ...SEASON, name: 'Uma temporada com um nome muito, muito comprido' }, [
    MAIN,
  ]).toJSON();
});

test('primeiro registro pergunta da smurf; edição não', () => {
  assert.deepStrictEqual(fieldIds(buildRegisterModal(null).toJSON()), [
    'nome',
    'nick',
    'origem',
    'telefone',
    'smurfs',
  ]);
  const edit = buildRegisterModal(MEMBER, 'MeuNick').toJSON();
  assert.deepStrictEqual(fieldIds(edit), ['nome', 'nick', 'origem', 'telefone']);
  assert.strictEqual(edit.components[1].component.value, 'MeuNick');
  assert.strictEqual(edit.components[3].component.value, '+351912345678');
});

test('formulário de pontos só pergunta a conta para quem tem mais de uma', () => {
  const single = buildPointsModal(SEASON, [MAIN]).toJSON();
  assert.strictEqual(single.custom_id, 'painel:pontos-form:1');
  assert.deepStrictEqual(fieldIds(single), ['semana', 'pontos']);

  const multi = buildPointsModal(SEASON, [MAIN, SMURF]).toJSON();
  assert.strictEqual(multi.custom_id, 'painel:pontos-form');
  assert.deepStrictEqual(fieldIds(multi), ['conta', 'semana', 'pontos']);
  const defaults = multi.components[0].component.options.filter((o) => o.default);
  assert.deepStrictEqual(
    defaults.map((o) => o.value),
    ['1'],
    'conta principal vem selecionada'
  );
});

test('só reconhece interações do painel', () => {
  assert.ok(isPanelInteraction(fakeInteraction({ customId: 'painel:status' })));
  assert.ok(!isPanelInteraction(fakeInteraction({ customId: 'staff:membros' })));
});

test('registro pelo formulário cria a principal e as smurfs digitadas', async (t) => {
  let args;
  let getMemberCalls = 0;
  stubDb(t, {
    getMember: async () => (getMemberCalls++ === 0 ? null : MEMBER),
    registerMember: async (...a) => {
      args = a;
      return { member: MEMBER, accounts: [MAIN, SMURF] };
    },
  });
  const i = fakeInteraction({
    customId: 'painel:registrar-form',
    modal: true,
    text: { nome: ' Maria Silva ', nick: 'MeuNick', telefone: '+5511987654321', smurfs: 'Malvada' },
    selects: { origem: ['BR'] },
  });
  await handlePanelInteraction(i);
  assert.deepStrictEqual(args, [
    '42',
    { nome: 'Maria Silva', origem: 'BR', telefone: '+5511987654321', patente: null },
    ['MeuNick', 'Malvada'],
    { approved: false },
  ]);
  assert.match(i.calls.reply[0].content, /MeuNick\*\* ⭐: ✅ ativa/);
  assert.match(i.calls.reply[0].content, /Malvada\*\* \(smurf\): ✅ ativa/);
});

test('editar o registro não lê o campo de smurf e não aceita telefone vazio', async (t) => {
  const updateMember = t.mock.fn(async (id, fields) => ({ ...MEMBER, ...fields }));
  stubDb(t, { getMember: async () => MEMBER, getAccounts: async () => [MAIN], updateMember });
  const edit = (telefone) =>
    fakeInteraction({
      customId: 'painel:editar-form',
      modal: true,
      text: { nome: 'Maria Silva', nick: 'MeuNick', telefone },
      selects: { origem: ['PT'] },
    });

  const empty = edit('');
  await handlePanelInteraction(empty);
  assert.match(empty.calls.reply[0].content, /Telefone inválido/);
  assert.strictEqual(updateMember.mock.callCount(), 0);

  const ok = edit('+351912345678');
  await handlePanelInteraction(ok);
  assert.match(ok.calls.reply[0].content, /Dados atualizados/);
});

test('telefone é obrigatório no formulário', () => {
  const [, , , telefone] = buildRegisterModal(null).toJSON().components;
  assert.strictEqual(telefone.component.required, true);
});

test('botão Pontos explica quando a conta ainda está na lista de espera', async (t) => {
  stubDb(t, {
    getMember: async () => MEMBER,
    getAccounts: async () => [{ ...MAIN, status: 'espera' }],
  });
  const i = fakeInteraction({ customId: 'painel:pontos' });
  await handlePanelInteraction(i);
  assert.strictEqual(i.calls.showModal.length, 0);
  assert.match(i.calls.reply[0].content, /lista de espera/);
});

test('formulário de pontos rejeita texto e conta de outra pessoa', async (t) => {
  const setWeeklyPoints = t.mock.fn(async () => {});
  stubDb(t, {
    getAccount: async (id) => (id === 2 ? { ...SMURF, member_id: '99' } : MAIN),
    getActiveSeason: async () => SEASON,
    setWeeklyPoints,
    getSeasonTotal: async () => 500,
  });

  const bad = fakeInteraction({
    customId: 'painel:pontos-form:1',
    modal: true,
    text: { pontos: 'abc' },
    selects: { semana: ['2'] },
  });
  await handlePanelInteraction(bad);
  assert.match(bad.calls.reply[0].content, /só números/);

  const other = fakeInteraction({
    customId: 'painel:pontos-form',
    modal: true,
    text: { pontos: '100' },
    selects: { conta: ['2'], semana: ['2'] },
  });
  await handlePanelInteraction(other);
  assert.match(other.calls.reply[0].content, /Conta não encontrada/);
  assert.strictEqual(setWeeklyPoints.mock.callCount(), 0);

  const good = fakeInteraction({
    customId: 'painel:pontos-form:1',
    modal: true,
    text: { pontos: '500' },
    selects: { semana: ['2'] },
  });
  await handlePanelInteraction(good);
  assert.deepStrictEqual(setWeeklyPoints.mock.calls[0].arguments, [1, 1, 2, 500, '42']);
  assert.match(good.calls.reply[0].content, /MeuNick\*\* na semana 2 atualizados para \*\*500\*\*/);
});

test('Adicionar conta exige registro antes', async (t) => {
  stubDb(t, { getMember: async () => null });
  const i = fakeInteraction({ customId: 'painel:conta' });
  await handlePanelInteraction(i);
  assert.strictEqual(i.calls.showModal.length, 0);
  assert.match(i.calls.reply[0].content, /ainda não está registrado/);
});
