// Painel da staff: lista de membros, lista de espera, pendências da semana, ranking,
// exportação e ações de oficial (registrar, contas, pontos, patente, remover, modo de
// registro). As ações escolhem o membro numa lista só com pessoas registradas.
// Toda interação confere se quem tocou é oficial, mesmo que o canal já seja restrito.
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require('discord.js');
const db = require('./db');
const { isOfficer } = require('./permissions');
const { RANK_NAMES, syncRankRole } = require('./ranks');
const {
  NICK_MAX,
  PHONE_PLACEHOLDER,
  ORIGIN_LABEL,
  ruleErrorMessage,
  describeStatus,
  onAccountsActivated,
  saveMember,
  saveMemberMessage,
  addMemberAccount,
  addAccountMessage,
  savePoints,
  savePointsMessage,
} = require('./members');
const { personLabel } = require('./member-option');
const { weekSelect, pointsInput, readPoints } = require('./panel');
const { accountLine, mainNicksFor } = require('./commands/membros');
const { buildRankingEmbed } = require('./commands/ranking');
const { startRemoval } = require('./commands/remover');

const PREFIX = 'staff:';
const PAGE_SIZE = 15;
const ONLY_OFFICERS = 'Apenas oficiais podem usar o painel da staff.';

const IDS = {
  members: 'staff:membros',
  waitlist: 'staff:espera',
  missing: 'staff:sempontos',
  ranking: 'staff:ranking',
  export: 'staff:exportar',
  register: 'staff:registrar',
  addAccount: 'staff:conta',
  points: 'staff:pontos',
  rank: 'staff:patente',
  remove: 'staff:remover',
  mode: 'staff:registro',
  membersFilter: 'staff:membros-filtro',
  membersPage: 'staff:membros-pagina:', // + filtro:pagina
  waitlistSelect: 'staff:espera-select',
  waitlistBack: 'staff:espera-voltar',
  approve: 'staff:aprovar:', // + id da conta
  reject: 'staff:recusar:', // + id da conta
  setMode: 'staff:modo:', // + aberto | aprovacao
  registerForm: 'staff:registrar-form',
  // Escolha de membro registrado para uma ação (conta, pontos, patente, remover).
  pick: 'staff:escolher:', // + ação
  pickPage: 'staff:escolher-pagina:', // + ação:pagina:busca
  pickSearch: 'staff:escolher-busca:', // + ação
  pickSearchForm: 'staff:escolher-busca-form:', // + ação
  // Segundo passo de cada ação, já com o membro escolhido.
  accountForm: 'staff:conta-form:', // + discord id
  pointsAccount: 'staff:pontos-conta', // menu com as contas ativas
  pointsForm: 'staff:pontos-form:', // + id da conta
  rankSet: 'staff:patente-set:', // + discord id
  removeSet: 'staff:remover-set:', // + discord id
};

const ACTIONS = {
  conta: '➕ Adicionar conta (smurf)',
  pontos: '🎯 Pontos de um membro',
  patente: '🎖️ Alterar patente',
  remover: '🗑️ Remover',
};
const PICK_PAGE_SIZE = 25;
const SEARCH_MAX = 40;

const FILTERS = {
  ativo: 'Ativos',
  espera: 'Lista de espera',
  inativo: 'Inativos',
  todos: 'Todos',
};

const MODE_LABELS = {
  aberto: '🔓 Aberto (contas entram direto se houver vaga)',
  aprovacao: '🔒 Aprovação (toda conta nova vai para a lista de espera)',
};

function button(id, label, emoji, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(id).setLabel(label).setEmoji(emoji).setStyle(style);
}

function buildStaffPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('🛡️ BØPE: Painel da staff')
    .setDescription(
      [
        'Só oficiais (CAPITÃO, MAJOR, CORONEL) podem usar. As respostas só aparecem para você.',
        '',
        '👥 **Membros**: lista com pontos e telefone, filtros e páginas',
        '⏳ **Lista de espera**: aprovar ou recusar contas',
        '📭 **Sem pontos**: quem ainda não registrou pontos nesta semana',
        '🏆 **Ranking** · 📤 **Exportar**: planilha CSV com todas as contas',
        '📝 **Registrar**: registrar alguém do servidor (já entra aprovado)',
        '➕ **Conta** · 🎯 **Pontos** · 🎖️ **Patente** · 🗑️ **Remover**: ações num membro registrado',
        '⚙️ **Registro**: abrir o registro ou exigir aprovação',
      ].join('\n')
    )
    .setColor(0x992d22);

  const rows = [
    new ActionRowBuilder().addComponents(
      button(IDS.members, 'Membros', '👥', ButtonStyle.Primary),
      button(IDS.waitlist, 'Lista de espera', '⏳', ButtonStyle.Primary),
      button(IDS.missing, 'Sem pontos', '📭'),
      button(IDS.ranking, 'Ranking', '🏆'),
      button(IDS.export, 'Exportar', '📤')
    ),
    new ActionRowBuilder().addComponents(
      button(IDS.register, 'Registrar', '📝', ButtonStyle.Success),
      button(IDS.addAccount, 'Conta', '➕', ButtonStyle.Success),
      button(IDS.points, 'Pontos', '🎯', ButtonStyle.Success),
      button(IDS.rank, 'Patente', '🎖️', ButtonStyle.Success),
      button(IDS.remove, 'Remover', '🗑️', ButtonStyle.Danger)
    ),
    new ActionRowBuilder().addComponents(button(IDS.mode, 'Registro', '⚙️')),
  ];

  return { embeds: [embed], components: rows };
}

// --- Membros -----------------------------------------------------------------

async function buildMembersView(filter, page) {
  const accounts = await db.listAccounts(filter === 'todos' ? null : filter);
  const counts = await db.getAccountCounts();
  const season = await db.getActiveSeason();
  const totals = season ? await db.getSeasonTotals(season.id) : null;
  const mainNicks = await mainNicksFor();

  const totalPages = Math.max(1, Math.ceil(accounts.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 1), totalPages);
  const start = (current - 1) * PAGE_SIZE;
  const lines = accounts.slice(start, start + PAGE_SIZE).map((a, i) => {
    const line = accountLine(a, start + i + 1, { totals, mainNicks, showPhone: true });
    return filter === 'todos' ? `${line} — ${describeStatus(a)}` : line;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${FILTERS[filter]} (${accounts.length})`)
    .setDescription(lines.join('\n') || '_Ninguém aqui._')
    .setFooter({
      text: [
        `Ativas: ${counts.ativo}/${db.GUILD_MAX} contas · ${counts.pessoas} pessoas`,
        `Espera: ${counts.espera}`,
        `Inativas: ${counts.inativo}`,
        `Página ${current}/${totalPages}`,
      ].join(' · '),
    })
    .setColor(0x2b2d31);

  const filterRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(IDS.membersFilter).addOptions(
      Object.entries(FILTERS).map(([value, label]) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(label)
          .setValue(value)
          .setDefault(value === filter)
      )
    )
  );
  const pageRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IDS.membersPage}${filter}:${current - 1}`)
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current <= 1),
    new ButtonBuilder()
      .setCustomId(`${IDS.membersPage}${filter}:${current + 1}`)
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(current >= totalPages)
  );

  return { embeds: [embed], components: [filterRow, pageRow] };
}

// --- Lista de espera -----------------------------------------------------------

