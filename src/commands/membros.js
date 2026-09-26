const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../db');

const PAGE_SIZE = 20;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('membros')
    .setDescription('Lista os membros registrados na guilda')
    .addIntegerOption((opt) =>
      opt.setName('pagina').setDescription('Número da página (padrão: 1)').setRequired(false)
    ),

  async execute(interaction) {
    const members = await db.listMembers();

    if (members.length === 0) {
      await interaction.reply({
        content: 'Nenhum membro registrado ainda.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const totalPages = Math.ceil(members.length / PAGE_SIZE);
    const page = Math.min(Math.max(interaction.options.getInteger('pagina') || 1, 1), totalPages);
    const start = (page - 1) * PAGE_SIZE;
    const pageMembers = members.slice(start, start + PAGE_SIZE);

    const lines = pageMembers.map(
      (m, i) =>
        `${start + i + 1}. **${m.nick}** — ${m.nome} (${m.origem}, ${m.patente}) — <@${m.discord_id}>${
          m.active ? '' : ' _(inativo)_'
        }`
    );

    const embed = new EmbedBuilder()
      .setTitle(`Membros da BØPE (${members.length}/140)`)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `Página ${page}/${totalPages}` })
      .setColor(0x2b2d31);

    await interaction.reply({ embeds: [embed] });
  },
};
