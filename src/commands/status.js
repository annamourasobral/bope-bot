const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { isOfficer } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Mostra o status de um membro na guilda')
    .addUserOption((opt) =>
      opt.setName('membro').setDescription('Membro a consultar (padrão: você)').setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('membro') || interaction.user;
    const member = await db.getMember(targetUser.id);

    if (!member) {
      await interaction.reply({
        content: `<@${targetUser.id}> ainda não está registrado. Use \`/registrar\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const season = await db.getActiveSeason();
    if (!season) {
      await interaction.reply({
        content: 'Nenhuma temporada ativa configurada ainda.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const weekly = await db.getWeeklyPoints(member.discord_id, season.id);
    const total = await db.getSeasonTotal(member.discord_id, season.id);
    const currentWeek = db.currentWeekNumber(season);

    const weeksLine = Array.from({ length: db.WEEKS_PER_SEASON }, (_, i) => {
      const w = weekly.find((r) => r.week_number === i + 1);
      return `Semana ${i + 1}: ${w ? w.points : 0}/${db.WEEK_MAX}`;
    }).join('\n');

    const canSeePhone = targetUser.id === interaction.user.id || isOfficer(interaction);

    const embed = new EmbedBuilder()
      .setTitle(`Status de ${member.nick}`)
      .setColor(0x2b2d31)
      .addFields(
        { name: 'Nome', value: member.nome, inline: true },
        { name: 'Origem', value: member.origem, inline: true },
        { name: 'Patente', value: member.patente, inline: true },
        { name: 'Status', value: member.active ? 'Ativo' : 'Inativo', inline: true },
        {
          name: 'Temporada',
          value: `${season.name} (semana atual: ${currentWeek})`,
          inline: false,
        },
        { name: 'Pontos por semana', value: weeksLine, inline: false },
        { name: 'Total na temporada', value: `${total}/${db.SEASON_TOTAL_MAX}`, inline: false }
      );

    if (canSeePhone && member.telefone) {
      embed.addFields({ name: 'Telefone', value: member.telefone, inline: false });
    }

    await interaction.reply({
      embeds: [embed],
      flags: canSeePhone ? MessageFlags.Ephemeral : undefined,
    });
  },
};
