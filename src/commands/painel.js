const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { isOfficer } = require('../permissions');
const { buildPanelMessage } = require('../panel');
const { buildStaffPanelMessage } = require('../staff-panel');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('painel')
    .setDescription('(Oficiais) Publica neste canal o painel com botões')
    .addStringOption((opt) =>
      opt
        .setName('tipo')
        .setDescription('Qual painel (padrão: membros)')
        .setRequired(false)
        .addChoices(
          { name: 'Membros', value: 'membros' },
          { name: 'Staff (use num canal só de oficiais)', value: 'staff' }
        )
    ),

  async execute(interaction) {
    if (!isOfficer(interaction)) {
      await interaction.reply({
        content: 'Apenas oficiais podem publicar o painel.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const staff = interaction.options.getString('tipo') === 'staff';

    try {
      await interaction.channel.send(staff ? buildStaffPanelMessage() : buildPanelMessage());
    } catch (error) {
      console.error('Não foi possível publicar o painel:', error.message);
      await interaction.reply({
        content:
          'Não consegui publicar o painel aqui. Verifique se o bot pode **ver o canal**, **enviar mensagens** e **inserir links** neste canal.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Avisos de lista de espera e vagas abertas vão para o canal do painel da staff.
    if (staff) await db.setSetting('staff_channel_id', interaction.channelId);

    await interaction.reply({
      content: staff
        ? 'Painel da staff publicado. Fixe a mensagem. Avisos de lista de espera e vagas abertas também vão chegar neste canal. Garanta que só oficiais vejam o canal.'
        : 'Painel publicado. Fixe a mensagem para os membros acharem fácil.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
