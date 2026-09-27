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
  saveMember,
  saveMemberMessage,
  savePoints,
  savePointsMessage,
  buildStatusEmbed,
} = require('./members');

const IDS = {
  register: 'painel:registrar',
  points: 'painel:pontos',
  status: 'painel:status',
  registerForm: 'painel:registrar-form',
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
        '📝 **Registrar / editar**: nome, nick, origem e telefone',
        '🎯 **Pontos**: registrar os pontos da semana',
        '📊 **Meu status**: seus dados e pontos da temporada',
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

// Formulário de registro, já preenchido com os dados atuais quando o membro existe.
function buildRegisterModal(member) {
  const nome = new TextInputBuilder()
    .setCustomId('nome')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);
  const nick = new TextInputBuilder()
    .setCustomId('nick')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(32)
    .setRequired(true);
  const telefone = new TextInputBuilder()
    .setCustomId('telefone')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder('+5511987654321')
    .setMaxLength(16)
    .setRequired(false);
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
    nick.setValue(member.nick);
    if (member.telefone) telefone.setValue(member.telefone);
  }

  return new ModalBuilder()
    .setCustomId(IDS.registerForm)
    .setTitle(member ? 'Editar registro' : 'Registro na BØPE')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Nome')
        .setDescription('Aparece para os membros da guilda')
        .setTextInputComponent(nome),
      new LabelBuilder().setLabel('Nick no Wild Rift').setTextInputComponent(nick),
      new LabelBuilder().setLabel('Servidor de origem').setStringSelectMenuComponent(origem),
      new LabelBuilder()
        .setLabel('Telefone (opcional)')
        .setDescription('Com DDI. Só você e os oficiais veem.')
        .setTextInputComponent(telefone)
    );
}

function buildPointsModal(season) {
  const currentWeek = db.currentWeekNumber(season);

  const week = new StringSelectMenuBuilder()
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
  const points = new TextInputBuilder()
    .setCustomId('pontos')
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(`0 a ${db.WEEK_MAX}`)
    .setMaxLength(3)
    .setRequired(true);

  return new ModalBuilder()
    .setCustomId(IDS.pointsForm)
    .setTitle(`Pontos: ${season.name}`.slice(0, 45))
    .addLabelComponents(
      new LabelBuilder().setLabel('Semana').setStringSelectMenuComponent(week),
      new LabelBuilder()
        .setLabel('Pontos da semana')
        .setDescription(`Número de 0 a ${db.WEEK_MAX}`)
        .setTextInputComponent(points)
    );
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

  switch (interaction.customId) {
    case IDS.register: {
      const member = await db.getMember(userId);
      await interaction.showModal(buildRegisterModal(member));
      return;
    }

    case IDS.points: {
      const member = await db.getMember(userId);
      if (!member) return replyPrivately(interaction, { content: NOT_REGISTERED });
      const season = await db.getActiveSeason();
      if (!season) return replyPrivately(interaction, { content: NO_SEASON });
      await interaction.showModal(buildPointsModal(season));
      return;
    }

    case IDS.status: {
      const member = await db.getMember(userId);
      if (!member) return replyPrivately(interaction, { content: NOT_REGISTERED });
      const season = await db.getActiveSeason();
      if (!season) return replyPrivately(interaction, { content: NO_SEASON });
      const embed = await buildStatusEmbed(member, season, true);
      return replyPrivately(interaction, { embeds: [embed] });
    }

    case IDS.registerForm: {
      const { fields } = interaction;
      const result = await saveMember(interaction.guild, userId, {
        nome: fields.getTextInputValue('nome').trim(),
        nick: fields.getTextInputValue('nick').trim(),
        origem: fields.getStringSelectValues('origem')[0],
        // Campo vazio no formulário apaga o telefone.
        telefone: fields.getTextInputValue('telefone').trim() || null,
      });
      return replyPrivately(interaction, { content: result.error || saveMemberMessage(result) });
    }

    case IDS.pointsForm: {
      const { fields } = interaction;
      const raw = fields.getTextInputValue('pontos').trim();
      if (!/^\d+$/.test(raw)) {
        return replyPrivately(interaction, {
          content: `Digite só números, de 0 a ${db.WEEK_MAX}.`,
        });
      }
      const week = Number(fields.getStringSelectValues('semana')[0]);
      const result = await savePoints(userId, Number(raw), week, userId);
      return replyPrivately(interaction, { content: result.error || savePointsMessage(result) });
    }
  }
}

module.exports = {
  buildPanelMessage,
  buildRegisterModal,
  buildPointsModal,
  isPanelInteraction,
  handlePanelInteraction,
};