async function buildWaitlistView(notice) {
  const waitlist = await db.getWaitlist();
  const counts = await db.getAccountCounts();
  const free = db.GUILD_MAX - counts.ativo;

  const lines = waitlist.slice(0, 25).map((a, i) => {
    const since = new Date(a.status_changed_at).toLocaleDateString('pt-BR');
    return `${i + 1}. **${a.nick}**${a.is_main ? '' : ' (smurf)'} — ${a.nome} (${a.origem}) — <@${a.member_id}> — desde ${since}`;
  });
  if (waitlist.length > 25) lines.push(`… e mais ${waitlist.length - 25}`);

  const embed = new EmbedBuilder()
    .setTitle(`⏳ Lista de espera (${waitlist.length})`)
    .setDescription(lines.join('\n') || '_Ninguém esperando._')
    .setFooter({
      text: `Contas ativas: ${counts.ativo}/${db.GUILD_MAX} · ${free > 0 ? `${free} vaga(s) livre(s)` : 'guilda cheia'}`,
    })
    .setColor(0xe67e22);

  const components = [];
  if (waitlist.length > 0) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(IDS.waitlistSelect)
          .setPlaceholder('Escolha uma conta para aprovar ou recusar')
          .addOptions(
            waitlist
              .slice(0, 25)
              .map((a, i) =>
                new StringSelectMenuOptionBuilder()
                  .setLabel(`${i + 1}. ${a.nick} — ${a.nome}`.slice(0, 100))
                  .setValue(String(a.id))
              )
          )
      )
    );
  }

  return { content: notice || '', embeds: [embed], components };
}

async function buildWaitlistDecision(accountId) {
  const account = await db.getAccount(accountId);
  if (!account || account.status !== 'espera') {
    return buildWaitlistView('Essa conta não está mais na lista de espera.');
  }
  return {
    content: `**${account.nick}**${account.is_main ? '' : ' (smurf)'} — ${account.nome} (${account.origem}) — <@${account.member_id}>\nAprovar a entrada na guilda?`,
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(
        button(`${IDS.approve}${account.id}`, 'Aprovar', '✅', ButtonStyle.Success),
        button(`${IDS.reject}${account.id}`, 'Recusar', '❌', ButtonStyle.Danger),
        button(IDS.waitlistBack, 'Voltar', '↩️')
      ),
    ],
  };
}

// --- Sem pontos, exportação, modo de registro -----------------------------------

