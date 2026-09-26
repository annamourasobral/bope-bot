const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { isOfficer } = require('../permissions');
const { RANK_NAMES, syncRankRole } = require('../ranks');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('patente')
    .setDescription('(Oficiais) Define a patente de um membro')
    .addUserOption((opt) =>
      opt.setName('membro').setDescription('Membro a promover/rebaixar').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('patente')
        .setDescription('Nova patente')
        .setRequired(true)
        .addChoices(...RANK_NAMES.map((name) => ({ name, value: name })))
    ),

  async execute(interaction) {
    if (!isOfficer(interaction)) {
      await interaction.reply({
        content: 'Apenas oficiais podem alterar patentes.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetUser = interaction.options.getUser('membro');
    const patente = interaction.options.getString('patente');

    const member = await db.getMember(targetUser.id);
    if (!member) {
      await interaction.reply({
        content: `<@${targetUser.id}> ainda não está registrado. Peça para usar \`/registrar\` primeiro.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await db.updateMember(targetUser.id, { patente });
    await syncRankRole(interaction.guild, targetUser.id, patente);

    await interaction.reply(
      `Patente de **${member.nome}** (<@${targetUser.id}>) atualizada para **${patente}**.`
    );
  },
};
