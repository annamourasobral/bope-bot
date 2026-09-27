const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/db');
const { isOfficer } = require('../src/permissions');
const { RANKS } = require('../src/ranks');
const {
  buildStaffPanelMessage,
  buildMembersView,
  buildWaitlistView,
  buildExport,
  buildPointsModal,
  buildRankModal,
  buildRemoveModal,
  csvCell,
  isStaffInteraction,
  handleStaffInteraction,
} = require('../src/staff-panel');

const SEASON = { id: 1, name: 'Temporada 1', start_date: new Date().toISOString() };
const roleId = (name) => RANKS.find((r) => r.name === name).roleId;

function stubDb(t, stubs) {
  for (const [name, fn] of Object.entries(stubs)) {
    t.mock.method(db, name, fn);
  }
}

function account(i, extra = {}) {
  return {
    id: i,
    member_id: String(100 + i),
    nick: `Nick${i}`,
    is_main: true,
    status: 'ativo',
    status_changed_at: new Date().toISOString(),
    nome: `Pessoa ${i}`,
    origem: 'BR',
    telefone: '+5511987654321',
    patente: 'RECRUTA',
    ...extra,
  };
}

function fakeInteraction({ customId, roles = [], manageGuild = false, values = [] }) {
  const calls = { reply: [], editReply: [], showModal: [], deferReply: 0, deferUpdate: 0 };
  return {
    calls,
    customId,
    values,
    user: { id: '1' },
    guild: null,
    memberPermissions: { has: () => manageGuild },
    member: { roles: { cache: { has: (id) => roles.includes(id) } } },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    reply: async (p) => calls.reply.push(p),
    deferReply: async () => calls.deferReply++,
    deferUpdate: async () => calls.deferUpdate++,
    editReply: async (p) => calls.editReply.push(p),
    showModal: async (m) => calls.showModal.push(m.toJSON()),
  };
}

test('CAPITÃO, MAJOR e CORONEL são oficiais; SARGENTO não', () => {
  for (const rank of ['CAPITÃO', 'MAJOR', 'CORONEL']) {
    assert.ok(isOfficer(fakeInteraction({ roles: [roleId(rank)] })), rank);
  }
  assert.ok(!isOfficer(fakeInteraction({ roles: [roleId('SARGENTO')] })));
  assert.ok(isOfficer(fakeInteraction({ manageGuild: true })), 'Gerenciar Servidor');
  // Membro vindo direto da API: roles é um array de IDs.
  assert.ok(isOfficer({ member: { roles: [roleId('MAJOR')] } }));
});

test('quem não é oficial não usa nenhum botão da staff', async (t) => {
  const listAccounts = t.mock.fn(async () => []);
  stubDb(t, { listAccounts });
  for (const customId of [
    'staff:membros',
    'staff:exportar',
    'staff:aprovar:1',
    'staff:modo:aberto',
  ]) {
    const i = fakeInteraction({ customId, roles: [roleId('SARGENTO')] });
    await handleStaffInteraction(i);
    assert.match(i.calls.reply[0].content, /Apenas oficiais/, customId);
    assert.strictEqual(i.calls.deferReply, 0);
  }
  assert.strictEqual(listAccounts.mock.callCount(), 0);
});

test('painel e formulários da staff passam na validação do Discord', () => {
  const panel = buildStaffPanelMessage();
  panel.embeds.forEach((e) => e.toJSON());
  panel.components.forEach((c) => c.toJSON());
  buildPointsModal(SEASON).toJSON();
  buildRankModal().toJSON();
  buildRemoveModal().toJSON();
  assert.ok(isStaffInteraction(fakeInteraction({ customId: 'staff:membros' })));
});

test('lista de membros pagina de 15 em 15 com botões certos', async (t) => {
  const accounts = Array.from({ length: 20 }, (_, i) => account(i + 1));
  stubDb(t, {
    listAccounts: async () => accounts,
    getAccountCounts: async () => ({ ativo: 20, espera: 0, inativo: 0, pessoas: 20 }),
    getActiveSeason: async () => SEASON,
    getSeasonTotals: async () => new Map([[1, 1200]]),
  });
  const first = await buildMembersView('ativo', 1);
  const embed = first.embeds[0].toJSON();
  assert.strictEqual(embed.description.split('\n').length, 15);
  assert.match(
    embed.description,
    /Nick1\*\* — Pessoa 1 \(BR, RECRUTA\) — 1200\/2400 pts — \+5511987654321/
  );
  const [prev, next] = first.components[1].toJSON().components;
  assert.deepStrictEqual([prev.disabled, next.disabled], [true, false]);
  assert.strictEqual(next.custom_id, 'staff:membros-pagina:ativo:2');

  const second = await buildMembersView('ativo', 2);
  assert.strictEqual(second.embeds[0].toJSON().description.split('\n').length, 5);
  second.components.forEach((c) => c.toJSON());
});

