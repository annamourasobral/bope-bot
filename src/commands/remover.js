const {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db = require('../db');
const { isOfficer } = require('../permissions');
const { syncRankRole } = require('../ranks');

const CONFIRM_PREFIX = 'remover:apagar:';
const CANCEL_ID = 'remover:cancelar';

module.exports = {
  data: new SlashCommandBuilder()
    .setName('remover')
    .setDescription('(Oficiais) Desativa um membro ou apaga todos os dados dele')
    .addUserOption((opt) =>
      opt.setName('membro').setDescription('Membro a remover').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('acao')
        .setDescription('O que fazer com o membro')
        .setRequired(true)
        .addChoices(
          { name: 'Desativar (sai do ranking, mantém o histórico)', value: 'desativar' },
          { name: 'Apagar dados (definitivo, inclui os pontos)', value: 'apagar' }
        )
    ),

  async execute(interaction) {
    if (!isOfficer(interaction)) {
      await interaction.reply({
        content: 'Apenas oficiais podem remover membros.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetUser = interaction.options.getUser('membro');
    const member = await db.getMember(targetUser.id);
    if (!member) {
      await interaction.reply({
        content: `<@${targetUser.id}> não está registrado.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.options.getString('acao') === 'desativar') {
      await db.updateMember(member.discord_id, { active: false });
      await interaction.reply({
        content: `**${member.nick}** foi desativado e saiu do ranking. O histórico foi mantido; se ele usar \`/registrar\` de novo, volta a ficar ativo.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${CONFIRM_PREFIX}${member.discord_id}`)
        .setLabel('Apagar definitivamente')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(CANCEL_ID)
        .setLabel('Cancelar')
        .setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      content: `Apagar **${member.nick}** (${member.nome}) e **todos os pontos** dele? O cargo de patente também será removido. Isso não pode ser desfeito.`,
      components: [row],
      flags: MessageFlags.Ephemeral,
    });
  },

  // Botões de confirmação enviados por este comando (custom id começa com "remover:").
  async handleButton(interaction) {
    if (interaction.customId === CANCEL_ID) {
      await interaction.update({ content: 'Cancelado. Nada foi apagado.', components: [] });
      return;
    }

    if (!isOfficer(interaction)) {
      await interaction.reply({
        content: 'Apenas oficiais podem remover membros.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const discordId = interaction.customId.slice(CONFIRM_PREFIX.length);
    const deleted = await db.deleteMember(discordId);
    if (!deleted) {
      await interaction.update({ content: 'Esse membro já tinha sido apagado.', components: [] });
      return;
    }

    await syncRankRole(interaction.guild, discordId, null);
    console.log(`Membro ${discordId} (${deleted.nick}) apagado por ${interaction.user.id}`);
    await interaction.update({
      content: `**${deleted.nick}** e todos os pontos dele foram apagados.`,
      components: [],
    });
  },
};