async function buildMissingPointsView() {
  const season = await db.getActiveSeason();
  if (!season) return { content: 'Nenhuma temporada ativa configurada.' };
  const week = db.currentWeekNumber(season);
  const accounts = await db.getAccountsWithoutPoints(season.id, week);

  const lines = [];
  let length = 0;
  for (const a of accounts) {
    const line = `• **${a.nick}** — <@${a.member_id}>`;
    // Limite de texto de um embed do Discord (4096), com folga.
    if (length + line.length > 3800) {
      lines.push(`… e mais ${accounts.length - lines.length}`);
      break;
    }
    lines.push(line);
    length += line.length + 1;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📭 Sem pontos na semana ${week} (${accounts.length})`)
    .setDescription(lines.join('\n') || '_Todo mundo já registrou os pontos desta semana._ 🎉')
    .setFooter({ text: season.name })
    .setColor(0x3498db);
  return { embeds: [embed] };
}

// Valores começando com = + - @ viram fórmula no Excel; o apóstrofo impede isso.
// Telefones (+55...) ficam como estão.
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=@]/.test(text) || /^[+-](?!\d+$)/.test(text)) text = `'${text}`;
  return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function buildExport() {
  const season = await db.getActiveSeason();
  const rows = await db.getExportRows(season?.id ?? null);
  const header = [
    'nick',
    'tipo',
    'status',
    'nome',
    'origem',
    'telefone',
    'patente',
    'discord_id',
    ...Array.from({ length: db.WEEKS_PER_SEASON }, (_, i) => `semana_${i + 1}`),
    'total',
  ];
  const lines = rows.map((r) =>
    [
      r.nick,
      r.is_main ? 'principal' : 'smurf',
      r.status,
      r.nome,
      r.origem,
      r.telefone,
      r.patente,
      r.member_id,
      ...Array.from({ length: db.WEEKS_PER_SEASON }, (_, i) => r[`semana${i + 1}`]),
      r.total,
    ]
      .map(csvCell)
      .join(';')
  );
  // BOM + ";" para o Excel em português abrir com acentos e colunas certas.
  const csv = `﻿${[header.join(';'), ...lines].join('\r\n')}\r\n`;
  const date = new Date().toISOString().slice(0, 10);
  return {
    content: `${rows.length} conta(s)${season ? ` · pontos da ${season.name}` : ''}. O arquivo tem telefones: não compartilhe fora da staff.`,
    files: [new AttachmentBuilder(Buffer.from(csv, 'utf8'), { name: `bope-membros-${date}.csv` })],
  };
}

async function buildModeView(notice) {
  const mode = await db.getRegistrationMode();
  return {
    content: [notice, `**Registro:** ${MODE_LABELS[mode]}`].filter(Boolean).join('\n'),
    components: [
      new ActionRowBuilder().addComponents(
        db.REGISTRATION_MODES.map((m) =>
          new ButtonBuilder()
            .setCustomId(`${IDS.setMode}${m}`)
            .setLabel(m === 'aberto' ? 'Abrir registro' : 'Exigir aprovação')
            .setEmoji(m === 'aberto' ? '🔓' : '🔒')
            .setStyle(m === mode ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setDisabled(m === mode)
        )
      ),
    ],
  };
}

// --- Escolher um membro registrado ----------------------------------------------------

// Lista paginada só com pessoas registradas (o seletor de usuários do Discord mostraria
// todo mundo do servidor).
async function buildPicker(action, page = 1, search = null) {
  const { people, total } = await db.listPeople({
    search,
    offset: (page - 1) * PICK_PAGE_SIZE,
    limit: PICK_PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PICK_PAGE_SIZE));
  const found = search ? ` com "${search}"` : '';
  const header = `**${ACTIONS[action]}**\n`;

  if (total === 0) {
    return {
      content: `${header}Nenhum membro registrado${found}.`,
      embeds: [],
      components: [
        new ActionRowBuilder().addComponents(
          button(`${IDS.pickSearch}${action}`, 'Buscar', '🔎'),
          ...(search ? [button(`${IDS.pickPage}${action}:1:`, 'Ver todos', '↩️')] : [])
        ),
      ],
    };
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${IDS.pick}${action}`)
    .setPlaceholder('Escolha o membro')
    .addOptions(
      people.map((p) =>
        new StringSelectMenuOptionBuilder().setLabel(personLabel(p)).setValue(p.discord_id)
      )
    );
  // A busca vai no custom id para as páginas continuarem filtradas.
  const pageId = (n) => `${IDS.pickPage}${action}:${n}:${search || ''}`;
  const nav = [
    new ButtonBuilder()
      .setCustomId(pageId(page - 1))
      .setEmoji('◀️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page <= 1),
    new ButtonBuilder()
      .setCustomId(pageId(page + 1))
      .setEmoji('▶️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page >= totalPages),
    button(`${IDS.pickSearch}${action}`, 'Buscar', '🔎'),
  ];
  if (search) nav.push(button(`${IDS.pickPage}${action}:1:`, 'Ver todos', '↩️'));

  return {
    content: `${header}Escolha o membro: ${total} registrado(s)${found} · página ${page}/${totalPages}`,
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(nav),
    ],
  };
}

function buildSearchModal(action) {
  return new ModalBuilder()
    .setCustomId(`${IDS.pickSearchForm}${action}`)
    .setTitle('Buscar membro')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Nick ou nome')
        .setDescription('Pode ser só um pedaço, ex: "malv"')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('busca')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(SEARCH_MAX)
            .setRequired(true)
        )
    );
}

// --- Formulários -------------------------------------------------------------------

function textInput(id, maxLength, { placeholder } = {}) {
  const input = new TextInputBuilder()
    .setCustomId(id)
    .setStyle(TextInputStyle.Short)
    .setMaxLength(maxLength)
    .setRequired(true);
  if (placeholder) input.setPlaceholder(placeholder);
  return input;
}

// Registrar alguém: é o único formulário que lista todo mundo do servidor, porque a
// pessoa ainda não está no banco. Quem já está registrado é recusado.
function buildRegisterModal() {
  return new ModalBuilder()
    .setCustomId(IDS.registerForm)
    .setTitle('Registrar membro')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Membro do Discord')
        .setUserSelectMenuComponent(
          new UserSelectMenuBuilder().setCustomId('membro').setRequired(true)
        ),
      new LabelBuilder()
        .setLabel('Nome real da pessoa')
        .setDescription('Nome e sobrenome, não o nick do jogo')
        .setTextInputComponent(textInput('nome', 100)),
      new LabelBuilder()
        .setLabel('Nick da conta principal')
        .setDescription('Smurfs: depois, pelo botão ➕ Conta')
        .setTextInputComponent(textInput('nick', NICK_MAX)),
      new LabelBuilder()
        .setLabel(ORIGIN_LABEL)
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('origem')
            .setRequired(true)
            .addOptions(
              new StringSelectMenuOptionBuilder().setLabel('Servidor BR').setValue('BR'),
              new StringSelectMenuOptionBuilder().setLabel('Servidor PT').setValue('PT')
            )
        ),
      new LabelBuilder()
        .setLabel('Telefone')
        .setDescription('Com o código do país do número que a pessoa usa hoje')
        .setTextInputComponent(textInput('telefone', 24, { placeholder: PHONE_PLACEHOLDER }))
    );
}

function buildAccountModal(discordId, nome) {
  return new ModalBuilder()
    .setCustomId(`${IDS.accountForm}${discordId}`)
    .setTitle(`Nova conta: ${nome}`.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Nick da conta no Wild Rift')
        .setDescription('Conta desativada da pessoa? Use o mesmo nick para ela voltar.')
        .setTextInputComponent(textInput('nick', NICK_MAX))
    );
}

function buildPointsModal(season, account) {
  return new ModalBuilder()
    .setCustomId(`${IDS.pointsForm}${account.id}`)
    .setTitle(`Pontos: ${account.nick}`.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder().setLabel('Semana').setStringSelectMenuComponent(weekSelect(season)),
      new LabelBuilder()
        .setLabel('Pontos da semana')
        .setDescription(`Número de 0 a ${db.WEEK_MAX}`)
        .setTextInputComponent(pointsInput())
    );
}

// --- Segundo passo de cada ação --------------------------------------------------------

function buildAccountChoice(accounts) {
  return {
    content: '**🎯 Pontos de um membro**\nQual conta?',
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(IDS.pointsAccount)
          .addOptions(
            accounts.map((a) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`${a.nick}${a.is_main ? ' (principal)' : ' (smurf)'}`)
                .setValue(String(a.id))
            )
          )
      ),
    ],
  };
}

function buildRankChoice(member) {
  return {
    content: `**🎖️ Alterar patente**\n**${member.nome}** (<@${member.discord_id}>) é **${member.patente}**. Nova patente:`,
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`${IDS.rankSet}${member.discord_id}`).addOptions(
          RANK_NAMES.map((name) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(name)
              .setValue(name)
              .setDefault(name === member.patente)
          )
        )
      ),
    ],
  };
}

// Opções já com o alvo: "desativar:all", "desativar:<id da conta>", "apagar:all", ...
function buildRemoveChoice(member, accounts) {
  const options = [];
  for (const action of ['desativar', 'apagar']) {
    const verb = action === 'desativar' ? 'Desativar' : 'Apagar';
    if (accounts.length > 1) {
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(`${verb} todas as contas`)
          .setValue(`${action}:all`)
      );
    }
    for (const a of accounts) {
      if (action === 'desativar' && a.status === 'inativo') continue;
      options.push(
        new StringSelectMenuOptionBuilder()
          .setLabel(`${verb} ${a.nick}${a.is_main ? ' (principal)' : ' (smurf)'}`.slice(0, 100))
          .setDescription(
            action === 'desativar'
              ? `Sai do ranking e libera a vaga (${describeStatus(a).replace(/^\S+ /, '')})`
              : 'Definitivo, inclui os pontos. Pede confirmação.'
          )
          .setValue(`${action}:${a.id}`)
      );
    }
  }
  return {
    content: `**🗑️ Remover**\n**${member.nome}** (<@${member.discord_id}>): o que fazer?`,
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${IDS.removeSet}${member.discord_id}`)
          .addOptions(options)
      ),
    ],
  };
}

