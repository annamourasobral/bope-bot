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
const { notifySlotFree } = require('../members');
const {
  memberOption,
  respondMemberAutocomplete,
  getMemberId,
  NOT_FROM_LIST,
} = require('../member-option');

const DELETE_ACCOUNT_PREFIX = 'remover:apagar-conta:';
const DELETE_MEMBER_PREFIX = 'remover:apagar-pessoa:';
const CANCEL_ID = 'remover:cancelar';

const ONLY_OFFICERS = 'Apenas oficiais podem remover membros.';

function confirmRow(confirmId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(confirmId)
      .setLabel('Apagar definitivamente')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(CANCEL_ID).setLabel('Cancelar').setStyle(ButtonStyle.Secondary)
  );
}

// Desativa na hora; para apagar, responde com botões de confirmação. Usado pelo
// comando e pelo painel da staff. `nick` vazio = todas as contas da pessoa.
async function startRemoval(interaction, { discordId, nick, action }) {
  // O painel da staff já adiou a resposta (deferReply); o comando slash ainda não.
  const reply = (payload) =>
    interaction.deferred
      ? interaction.editReply(payload)
      : interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });

  const member = await db.getMember(discordId);
  if (!member) return reply({ content: NOT_FROM_LIST });

  const accounts = await db.getAccounts(discordId);
  const account = nick && accounts.find((a) => a.nick.toLowerCase() === nick.toLowerCase());
  if (nick && !account) {
    return reply({
      content: `<@${discordId}> não tem a conta **${nick}**. Contas: ${accounts.map((a) => a.nick).join(', ')}.`,
    });
  }

  if (action === 'desativar') {
    const changed = account
      ? [await db.deactivateAccount(account.id)].filter(Boolean)
      : await db.deactivateMember(discordId);
    await notifySlotFree(interaction.guild);
    const what = account
      ? `A conta **${account.nick}** foi desativada e saiu`
      : `As contas de **${member.nome}** foram desativadas e saíram`;
    return reply({
      content:
        changed.length === 0
          ? 'Nada mudou: já estava inativo.'
          : `${what} do ranking. O histórico foi mantido; a pessoa pode voltar com **➕ Adicionar conta** usando o mesmo nick (passa pela lista de espera se o registro estiver em aprovação).`,
    });
  }

  if (account && accounts.length > 1) {
    return reply({
      content: `Apagar a conta **${account.nick}** de ${member.nome} e **todos os pontos** dela? As outras contas continuam. Isso não pode ser desfeito.`,
      components: [confirmRow(`${DELETE_ACCOUNT_PREFIX}${account.id}`)],
    });
  }
  return reply({
    content: `Apagar **${member.nome}**, ${accounts.length === 1 ? 'a conta' : 'as contas'} ${accounts.map((a) => `**${a.nick}**`).join(', ')} e **todos os pontos**? O cargo de patente também será removido. Isso não pode ser desfeito.`,
    components: [confirmRow(`${DELETE_MEMBER_PREFIX}${discordId}`)],
  });
}

module.exports = {
  startRemoval,

  data: new SlashCommandBuilder()
    .setName('remover')
    .setDescription('(Oficiais) Desativa ou apaga uma conta ou todas as contas de um membro')
    .addStringOption((opt) => memberOption(opt, 'Membro a remover', true))
    .addStringOption((opt) =>
      opt
        .setName('acao')
        .setDescription('O que fazer')
        .setRequired(true)
        .addChoices(
          { name: 'Desativar (sai do ranking, mantém o histórico)', value: 'desativar' },
          { name: 'Apagar dados (definitivo, inclui os pontos)', value: 'apagar' }
        )
    )
    .addStringOption((opt) =>
      opt
        .setName('conta')
        .setDescription('Nick de uma conta só (ex: a smurf). Vazio = todas as contas')
        .setRequired(false)
    ),

  autocomplete: respondMemberAutocomplete,

  async execute(interaction) {
    if (!isOfficer(interaction)) {
      await interaction.reply({ content: ONLY_OFFICERS, flags: MessageFlags.Ephemeral });
      return;
    }
    await startRemoval(interaction, {
      discordId: getMemberId(interaction),
      nick: interaction.options.getString('conta'),
      action: interaction.options.getString('acao'),
    });
  },

  // Botões de confirmação (custom id começa com "remover:").
  async handleButton(interaction) {
    if (interaction.customId === CANCEL_ID) {
      await interaction.update({ content: 'Cancelado. Nada foi apagado.', components: [] });
      return;
    }

    if (!isOfficer(interaction)) {
      await interaction.reply({ content: ONLY_OFFICERS, flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.customId.startsWith(DELETE_ACCOUNT_PREFIX)) {
      const accountId = Number(interaction.customId.slice(DELETE_ACCOUNT_PREFIX.length));
      const result = await db.deleteAccount(accountId);
      if (!result) {
        await interaction.update({ content: 'Essa conta já tinha sido apagada.', components: [] });
        return;
      }
      const { account, memberDeleted } = result;
      if (memberDeleted) await syncRankRole(interaction.guild, account.member_id, null);
      console.log(
        `Conta ${account.nick} (${account.member_id}) apagada por ${interaction.user.id}`
      );
      await notifySlotFree(interaction.guild);
      await interaction.update({
        content: `A conta **${account.nick}** e os pontos dela foram apagados.`,
        components: [],
      });
      return;
    }

    if (interaction.customId.startsWith(DELETE_MEMBER_PREFIX)) {
      const discordId = interaction.customId.slice(DELETE_MEMBER_PREFIX.length);
      const deleted = await db.deleteMember(discordId);
      if (!deleted) {
        await interaction.update({ content: 'Esse membro já tinha sido apagado.', components: [] });
        return;
      }
      await syncRankRole(interaction.guild, discordId, null);
      console.log(`Membro ${discordId} (${deleted.nome}) apagado por ${interaction.user.id}`);
      await notifySlotFree(interaction.guild);
      await interaction.update({
        content: `**${deleted.nome}**, as contas e todos os pontos foram apagados.`,
        components: [],
      });
    }
  },
};
