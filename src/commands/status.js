const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { isOfficer } = require('../permissions');
const { buildStatusEmbed } = require('../members');

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

    const canSeePhone = targetUser.id === interaction.user.id || isOfficer(interaction);
    const embed = await buildStatusEmbed(member, season, canSeePhone);

    await interaction.reply({
      embeds: [embed],
      flags: canSeePhone ? MessageFlags.Ephemeral : undefined,
    });
  },
};
