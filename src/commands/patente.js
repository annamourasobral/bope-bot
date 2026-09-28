const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { isOfficer } = require('../permissions');
const { RANK_NAMES, syncRankRole } = require('../ranks');
const {
  memberOption,
  respondMemberAutocomplete,
  getMemberId,
  NOT_FROM_LIST,
} = require('../member-option');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('patente')
    .setDescription('(Oficiais) Define a patente de um membro')
    .addStringOption((opt) => memberOption(opt, 'Membro a promover/rebaixar', true))
    .addStringOption((opt) =>
      opt
        .setName('patente')
        .setDescription('Nova patente')
        .setRequired(true)
        .addChoices(...RANK_NAMES.map((name) => ({ name, value: name })))
    ),

  autocomplete: respondMemberAutocomplete,

  async execute(interaction) {
    if (!isOfficer(interaction)) {
      await interaction.reply({
        content: 'Apenas oficiais podem alterar patentes.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetId = getMemberId(interaction);
    const patente = interaction.options.getString('patente');

    const member = await db.getMember(targetId);
    if (!member) {
      await interaction.reply({
        content: NOT_FROM_LIST,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await db.updateMember(targetId, { patente });
    await syncRankRole(interaction.guild, targetId, patente);

    await interaction.reply(
      `Patente de **${member.nome}** (<@${targetId}>) atualizada para **${patente}**.`
    );
  },
};
