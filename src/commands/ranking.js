const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Mostra o ranking da temporada atual'),

  async execute(interaction) {
    const season = await db.getActiveSeason();
    if (!season) {
      await interaction.reply({
        content: 'Nenhuma temporada ativa configurada.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const ranking = await db.getRanking(season.id);
    if (ranking.length === 0) {
      await interaction.reply({
        content: 'Nenhum membro registrado ainda.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const finishers = ranking.filter((r) => r.completed_at);
    const others = ranking.filter((r) => !r.completed_at);

    const lines = [];

    if (finishers.length > 0) {
      lines.push('**🏆 Bateram o máximo (ordem de quem chegou primeiro):**');
      finishers.forEach((r, i) => {
        const date = new Date(r.completed_at).toLocaleDateString('pt-BR');
        lines.push(`${i + 1}. **${r.nick}** (${r.origem}) — ${r.total} pts — em ${date}`);
      });
      lines.push('');
    }

    if (others.length > 0) {
      lines.push('**Classificação geral:**');
      others.slice(0, 20).forEach((r, i) => {
        lines.push(
          `${finishers.length + i + 1}. **${r.nick}** (${r.origem}) — ${r.total}/${db.SEASON_TOTAL_MAX} pts`
        );
      });
    }

    const embed = new EmbedBuilder()
      .setTitle(`Ranking — ${season.name}`)
      .setDescription(lines.join('\n'))
      .setColor(0xf1c40f);

    await interaction.reply({ embeds: [embed] });
  },
};
