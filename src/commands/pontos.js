const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { isOfficer } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pontos')
    .setDescription('Registra/atualiza seus pontos da semana (ou de outro membro, se oficial)')
    .addIntegerOption((opt) =>
      opt.setName('pontos').setDescription('Pontos da semana (0-600)').setRequired(true)
    )
    .addUserOption((opt) =>
      opt
        .setName('membro')
        .setDescription('(Oficiais) atualizar outro membro. Padrão: você')
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('semana')
        .setDescription('Semana da temporada (1-4). Padrão: semana atual')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('membro') || interaction.user;
    const points = interaction.options.getInteger('pontos');

    if (targetUser.id !== interaction.user.id && !isOfficer(interaction)) {
      await interaction.reply({
        content: 'Apenas oficiais podem registrar pontos de outro membro.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (points < 0 || points > db.WEEK_MAX) {
      await interaction.reply({
        content: `Pontos devem estar entre 0 e ${db.WEEK_MAX}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await db.getMember(targetUser.id);
    if (!member) {
      await interaction.reply({
        content: `<@${targetUser.id}> ainda não está registrado. Peça para usar \`/registrar\` primeiro.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const season = await db.getActiveSeason();
    if (!season) {
      await interaction.reply({ content: 'Nenhuma temporada ativa configurada.', flags: MessageFlags.Ephemeral });
      return;
    }

    const week = interaction.options.getInteger('semana') || db.currentWeekNumber(season);
    if (week < 1 || week > db.WEEKS_PER_SEASON) {
      await interaction.reply({
        content: `Semana deve estar entre 1 e ${db.WEEKS_PER_SEASON}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await db.setWeeklyPoints(member.discord_id, season.id, week, points, interaction.user.id);
    const total = await db.getSeasonTotal(member.discord_id, season.id);

    await interaction.reply({
      content: `Pontos de **${member.nick}** na semana ${week} atualizados para **${points}**. Total na temporada: ${total}/${db.SEASON_TOTAL_MAX}${
        total >= db.SEASON_TOTAL_MAX ? ' 🏆 (máximo atingido!)' : ''
      }`,
    });
  },
};
