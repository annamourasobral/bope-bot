const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isOfficer } = require('../permissions');
const { resolveActiveAccount, savePoints, savePointsMessage } = require('../members');

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
    .addStringOption((opt) =>
      opt
        .setName('conta')
        .setDescription('Nick da conta, se tiver mais de uma (ex: sua smurf)')
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

    if (targetUser.id !== interaction.user.id && !isOfficer(interaction)) {
      await interaction.reply({
        content: 'Apenas oficiais podem registrar pontos de outro membro.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const target = await resolveActiveAccount(
      targetUser.id,
      interaction.options.getString('conta')
    );
    if (target.error) {
      await interaction.reply({ content: target.error, flags: MessageFlags.Ephemeral });
      return;
    }

    const result = await savePoints(
      target.account,
      interaction.options.getInteger('pontos'),
      interaction.options.getInteger('semana'),
      interaction.user.id
    );

    if (result.error) {
      await interaction.reply({ content: result.error, flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ content: savePointsMessage(result) });
  },
};
