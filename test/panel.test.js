const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const {
  buildPanelMessage,
  buildRegisterModal,
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
  active: true,
};

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
      getTextInputValue: (id) => text[id] ?? '',
      getStringSelectValues: (id) => selects[id] ?? [],
    },
    reply: async (payload) => calls.reply.push(payload),
    showModal: async (m) => calls.showModal.push(m.toJSON()),
  };
}

test('painel e formulários passam na validação do Discord', () => {
  const panel = buildPanelMessage();
  panel.embeds.forEach((e) => e.toJSON());
  panel.components.forEach((c) => c.toJSON());
  buildRegisterModal(null).toJSON();
  buildRegisterModal(MEMBER).toJSON();
  buildPointsModal(SEASON).toJSON();
  buildPointsModal({ ...SEASON, name: 'Uma temporada com um nome muito, muito comprido' }).toJSON();
});

test('formulário de registro vem preenchido para quem já é membro', () => {
  const [nome, , origem, telefone] = buildRegisterModal(MEMBER).toJSON().components;
  assert.strictEqual(nome.component.value, 'Maria Silva');
  assert.strictEqual(telefone.component.value, '+351912345678');
  assert.deepStrictEqual(
    origem.component.options.filter((o) => o.default).map((o) => o.value),
    ['PT']
  );
});

test('só reconhece interações do painel', () => {
  assert.ok(isPanelInteraction(fakeInteraction({ customId: 'painel:status' })));
  assert.ok(!isPanelInteraction(fakeInteraction({ customId: 'outro-bot:x' })));
});

test('botão Pontos pede registro de quem não é membro', async (t) => {
  stubDb(t, { getMember: async () => null });
  const i = fakeInteraction({ customId: 'painel:pontos' });
  await handlePanelInteraction(i);
  assert.strictEqual(i.calls.showModal.length, 0);
  assert.match(i.calls.reply[0].content, /ainda não está registrado/);
});

test('formulário de registro cria o membro com os dados digitados', async (t) => {
  let created;
  stubDb(t, {
    getMember: async () => null,
    createMember: async (id, data) => {
      created = { discord_id: id, ...data };
      return { ...created, inserted: true };
    },
  });
  const i = fakeInteraction({
    customId: 'painel:registrar-form',
    modal: true,
    text: { nome: ' Maria Silva ', nick: 'MeuNick', telefone: '' },
    selects: { origem: ['BR'] },
  });
  await handlePanelInteraction(i);
  assert.deepStrictEqual(created, {
    discord_id: '42',
    nome: 'Maria Silva',
    nick: 'MeuNick',
    origem: 'BR',
    telefone: null,
  });
  assert.match(i.calls.reply[0].content, /Registrado/);
});

test('apagar o telefone no formulário remove o telefone', async (t) => {
  let updated;
  stubDb(t, {
    getMember: async () => MEMBER,
    updateMember: async (id, fields) => (updated = fields) && { ...MEMBER, ...fields },
  });
  const i = fakeInteraction({
    customId: 'painel:registrar-form',
    modal: true,
    text: { nome: 'Maria Silva', nick: 'MeuNick', telefone: '' },
    selects: { origem: ['PT'] },
  });
  await handlePanelInteraction(i);
  assert.strictEqual(updated.telefone, null);
});

test('formulário de pontos rejeita texto e aceita números', async (t) => {
  let saved;
  stubDb(t, {
    getMember: async () => MEMBER,
    getActiveSeason: async () => SEASON,
    setWeeklyPoints: async (...args) => (saved = args),
    getSeasonTotal: async () => 500,
  });

  const bad = fakeInteraction({
    customId: 'painel:pontos-form',
    modal: true,
    text: { pontos: 'abc' },
    selects: { semana: ['2'] },
  });
  await handlePanelInteraction(bad);
  assert.strictEqual(saved, undefined);
  assert.match(bad.calls.reply[0].content, /só números/);

  const good = fakeInteraction({
    customId: 'painel:pontos-form',
    modal: true,
    text: { pontos: '500' },
    selects: { semana: ['2'] },
  });
  await handlePanelInteraction(good);
  assert.deepStrictEqual(saved, ['42', 1, 2, 500, '42']);
  assert.match(good.calls.reply[0].content, /semana 2 atualizados para \*\*500\*\*/);
});
