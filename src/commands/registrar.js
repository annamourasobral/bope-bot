const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { isOfficer } = require('../permissions');
const { DEFAULT_RANK, syncRankRole } = require('../ranks');

const PHONE_REGEX = /^\+\d{8,15}$/;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('registrar')
    .setDescription('Registra ou edita seu nome, nick, origem e telefone na guilda')
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
    .addUserOption((opt) =>
      opt
        .setName('membro')
        .setDescription('(Oficiais) registrar/editar outro membro')
        .setRequired(false)
    ),

  async execute(interaction) {
    const nome = interaction.options.getString('nome');
    const nick = interaction.options.getString('nick');
    const origem = interaction.options.getString('origem');
    const telefone = interaction.options.getString('telefone');
    const targetUser = interaction.options.getUser('membro');

    if (targetUser && targetUser.id !== interaction.user.id && !isOfficer(interaction)) {
      await interaction.reply({
        content: 'Apenas oficiais podem registrar ou editar outros membros.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (telefone && !PHONE_REGEX.test(telefone)) {
      await interaction.reply({
        content: 'Telefone inválido. Use o formato com DDI, ex: `+5511987654321`.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const discordId = (targetUser || interaction.user).id;
    const existing = await db.getMember(discordId);

    if (!existing) {
      if (!nick || !nome || !origem) {
        await interaction.reply({
          content:
            'Primeiro registro precisa de **nome**, **nick** e **origem** (telefone é opcional). Ex: `/registrar nome:"Maria Silva" nick:MeuNick origem:BR`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const member = await db.createMember(discordId, { nick, nome, origem, telefone });
      await syncRankRole(interaction.guild, discordId, DEFAULT_RANK);
      await interaction.reply({
        content: `Registrado: **${member.nome}** (nick: ${member.nick}, ${member.origem}) para <@${discordId}>. Patente inicial: ${DEFAULT_RANK}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const fields = {};
    if (nome) fields.nome = nome;
    if (nick) fields.nick = nick;
    if (origem) fields.origem = origem;
    if (telefone) fields.telefone = telefone;

    if (Object.keys(fields).length === 0) {
      await interaction.reply({
        content: 'Informe ao menos um campo (nome, nick, origem ou telefone) para editar.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await db.updateMember(discordId, fields);
    await interaction.reply({
      content: `Dados atualizados: **${member.nome}** (nick: ${member.nick}, ${member.origem}) para <@${discordId}>.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
