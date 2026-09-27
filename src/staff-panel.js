// Painel da staff: lista de membros, lista de espera, pendências da semana, ranking,
// exportação e ações de oficial (pontos, patente, remover, modo de registro).
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
  ruleErrorMessage,
  describeStatus,
  onAccountsActivated,
  savePoints,
  savePointsMessage,
} = require('./members');
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
  pointsForm: 'staff:pontos-form',
  rankForm: 'staff:patente-form',
  removeForm: 'staff:remover-form',
};

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
        '🎯 **Pontos** · 🎖️ **Patente** · 🗑️ **Remover**: ações em qualquer membro',
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
      button(IDS.points, 'Pontos', '🎯', ButtonStyle.Success),
      button(IDS.rank, 'Patente', '🎖️', ButtonStyle.Success),
      button(IDS.remove, 'Remover', '🗑️', ButtonStyle.Danger),
      button(IDS.mode, 'Registro', '⚙️')
    ),
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

// --- Formulários -------------------------------------------------------------------

function nickInput(required) {
  return new TextInputBuilder()
    .setCustomId('nick')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(NICK_MAX)
    .setRequired(required);
}

function memberSelect() {
  return new UserSelectMenuBuilder().setCustomId('membro').setRequired(true);
}

function buildPointsModal(season) {
  return new ModalBuilder()
    .setCustomId(IDS.pointsForm)
    .setTitle('Pontos de um membro')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Nick da conta')
        .setDescription('Principal ou smurf, como aparece na lista de membros')
        .setTextInputComponent(nickInput(true)),
      new LabelBuilder().setLabel('Semana').setStringSelectMenuComponent(weekSelect(season)),
      new LabelBuilder()
        .setLabel('Pontos da semana')
        .setDescription(`Número de 0 a ${db.WEEK_MAX}`)
        .setTextInputComponent(pointsInput())
    );
}

function buildRankModal() {
  return new ModalBuilder()
    .setCustomId(IDS.rankForm)
    .setTitle('Alterar patente')
    .addLabelComponents(
      new LabelBuilder().setLabel('Membro').setUserSelectMenuComponent(memberSelect()),
      new LabelBuilder().setLabel('Nova patente').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('patente')
          .setRequired(true)
          .addOptions(
            RANK_NAMES.map((name) =>
              new StringSelectMenuOptionBuilder().setLabel(name).setValue(name)
            )
          )
      )
    );
}

function buildRemoveModal() {
  return new ModalBuilder()
    .setCustomId(IDS.removeForm)
    .setTitle('Remover membro')
    .addLabelComponents(
      new LabelBuilder().setLabel('Membro').setUserSelectMenuComponent(memberSelect()),
      new LabelBuilder()
        .setLabel('Conta (opcional)')
        .setDescription('Nick de uma conta só, ex: a smurf. Vazio = todas as contas.')
        .setTextInputComponent(nickInput(false)),
      new LabelBuilder()
        .setLabel('Ação')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('acao')
            .setRequired(true)
            .addOptions(
              new StringSelectMenuOptionBuilder()
                .setLabel('Desativar')
                .setDescription('Sai do ranking e libera a vaga; histórico mantido')
                .setValue('desativar'),
              new StringSelectMenuOptionBuilder()
                .setLabel('Apagar dados')
                .setDescription('Definitivo, inclui os pontos. Pede confirmação.')
                .setValue('apagar')
            )
        )
    );
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
    case IDS.points: {
      const season = await db.getActiveSeason();
      if (!season) {
        return interaction.reply({
          content: 'Nenhuma temporada ativa configurada.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return interaction.showModal(buildPointsModal(season));
    }
    case IDS.rank:
      return interaction.showModal(buildRankModal());
    case IDS.remove:
      return interaction.showModal(buildRemoveModal());
    case IDS.pointsForm:
      return replyPrivately(interaction, () => submitPoints(interaction));
    case IDS.rankForm:
      return replyPrivately(interaction, () => submitRank(interaction));
    case IDS.removeForm: {
      const { fields } = interaction;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return startRemoval(interaction, {
        discordId: fields.getSelectedUsers('membro', true).first().id,
        nick: fields.getTextInputValue('nick').trim() || null,
        action: fields.getStringSelectValues('acao')[0],
      });
    }
  }

  if (customId.startsWith(IDS.membersPage)) {
    const [filter, page] = customId.slice(IDS.membersPage.length).split(':');
    return updateInPlace(interaction, () => buildMembersView(filter, Number(page)));
  }
  if (customId.startsWith(IDS.approve)) {
    const accountId = Number(customId.slice(IDS.approve.length));
    return updateInPlace(interaction, () => approve(interaction, accountId));
  }
  if (customId.startsWith(IDS.reject)) {
    const accountId = Number(customId.slice(IDS.reject.length));
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
    const mode = customId.slice(IDS.setMode.length);
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

async function submitPoints(interaction) {
  const { fields } = interaction;
  const points = readPoints(fields);
  if (points === null) return { content: `Digite só números, de 0 a ${db.WEEK_MAX}.` };
  const nick = fields.getTextInputValue('nick').trim();
  const account = await db.findAccountByNick(nick);
  if (!account) return { content: `Nenhuma conta com o nick **${nick}**.` };
  const week = Number(fields.getStringSelectValues('semana')[0]);
  const result = await savePoints(account, points, week, interaction.user.id);
  return { content: result.error || savePointsMessage(result) };
}

async function submitRank(interaction) {
  const { fields } = interaction;
  const user = fields.getSelectedUsers('membro', true).first();
  const patente = fields.getStringSelectValues('patente')[0];
  const member = await db.getMember(user.id);
  if (!member) return { content: `<@${user.id}> ainda não está registrado.` };
  await db.updateMember(user.id, { patente });
  await syncRankRole(interaction.guild, user.id, patente);
  return {
    content: `Patente de **${member.nome}** (<@${user.id}>) atualizada para **${patente}**.`,
  };
}

module.exports = {
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
};
