const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const db = require('../db');

const PAGE_SIZE = 20;

// Linha de uma conta na lista. Smurfs aparecem com o nick da conta principal.
function accountLine(account, index, { totals, mainNicks, showPhone }) {
  const smurfOf = account.is_main ? '' : ` _(smurf de ${mainNicks.get(account.member_id) || '?'})_`;
  const points = totals ? ` — ${totals.get(account.id) || 0}/${db.SEASON_TOTAL_MAX} pts` : '';
  const phone = showPhone && account.telefone ? ` — ${account.telefone}` : '';
  return `${index}. **${account.nick}**${smurfOf} — ${account.nome} (${account.origem}, ${account.patente})${points}${phone} — <@${account.member_id}>`;
}

// Nick da conta principal de cada pessoa, para mostrar "smurf de X".
async function mainNicksFor() {
  const all = await db.listAccounts();
  const byMember = new Map();
  for (const a of all) if (a.is_main) byMember.set(a.member_id, a.nick);
  return byMember;
}

module.exports = {
  PAGE_SIZE,
  accountLine,
  mainNicksFor,

  data: new SlashCommandBuilder()
    .setName('membros')
    .setDescription('Lista as contas ativas da guilda')
    .addIntegerOption((opt) =>
      opt.setName('pagina').setDescription('Número da página (padrão: 1)').setRequired(false)
    ),

  async execute(interaction) {
    const accounts = await db.listAccounts('ativo');

    if (accounts.length === 0) {
      await interaction.reply({
        content: 'Nenhum membro ativo ainda.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const counts = await db.getAccountCounts();
    const season = await db.getActiveSeason();
    const totals = season ? await db.getSeasonTotals(season.id) : null;
    const mainNicks = await mainNicksFor();

    const totalPages = Math.ceil(accounts.length / PAGE_SIZE);
    const page = Math.min(Math.max(interaction.options.getInteger('pagina') || 1, 1), totalPages);
    const start = (page - 1) * PAGE_SIZE;
    const lines = accounts
      .slice(start, start + PAGE_SIZE)
      .map((a, i) => accountLine(a, start + i + 1, { totals, mainNicks, showPhone: false }));

    const footer = [
      season?.name,
      counts.espera > 0 ? `${counts.espera} na lista de espera` : null,
      `Página ${page}/${totalPages}`,
    ].filter(Boolean);

    const embed = new EmbedBuilder()
      .setTitle(
        `Membros da BØPE: ${counts.ativo}/${db.GUILD_MAX} contas · ${counts.pessoas} pessoas`
      )
      .setDescription(lines.join('\n'))
      .setFooter({ text: footer.join(' · ') })
      .setColor(0x2b2d31);

    await interaction.reply({ embeds: [embed] });
  },
};