test('lista de espera mostra a ordem e um menu para decidir', async (t) => {
  stubDb(t, {
    getWaitlist: async () => [
      account(1, { status: 'espera' }),
      account(2, { status: 'espera', is_main: false }),
    ],
    getAccountCounts: async () => ({ ativo: 140, espera: 2, inativo: 0, pessoas: 130 }),
  });
  const view = await buildWaitlistView();
  const embed = view.embeds[0].toJSON();
  assert.match(embed.description, /1\. \*\*Nick1\*\*/);
  assert.match(embed.description, /2\. \*\*Nick2\*\* \(smurf\)/);
  assert.match(embed.footer.text, /guilda cheia/);
  assert.strictEqual(view.components[0].toJSON().components[0].options.length, 2);
});

test('aprovar com a guilda cheia avisa em vez de aprovar', async (t) => {
  stubDb(t, {
    approveAccount: async () => {
      throw new db.RuleError('full');
    },
    getWaitlist: async () => [],
    getAccountCounts: async () => ({ ativo: 140, espera: 1, inativo: 0, pessoas: 140 }),
  });
  const i = fakeInteraction({ customId: 'staff:aprovar:5', roles: [roleId('CORONEL')] });
  await handleStaffInteraction(i);
  assert.strictEqual(i.calls.deferUpdate, 1);
  assert.match(i.calls.editReply[0].content, /guilda está cheia/);
});

test('trocar o modo de registro grava a configuração', async (t) => {
  const setSetting = t.mock.fn(async () => {});
  stubDb(t, { setSetting, getRegistrationMode: async () => 'aprovacao' });
  const i = fakeInteraction({ customId: 'staff:modo:aprovacao', roles: [roleId('MAJOR')] });
  await handleStaffInteraction(i);
  assert.deepStrictEqual(setSetting.mock.calls[0].arguments, ['registration_mode', 'aprovacao']);
  assert.match(i.calls.editReply[0].content, /Aprovação/);

  const bogus = fakeInteraction({ customId: 'staff:modo:qualquer', roles: [roleId('MAJOR')] });
  await handleStaffInteraction(bogus);
  assert.strictEqual(setSetting.mock.callCount(), 1, 'modo desconhecido é ignorado');
});

test('CSV não vira fórmula no Excel e mantém telefones', () => {
  assert.strictEqual(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.strictEqual(csvCell('@nick'), "'@nick");
  assert.strictEqual(csvCell('+5511987654321'), '+5511987654321');
  assert.strictEqual(csvCell('-5'), '-5');
  assert.strictEqual(csvCell('+cmd'), "'+cmd");
  assert.strictEqual(csvCell('a;b'), '"a;b"');
  assert.strictEqual(csvCell(null), '');
});

test('exportação gera um CSV com cabeçalho e uma linha por conta', async (t) => {
  stubDb(t, {
    getActiveSeason: async () => SEASON,
    getExportRows: async () => [
      { ...account(1), semana1: 600, semana2: 0, semana3: 0, semana4: 0, total: 600 },
      {
        ...account(2, { is_main: false, telefone: null }),
        semana1: 0,
        semana2: 0,
        semana3: 0,
        semana4: 0,
        total: 0,
      },
    ],
  });
  const result = await buildExport();
  const csv = result.files[0].attachment.toString('utf8');
  const lines = csv.trim().split('\r\n');
  assert.ok(csv.startsWith('﻿nick;tipo;status'));
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(
    lines[1],
    'Nick1;principal;ativo;Pessoa 1;BR;+5511987654321;RECRUTA;101;600;0;0;0;600'
  );
  assert.match(lines[2], /^Nick2;smurf;ativo;Pessoa 2;BR;;RECRUTA;102;/);
  assert.match(result.content, /não compartilhe/);
});