// Membro escolhido na lista: abre o segundo passo da ação.
async function onPicked(interaction, action, discordId) {
  const member = await db.getMember(discordId);
  if (!member) {
    return updateInPlace(interaction, () => buildPicker(action));
  }
  const accounts = await db.getAccounts(discordId);

  if (action === 'conta') return interaction.showModal(buildAccountModal(discordId, member.nome));
  if (action === 'patente') return updateInPlace(interaction, () => buildRankChoice(member));
  if (action === 'remover') {
    return updateInPlace(interaction, () => buildRemoveChoice(member, accounts));
  }

  // pontos
  const season = await db.getActiveSeason();
  const active = accounts.filter((a) => a.status === 'ativo');
  if (!season || active.length === 0) {
    return updateInPlace(interaction, () => ({
      content: !season
        ? 'Nenhuma temporada ativa configurada.'
        : `**${member.nome}** não tem conta ativa (${accounts.map((a) => `${a.nick}: ${describeStatus(a)}`).join(', ')}).`,
      components: [],
    }));
  }
  if (active.length === 1) return interaction.showModal(buildPointsModal(season, active[0]));
  return updateInPlace(interaction, () => buildAccountChoice(active));
}

// --- Roteamento ------------------------------------------------------------------

function isStaffInteraction(interaction) {
  return (
    (interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit()) &&
    interaction.customId.startsWith(PREFIX)
  );
}

