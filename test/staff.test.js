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
  buildPicker,
  buildRegisterModal,
  buildAccountModal,
  buildPointsModal,
  buildRankChoice,
  buildRemoveChoice,
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

function fakeInteraction({
  customId,
  roles = [roleId('CORONEL')],
  manageGuild = false,
  values = [],
  text = {},
  users = [],
  selects = {},
  modal = false,
}) {
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
    isStringSelectMenu: () => values.length > 0,
    fields: {
      getTextInputValue: (id) => text[id],
      getStringSelectValues: (id) => selects[id] ?? [],
      getSelectedUsers: () => ({ first: () => users[0] }),
    },
    isFromMessage: () => modal,
    message: modal ? { flags: { has: () => true } } : undefined,
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
  buildRegisterModal().toJSON();
  buildAccountModal('42', 'Uma pessoa com um nome bem comprido demais para o título').toJSON();
  buildPointsModal(SEASON, account(1)).toJSON();
  const member = { discord_id: '42', nome: 'Anna', patente: 'SARGENTO' };
  buildRankChoice(member).components.forEach((c) => c.toJSON());
  buildRemoveChoice(member, [account(1), account(2, { is_main: false })]).components.forEach((c) =>
    c.toJSON()
  );
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

const PEOPLE = Array.from({ length: 30 }, (_, i) => ({
  discord_id: String(1000 + i),
  nome: `Pessoa ${i}`,
  patente: 'RECRUTA',
  main_nick: `Nick${i}`,
  accounts: i === 0 ? 2 : 1,
  active: 1,
}));

test('Patente, Remover, Pontos e Conta escolhem só entre pessoas registradas', async (t) => {
  const listPeople = t.mock.fn(async ({ offset, limit, search }) => ({
    people: PEOPLE.slice(offset, offset + limit),
    total: search ? 0 : PEOPLE.length,
  }));
  stubDb(t, { listPeople });

  for (const [customId, title] of [
    ['staff:patente', /Alterar patente/],
    ['staff:remover', /Remover/],
    ['staff:pontos', /Pontos de um membro/],
    ['staff:conta', /Adicionar conta/],
  ]) {
    const i = fakeInteraction({ customId });
    await handleStaffInteraction(i);
    const reply = i.calls.editReply[0];
    assert.match(reply.content, title);
    const select = reply.components[0].toJSON().components[0];
    assert.strictEqual(select.options.length, 25, customId);
    assert.strictEqual(select.options[0].value, '1000');
    assert.match(select.options[0].label, /^Nick0 \(\+1 smurf\) — Pessoa 0 · RECRUTA$/);
    assert.strictEqual(i.calls.showModal.length, 0, 'nenhum seletor de usuários do Discord');
  }
  assert.ok(listPeople.mock.calls.every((c) => c.arguments[0].search === null));
});

test('páginas e busca do seletor de membros', async (t) => {
  const listPeople = t.mock.fn(async ({ offset, limit }) => ({
    people: PEOPLE.slice(offset, offset + limit),
    total: PEOPLE.length,
  }));
  stubDb(t, { listPeople });

  const first = await buildPicker('patente', 1);
  const nav = first.components[1].toJSON().components;
  assert.deepStrictEqual(
    nav.map((b) => [b.custom_id, Boolean(b.disabled)]),
    [
      ['staff:escolher-pagina:patente:0:', true],
      ['staff:escolher-pagina:patente:2:', false],
      ['staff:escolher-busca:patente', false],
    ]
  );

  const page2 = fakeInteraction({ customId: 'staff:escolher-pagina:patente:2:malv:a' });
  await handleStaffInteraction(page2);
  assert.deepStrictEqual(listPeople.mock.calls.at(-1).arguments[0], {
    search: 'malv:a',
    offset: 25,
    limit: 25,
  });

  const search = fakeInteraction({
    customId: 'staff:escolher-busca-form:remover',
    modal: true,
    text: { busca: '  Malv ' },
  });
  await handleStaffInteraction(search);
  assert.strictEqual(search.calls.deferUpdate, 1, 'substitui a lista em vez de abrir outra');
  assert.strictEqual(listPeople.mock.calls.at(-1).arguments[0].search, 'Malv');

  const bogus = fakeInteraction({ customId: 'staff:escolher-pagina:qualquer:1:' });
  await handleStaffInteraction(bogus);
  assert.strictEqual(bogus.calls.editReply.length, 0, 'ação desconhecida é ignorada');
});

test('escolher o membro abre o segundo passo de cada ação', async (t) => {
  const member = { discord_id: '1000', nome: 'Anna', patente: 'SARGENTO' };
  const accounts = [
    account(1, { member_id: '1000' }),
    account(2, { member_id: '1000', is_main: false }),
  ];
  stubDb(t, {
    getMember: async () => member,
    getAccounts: async () => accounts,
    getActiveSeason: async () => SEASON,
  });

  const rank = fakeInteraction({ customId: 'staff:escolher:patente', values: ['1000'] });
  await handleStaffInteraction(rank);
  assert.strictEqual(
    rank.calls.editReply[0].components[0].toJSON().components[0].custom_id,
    'staff:patente-set:1000'
  );

  const remove = fakeInteraction({ customId: 'staff:escolher:remover', values: ['1000'] });
  await handleStaffInteraction(remove);
  const removeOptions = remove.calls.editReply[0].components[0]
    .toJSON()
    .components[0].options.map((o) => o.value);
  assert.deepStrictEqual(removeOptions, [
    'desativar:all',
    'desativar:1',
    'desativar:2',
    'apagar:all',
    'apagar:1',
    'apagar:2',
  ]);

  const points = fakeInteraction({ customId: 'staff:escolher:pontos', values: ['1000'] });
  await handleStaffInteraction(points);
  const choice = points.calls.editReply[0].components[0].toJSON().components[0];
  assert.deepStrictEqual(
    choice.options.map((o) => o.value),
    ['1', '2'],
    'duas contas ativas: pergunta qual'
  );

  const addAccount = fakeInteraction({ customId: 'staff:escolher:conta', values: ['1000'] });
  await handleStaffInteraction(addAccount);
  assert.strictEqual(addAccount.calls.showModal[0].custom_id, 'staff:conta-form:1000');
});

test('patente escolhida no menu é aplicada; valor inventado é recusado', async (t) => {
  const updateMember = t.mock.fn(async () => {});
  stubDb(t, {
    getMember: async () => ({ discord_id: '1000', nome: 'Anna', patente: 'SARGENTO' }),
    updateMember,
  });
  const ok = fakeInteraction({ customId: 'staff:patente-set:1000', values: ['TENENTE'] });
  await handleStaffInteraction(ok);
  assert.deepStrictEqual(updateMember.mock.calls[0].arguments, ['1000', { patente: 'TENENTE' }]);
  assert.match(ok.calls.editReply[0].content, /atualizada para \*\*TENENTE\*\*/);

  const bad = fakeInteraction({ customId: 'staff:patente-set:1000', values: ['GENERAL'] });
  await handleStaffInteraction(bad);
  assert.strictEqual(updateMember.mock.callCount(), 1);
});

test('remover uma conta pelo menu confere que a conta é daquela pessoa', async (t) => {
  const deactivateAccount = t.mock.fn(async () => account(2));
  stubDb(t, {
    getAccount: async (id) => account(id, { member_id: id === 2 ? '1000' : '9999' }),
    getMember: async () => ({ discord_id: '1000', nome: 'Anna' }),
    getAccounts: async () => [account(1, { member_id: '1000' }), account(2, { member_id: '1000' })],
    deactivateAccount,
    getAccountCounts: async () => ({ ativo: 10, espera: 0 }),
  });
  const other = fakeInteraction({ customId: 'staff:remover-set:1000', values: ['desativar:3'] });
  await handleStaffInteraction(other);
  assert.match(other.calls.editReply[0].content, /não existe mais/);
  assert.strictEqual(deactivateAccount.mock.callCount(), 0);

  const own = fakeInteraction({ customId: 'staff:remover-set:1000', values: ['desativar:2'] });
  await handleStaffInteraction(own);
  assert.deepStrictEqual(deactivateAccount.mock.calls[0].arguments, [2]);
});

test('registrar pela staff: já entra aprovado e recusa quem já está registrado', async (t) => {
  let args;
  let registered = false;
  stubDb(t, {
    getMember: async () =>
      registered ? { discord_id: '555', nome: 'Novo', patente: 'RECRUTA' } : null,
    registerMember: async (...a) => {
      args = a;
      registered = true;
      return {
        member: { discord_id: '555', nome: 'Novo', origem: 'PT', patente: 'RECRUTA' },
        accounts: [account(9, { member_id: '555' })],
      };
    },
  });
  const form = {
    customId: 'staff:registrar-form',
    users: [{ id: '555', bot: false }],
    text: { nome: 'Novo', nick: 'NovoNick', telefone: '+351912345678' },
    selects: { origem: ['PT'] },
  };
  const first = fakeInteraction(form);
  await handleStaffInteraction(first);
  assert.deepStrictEqual(args, [
    '555',
    { nome: 'Novo', origem: 'PT', telefone: '+351912345678', patente: null },
    ['NovoNick'],
    { approved: true },
  ]);
  assert.match(first.calls.editReply[0].content, /Registrado/);

  const again = fakeInteraction(form);
  await handleStaffInteraction(again);
  assert.match(again.calls.editReply[0].content, /já está registrado/);

  const bot = fakeInteraction({ ...form, users: [{ id: '777', bot: true }] });
  await handleStaffInteraction(bot);
  assert.match(bot.calls.editReply[0].content, /Bots não podem/);
});
