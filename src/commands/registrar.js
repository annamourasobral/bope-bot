const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { isOfficer } = require('../permissions');
const { saveMember, saveMemberMessage } = require('../members');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('registrar')
    .setDescription('Registra ou edita seu nome, nick, origem, telefone e smurfs na guilda')
    .addStringOption((opt) =>
      opt.setName('nome').setDescription('Seu nome real').setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('nick').setDescription('Seu nick no Wild Rift').setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('origem')
        .setDescription('Servidor de origem')
        .setRequired(false)
        .addChoices({ name: 'BR', value: 'BR' }, { name: 'PT', value: 'PT' })
    )
    .addStringOption((opt) =>
      opt
        .setName('telefone')
        .setDescription('Telefone com DDI, opcional (ex: +5511987654321)')
        .setRequired(false)
    )
    .addStringOption((opt) =>
      opt
        .setName('smurf')
        .setDescription('Nick da(s) sua(s) smurf(s), separados por vírgula. Opcional')
        .setRequired(false)
    )
    .addUserOption((opt) =>
      opt
        .setName('membro')
        .setDescription('(Oficiais) registrar/editar outro membro')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('membro');

    if (targetUser && targetUser.id !== interaction.user.id && !isOfficer(interaction)) {
      await interaction.reply({
        content: 'Apenas oficiais podem registrar ou editar outros membros.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = await saveMember(interaction.guild, (targetUser || interaction.user).id, {
      nome: interaction.options.getString('nome') ?? undefined,
      nick: interaction.options.getString('nick') ?? undefined,
      origem: interaction.options.getString('origem') ?? undefined,
      telefone: interaction.options.getString('telefone') ?? undefined,
      smurfs: interaction.options.getString('smurf') ?? undefined,
    });

    await interaction.reply({
      content: result.error || saveMemberMessage(result),
      flags: MessageFlags.Ephemeral,
    });
  },
};