// Respostas novas só para quem tocou; `deferReply` dá tempo se o banco estiver acordando.
async function replyPrivately(interaction, build) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await interaction.editReply(await build());
}

// Navegação dentro de uma resposta já aberta (páginas, filtros, lista de espera).
async function updateInPlace(interaction, build) {
  await interaction.deferUpdate();
  await interaction.editReply(await build());
}

// Formulário aberto a partir de uma resposta (ex: depois de escolher o membro): o
// resultado substitui essa resposta. Aberto direto do painel: resposta nova.
function respond(interaction, build) {
  return interaction.isFromMessage?.() && interaction.message?.flags?.has(MessageFlags.Ephemeral)
    ? updateInPlace(interaction, build)
    : replyPrivately(interaction, build);
}

async function handleStaffInteraction(interaction) {
  if (!isOfficer(interaction)) {
    await interaction.reply({ content: ONLY_OFFICERS, flags: MessageFlags.Ephemeral });
    return;
  }
  const { customId } = interaction;

  switch (customId) {
    case IDS.members:
      return replyPrivately(interaction, () => buildMembersView('ativo', 1));
    case IDS.membersFilter:
      return updateInPlace(interaction, () => buildMembersView(interaction.values[0], 1));
    case IDS.waitlist:
      return replyPrivately(interaction, () => buildWaitlistView());
    case IDS.waitlistBack:
      return updateInPlace(interaction, () => buildWaitlistView());
    case IDS.waitlistSelect:
      return updateInPlace(interaction, () => buildWaitlistDecision(Number(interaction.values[0])));
    case IDS.missing:
      return replyPrivately(interaction, buildMissingPointsView);
    case IDS.ranking:
      return replyPrivately(interaction, async () => {
        const season = await db.getActiveSeason();
        if (!season) return { content: 'Nenhuma temporada ativa configurada.' };
        const ranking = await db.getRanking(season.id);
        if (ranking.length === 0) return { content: 'Nenhuma conta ativa ainda.' };
        return { embeds: [buildRankingEmbed(season, ranking)] };
      });
    case IDS.export:
      return replyPrivately(interaction, buildExport);
    case IDS.mode:
      return replyPrivately(interaction, () => buildModeView());
    case IDS.register:
      return interaction.showModal(buildRegisterModal());
    case IDS.registerForm:
      return replyPrivately(interaction, () => submitRegister(interaction));
    case IDS.addAccount:
      return replyPrivately(interaction, () => buildPicker('conta'));
    case IDS.points:
      return replyPrivately(interaction, () => buildPicker('pontos'));
    case IDS.rank:
      return replyPrivately(interaction, () => buildPicker('patente'));
    case IDS.remove:
      return replyPrivately(interaction, () => buildPicker('remover'));
    case IDS.pointsAccount: {
      const season = await db.getActiveSeason();
      const account = await db.getAccount(Number(interaction.values[0]));
      if (!season || account?.status !== 'ativo') {
        return updateInPlace(interaction, () => ({
          content: 'Essa conta não está mais ativa ou não há temporada ativa.',
          components: [],
        }));
      }
      return interaction.showModal(buildPointsModal(season, account));
    }
  }

  const action = (prefix) => customId.slice(prefix.length);

  if (customId.startsWith(IDS.membersPage)) {
    const [filter, page] = action(IDS.membersPage).split(':');
    return updateInPlace(interaction, () => buildMembersView(filter, Number(page)));
  }
  if (customId.startsWith(IDS.pickPage)) {
    const [pickAction, page, ...search] = action(IDS.pickPage).split(':');
    if (!ACTIONS[pickAction]) return;
    return updateInPlace(interaction, () =>
      buildPicker(pickAction, Number(page), search.join(':') || null)
    );
  }
  if (customId.startsWith(IDS.pickSearchForm)) {
    const pickAction = action(IDS.pickSearchForm);
    if (!ACTIONS[pickAction]) return;
    const search = interaction.fields.getTextInputValue('busca').trim().slice(0, SEARCH_MAX);
    return respond(interaction, () => buildPicker(pickAction, 1, search || null));
  }
  if (customId.startsWith(IDS.pickSearch)) {
    const pickAction = action(IDS.pickSearch);
    if (!ACTIONS[pickAction]) return;
    return interaction.showModal(buildSearchModal(pickAction));
  }
  if (customId.startsWith(IDS.pick)) {
    const pickAction = action(IDS.pick);
    if (!ACTIONS[pickAction]) return;
    return onPicked(interaction, pickAction, interaction.values[0]);
  }
  if (customId.startsWith(IDS.accountForm)) {
    const discordId = action(IDS.accountForm);
    const nick = interaction.fields.getTextInputValue('nick').trim();
    return respond(interaction, async () => {
      const result = await addMemberAccount(interaction.guild, discordId, nick, { approved: true });
      return { content: result.error || addAccountMessage(result), components: [] };
    });
  }
  if (customId.startsWith(IDS.pointsForm)) {
    const accountId = Number(action(IDS.pointsForm));
    return respond(interaction, () => submitPoints(interaction, accountId));
  }
  if (customId.startsWith(IDS.rankSet)) {
    const discordId = action(IDS.rankSet);
    return updateInPlace(interaction, () => setRank(interaction, discordId));
  }
  if (customId.startsWith(IDS.removeSet)) {
    const discordId = action(IDS.removeSet);
    const [removeAction, target] = interaction.values[0].split(':');
    await interaction.deferUpdate();
    const account = target === 'all' ? null : await db.getAccount(Number(target));
    if (target !== 'all' && account?.member_id !== discordId) {
      return interaction.editReply({ content: 'Essa conta não existe mais.', components: [] });
    }
    return startRemoval(interaction, {
      discordId,
      nick: account?.nick ?? null,
      action: removeAction,
    });
  }
  if (customId.startsWith(IDS.approve)) {
    const accountId = Number(action(IDS.approve));
    return updateInPlace(interaction, () => approve(interaction, accountId));
  }
  if (customId.startsWith(IDS.reject)) {
    const accountId = Number(action(IDS.reject));
    return updateInPlace(interaction, async () => {
      const account = await db.getAccount(accountId);
      if (!account || account.status !== 'espera') {
        return buildWaitlistView('Essa conta não está mais na lista de espera.');
      }
      await db.deactivateAccount(accountId);
      return buildWaitlistView(`❌ **${account.nick}** foi recusada e ficou inativa.`);
    });
  }
  if (customId.startsWith(IDS.setMode)) {
    const mode = action(IDS.setMode);
    if (!db.REGISTRATION_MODES.includes(mode)) return;
    return updateInPlace(interaction, async () => {
      await db.setSetting('registration_mode', mode);
      console.log(`Modo de registro: ${mode} (por ${interaction.user.id})`);
      return buildModeView('Modo de registro alterado.');
    });
  }
}

