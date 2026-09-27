const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isOfficer } = require('../permissions');
const { buildPanelMessage } = require('../panel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('(Oficiais) Publica neste canal o painel com botões para os membros'),

  async execute(interaction) {
    if (!isOfficer(interaction)) {
      await interaction.reply({
        content: 'Apenas oficiais podem publicar o painel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await interaction.channel.send(buildPanelMessage());
    } catch (error) {
      console.error('Não foi possível publicar o painel:', error.message);
      await interaction.reply({
        content:
          'Não consegui publicar o painel aqui. Verifique se o bot pode **ver o canal**, **enviar mensagens** e **inserir links** neste canal.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: 'Painel publicado. Fixe a mensagem para os membros acharem fácil.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
