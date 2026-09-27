// Painel de membros: mensagem com botões que abrem formulários (modals), pensado
// para quem usa o Discord no celular. Usa as mesmas regras dos comandos slash.
const {
  ActionRowBuilder,
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
} = require('discord.js');
const db = require('./db');
const {
  NICK_MAX,
  saveMember,
  saveMemberMessage,
  addMemberAccount,
  addAccountMessage,
  resolveActiveAccount,
  savePoints,
  savePointsMessage,
  buildStatusEmbed,
} = require('./members');

const IDS = {
  register: 'painel:registrar',
  addAccount: 'painel:conta',
  points: 'painel:pontos',
  status: 'painel:status',
  registerForm: 'painel:registrar-form',
  editForm: 'painel:editar-form',
  addAccountForm: 'painel:conta-form',
  pointsForm: 'painel:pontos-form',
};

const NOT_REGISTERED =
  'Você ainda não está registrado. Toque em **📝 Registrar / editar** primeiro.';
const NO_SEASON = 'Nenhuma temporada ativa configurada.';

function buildPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('🪖 BØPE: Painel do membro')
    .setDescription(
      [
        'Toque num botão para começar. Só você vê as respostas.',
        '',
        '📝 **Registrar / editar**: nome, nick, origem, telefone (e smurf no primeiro registro)',
        '➕ **Adicionar conta**: registrar uma smurf depois',
        '🎯 **Pontos**: registrar os pontos da semana',
        '📊 **Meu status**: suas contas e pontos da temporada',
      ].join('\n')
    )
    .setColor(0x2b2d31);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(IDS.register)
      .setLabel('Registrar / editar')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(IDS.addAccount)
      .setLabel('Adicionar conta')
      .setEmoji('➕')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(IDS.points)
      .setLabel('Pontos')
      .setEmoji('🎯')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(IDS.status)
      .setLabel('Meu status')
      .setEmoji('📊')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embeds: [embed], components: [row] };
}

// Formulário de registro. Para quem já é membro vem preenchido e sem o campo de smurf
// (smurfs novas entram pelo botão Adicionar conta, para ninguém apagar uma sem querer).
function buildRegisterModal(member, mainNick) {
  const nome = new TextInputBuilder()
    .setCustomId('nome')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);
  const nick = new TextInputBuilder()
    .setCustomId('nick')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(NICK_MAX)
    .setRequired(true);
  const telefone = new TextInputBuilder()
    .setCustomId('telefone')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('+5511987654321')
    .setMaxLength(16)
    .setRequired(true);
  const origem = new StringSelectMenuBuilder()
    .setCustomId('origem')
    .setPlaceholder('Escolha BR ou PT')
    .setRequired(true)
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel('Brasil (BR)')
        .setValue('BR')
        .setDefault(member?.origem === 'BR'),
      new StringSelectMenuOptionBuilder()
        .setLabel('Portugal (PT)')
        .setValue('PT')
        .setDefault(member?.origem === 'PT')
    );

  if (member) {
    nome.setValue(member.nome);
    nick.setValue(mainNick || member.nick);
    if (member.telefone) telefone.setValue(member.telefone);
  }

  const labels = [
    new LabelBuilder()
      .setLabel('Nome')
      .setDescription('Aparece para os membros da guilda')
      .setTextInputComponent(nome),
    new LabelBuilder()
      .setLabel(member ? 'Nick da conta principal' : 'Nick no Wild Rift')
      .setTextInputComponent(nick),
    new LabelBuilder().setLabel('Servidor de origem').setStringSelectMenuComponent(origem),
    new LabelBuilder()
      .setLabel('Telefone')
      .setDescription('Com DDI, ex: +5511987654321. Só você e os oficiais veem.')
      .setTextInputComponent(telefone),
  ];

  if (!member) {
    labels.push(
      new LabelBuilder()
        .setLabel('Você tem smurf? Se sim, coloque o nick')
        .setDescription('Opcional. Mais de uma? Separe por vírgula: Conta2, Conta3')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('smurfs')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(150)
            .setRequired(false)
        )
    );
  }

  return new ModalBuilder()
    .setCustomId(member ? IDS.editForm : IDS.registerForm)
    .setTitle(member ? 'Editar registro' : 'Registro na BØPE')
    .addLabelComponents(...labels);
}

function buildAddAccountModal() {
  return new ModalBuilder()
    .setCustomId(IDS.addAccountForm)
    .setTitle('Adicionar conta (smurf)')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Nick da conta no Wild Rift')
        .setDescription('Conta desativada? Coloque o mesmo nick para ela voltar.')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('nick')
            .setStyle(TextInputStyle.Short)
            .setMaxLength(NICK_MAX)
            .setRequired(true)
        )
    );
}

function weekSelect(season) {
  const currentWeek = db.currentWeekNumber(season);
  return new StringSelectMenuBuilder()
    .setCustomId('semana')
    .setRequired(true)
    .addOptions(
      Array.from({ length: db.WEEKS_PER_SEASON }, (_, i) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(`Semana ${i + 1}${i + 1 === currentWeek ? ' (atual)' : ''}`)
          .setValue(String(i + 1))
          .setDefault(i + 1 === currentWeek)
      )
    );
}