async function approve(interaction, accountId) {
  let account;
  try {
    account = await db.approveAccount(accountId);
  } catch (err) {
    return buildWaitlistView(ruleErrorMessage(err));
  }
  await onAccountsActivated(interaction.guild, account.member_id, [account]);
  console.log(`Conta ${account.nick} aprovada por ${interaction.user.id}`);
  return buildWaitlistView(`✅ **${account.nick}** (<@${account.member_id}>) aprovada e ativa.`);
}

async function submitRegister(interaction) {
  const { fields } = interaction;
  const user = fields.getSelectedUsers('membro', true).first();
  if (user.bot) return { content: 'Bots não podem ser registrados.' };
  if (await db.getMember(user.id)) {
    return {
      content: `<@${user.id}> já está registrado. Para editar os dados use \`/registrar membro:\`; para uma smurf, o botão ➕ Conta.`,
    };
  }
  const result = await saveMember(
    interaction.guild,
    user.id,
    {
      nome: fields.getTextInputValue('nome').trim(),
      nick: fields.getTextInputValue('nick').trim(),
      origem: fields.getStringSelectValues('origem')[0],
      telefone: fields.getTextInputValue('telefone').trim(),
    },
    { approved: true }
  );
  if (!result.error) console.log(`Membro ${user.id} registrado por ${interaction.user.id}`);
  return { content: result.error || saveMemberMessage(result) };
}

async function submitPoints(interaction, accountId) {
  const { fields } = interaction;
  const points = readPoints(fields);
  if (points === null) {
    return { content: `Digite só números, de 0 a ${db.WEEK_MAX}.`, components: [] };
  }
  const account = await db.getAccount(accountId);
  if (!account) return { content: 'Essa conta não existe mais.', components: [] };
  const week = Number(fields.getStringSelectValues('semana')[0]);
  const result = await savePoints(account, points, week, interaction.user.id);
  return { content: result.error || savePointsMessage(result), components: [] };
}

async function setRank(interaction, discordId) {
  const patente = interaction.values[0];
  if (!RANK_NAMES.includes(patente)) return { content: 'Patente inválida.', components: [] };
  const member = await db.getMember(discordId);
  if (!member) return { content: 'Esse membro não está mais registrado.', components: [] };
  await db.updateMember(discordId, { patente });
  await syncRankRole(interaction.guild, discordId, patente);
  console.log(`Patente de ${discordId}: ${patente} (por ${interaction.user.id})`);
  return {
    content: `Patente de **${member.nome}** (<@${discordId}>) atualizada para **${patente}**.`,
    components: [],
  };
}

module.exports = {
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
};
