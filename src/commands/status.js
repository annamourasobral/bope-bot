const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { isOfficer } = require('../permissions');
const { buildStatusEmbed } = require('../members');
const {
  memberOption,
  respondMemberAutocomplete,
  getMemberId,
  NOT_FROM_LIST,
} = require('../member-option');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('status')
    .setDescription('Mostra o status de um membro na guilda')
    .addStringOption((opt) => memberOption(opt, 'Membro a consultar (padrão: você)', false)),

  autocomplete: respondMemberAutocomplete,

  async execute(interaction) {
    const chosenId = getMemberId(interaction);
    const targetUser = { id: chosenId || interaction.user.id };
    const member = await db.getMember(targetUser.id);

    if (!member) {
      await interaction.reply({
        content: chosenId
          ? NOT_FROM_LIST
          : 'Você ainda não está registrado. Use `/registrar` ou o painel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const season = await db.getActiveSeason();
    const canSeePhone = targetUser.id === interaction.user.id || isOfficer(interaction);
    const embed = await buildStatusEmbed(member, season, canSeePhone);

    await interaction.reply({
      embeds: [embed],
      flags: canSeePhone ? MessageFlags.Ephemeral : undefined,
    });
  },
};