function pointsInput() {
  return new TextInputBuilder()
    .setCustomId('pontos')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(`0 a ${db.WEEK_MAX}`)
    .setMaxLength(3)
    .setRequired(true);
}

// Com uma conta ativa, o id dela vai no custom id; com várias, o formulário pergunta qual.
function buildPointsModal(season, accounts) {
  const labels = [];
  if (accounts.length > 1) {
    labels.push(
      new LabelBuilder().setLabel('Conta').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('conta')
          .setRequired(true)
          .addOptions(
            accounts.map((a) =>
              new StringSelectMenuOptionBuilder()
                .setLabel(`${a.nick}${a.is_main ? ' (principal)' : ' (smurf)'}`)
                .setValue(String(a.id))
                .setDefault(a.is_main)
            )
          )
      )
    );
  }
  labels.push(
    new LabelBuilder().setLabel('Semana').setStringSelectMenuComponent(weekSelect(season)),
    new LabelBuilder()
      .setLabel('Pontos da semana')
      .setDescription(`Número de 0 a ${db.WEEK_MAX}`)
      .setTextInputComponent(pointsInput())
  );

  return new ModalBuilder()
    .setCustomId(accounts.length > 1 ? IDS.pointsForm : `${IDS.pointsForm}:${accounts[0].id}`)
    .setTitle(`Pontos: ${season.name}`.slice(0, 45))
    .addLabelComponents(...labels);
}

// Lê o campo de pontos do formulário. Retorna o número ou null se não for válido.
function readPoints(fields) {
  const raw = fields.getTextInputValue('pontos').trim();
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

function isPanelInteraction(interaction) {
  return (
    (interaction.isButton() || interaction.isModalSubmit()) &&
    interaction.customId.startsWith('painel:')
  );
}

function replyPrivately(interaction, payload) {
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function handlePanelInteraction(interaction) {
  const userId = interaction.user.id;
  const { customId } = interaction;

  if (customId === IDS.register) {
    const member = await db.getMember(userId);
    const main = member && (await db.getAccounts(userId)).find((a) => a.is_main);
    await interaction.showModal(buildRegisterModal(member, main?.nick));
    return;
  }

  if (customId === IDS.addAccount) {
    const member = await db.getMember(userId);
    if (!member) return replyPrivately(interaction, { content: NOT_REGISTERED });
    await interaction.showModal(buildAddAccountModal());
    return;
  }

  if (customId === IDS.points) {
    const member = await db.getMember(userId);
    if (!member) return replyPrivately(interaction, { content: NOT_REGISTERED });
    const active = (await db.getAccounts(userId)).filter((a) => a.status === 'ativo');
    if (active.length === 0) {
      const { error } = await resolveActiveAccount(userId);
      return replyPrivately(interaction, { content: error });
    }
    const season = await db.getActiveSeason();
    if (!season) return replyPrivately(interaction, { content: NO_SEASON });
    await interaction.showModal(buildPointsModal(season, active));
    return;
  }

  if (customId === IDS.status) {
    const member = await db.getMember(userId);
    if (!member) return replyPrivately(interaction, { content: NOT_REGISTERED });
    const season = await db.getActiveSeason();
    const embed = await buildStatusEmbed(member, season, true);
    return replyPrivately(interaction, { embeds: [embed] });
  }

  if (customId === IDS.registerForm || customId === IDS.editForm) {
    const { fields } = interaction;
    const result = await saveMember(interaction.guild, userId, {
      nome: fields.getTextInputValue('nome').trim(),
      nick: fields.getTextInputValue('nick').trim(),
      origem: fields.getStringSelectValues('origem')[0],
      telefone: fields.getTextInputValue('telefone').trim(),
      smurfs: customId === IDS.registerForm ? fields.getTextInputValue('smurfs') : undefined,
    });
    return replyPrivately(interaction, { content: result.error || saveMemberMessage(result) });
  }

  if (customId === IDS.addAccountForm) {
    const nick = interaction.fields.getTextInputValue('nick').trim();
    const result = await addMemberAccount(interaction.guild, userId, nick);
    return replyPrivately(interaction, { content: result.error || addAccountMessage(result) });
  }

  if (customId === IDS.pointsForm || customId.startsWith(`${IDS.pointsForm}:`)) {
    const { fields } = interaction;
    const points = readPoints(fields);
    if (points === null) {
      return replyPrivately(interaction, {
        content: `Digite só números, de 0 a ${db.WEEK_MAX}.`,
      });
    }
    const accountId = Number(
      customId === IDS.pointsForm
        ? fields.getStringSelectValues('conta')[0]
        : customId.slice(IDS.pointsForm.length + 1)
    );
    const account = await db.getAccount(accountId);
    // O id vem do formulário: confere se a conta é mesmo de quem enviou.
    if (!account || account.member_id !== userId) {
      return replyPrivately(interaction, { content: 'Conta não encontrada.' });
    }
    const week = Number(fields.getStringSelectValues('semana')[0]);
    const result = await savePoints(account, points, week, userId);
    return replyPrivately(interaction, { content: result.error || savePointsMessage(result) });
  }
}

module.exports = {
  buildPanelMessage,
  buildRegisterModal,
  buildAddAccountModal,
  buildPointsModal,
  weekSelect,
  pointsInput,
  readPoints,
  isPanelInteraction,
  handlePanelInteraction,
};
