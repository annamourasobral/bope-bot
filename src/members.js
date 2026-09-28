// Regras de registro, contas, pontos e status compartilhadas entre os comandos slash
// e os painéis.
const { EmbedBuilder } = require('discord.js');
const db = require('./db');
const { syncRankRole, rankFromRoles } = require('./ranks');

const PHONE_REGEX = /^\+\d{8,15}$/;
// Textos dos campos de telefone e origem. Os membros moram em vários países, então o
// telefone não tem nada a ver com a origem (servidor do jogo) e o exemplo não sugere país.
const PHONE_PLACEHOLDER = '+ código do país e número';
const PHONE_HINT = 'Com o código do país do número que você usa hoje. Só você e os oficiais veem.';
const ORIGIN_LABEL = 'Servidor do jogo (BR ou PT)';
const ORIGIN_HINT = 'Servidor do Wild Rift de onde você veio. Não é o país onde mora.';
const PHONE_INVALID =
  'Telefone inválido. Use **+**, o código do país do número que você usa hoje e o número, ex: `+351 912 345 678` ou `+55 11 98765 4321`.';

// "+351 912-345-678", "(+44) 7700 900123" ou "0044..." -> "+351912345678".
function normalizePhone(text) {
  if (typeof text !== 'string') return text;
  const compact = text.replace(/[\s\-().]/g, '');
  return compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
}
const NICK_MAX = 32;
// Principal + smurfs por pessoa.
const MAX_ACCOUNTS_PER_PERSON = 5;

// "Malvada, Outra" (vírgula, ponto e vírgula ou quebra de linha) -> ['Malvada', 'Outra']
function parseNicks(text) {
  if (!text) return [];
  return text
    .split(/[,;\n]/)
    .map((n) => n.trim())
    .filter(Boolean);
}

function validateNicks(nicks) {
  const tooLong = nicks.find((n) => n.length > NICK_MAX);
  if (tooLong) return `O nick **${tooLong}** é longo demais (máximo ${NICK_MAX} caracteres).`;
  const seen = new Set();
  for (const n of nicks) {
    if (seen.has(n.toLowerCase())) return `O nick **${n}** foi informado duas vezes.`;
    seen.add(n.toLowerCase());
  }
  return null;
}

// Converte um RuleError do banco numa mensagem para o usuário; outros erros sobem.
function ruleErrorMessage(err) {
  if (!(err instanceof db.RuleError)) throw err;
  switch (err.code) {
    case 'nick_taken':
      return `O nick **${err.nick}** já está registrado por <@${err.ownerId}>. Se for seu, fale com um oficial.`;
    case 'already_yours':
      return `A conta **${err.nick}** já é sua.`;
    case 'full':
      return `A guilda está cheia (${db.GUILD_MAX}/${db.GUILD_MAX}). Libere uma vaga antes de aprovar.`;
    case 'not_waiting':
      return 'Essa conta não está mais na lista de espera.';
    case 'not_active':
      return 'Essa conta não está ativa. Só contas ativas registram pontos.';
    default:
      throw err;
  }
}

// Acrescenta `position` (1, 2, ...) nas contas que estão na lista de espera.
async function withWaitPositions(accounts) {
  if (!accounts.some((a) => a.status === 'espera')) return accounts;
  const waitlist = await db.getWaitlist();
  const positions = new Map(waitlist.map((a, i) => [a.id, i + 1]));
  return accounts.map((a) => (a.status === 'espera' ? { ...a, position: positions.get(a.id) } : a));
}

function describeStatus(account) {
  if (account.status === 'ativo') return '✅ ativa';
  if (account.status === 'espera') {
    return `⏳ lista de espera${account.position ? ` (posição ${account.position})` : ''}`;
  }
  return '⛔ inativa';
}

function describeAccount(account) {
  return `**${account.nick}**${account.is_main ? ' ⭐' : ' (smurf)'}: ${describeStatus(account)}`;
}

// Avisos para o canal onde o painel da staff foi publicado. Best-effort.
async function notifyStaff(guild, content) {
  if (!guild) return;
  try {
    const channelId = await db.getSetting('staff_channel_id');
    if (!channelId) return;
    const channel = await guild.channels.fetch(channelId);
    await channel?.send({ content, allowedMentions: { parse: [] } });
  } catch (err) {
    console.warn('Não foi possível avisar a staff:', err.message);
  }
}

async function notifyWaiting(guild, accounts) {
  for (const a of accounts.filter((acc) => acc.status === 'espera')) {
    await notifyStaff(
      guild,
      `⏳ Nova conta na lista de espera: **${a.nick}** (<@${a.member_id}>)${a.position ? `, posição ${a.position}` : ''}. Aprove pelo painel da staff.`
    );
  }
}

// Depois de desativar/apagar: se abriu vaga e tem gente esperando, avisa a staff.
async function notifySlotFree(guild) {
  const counts = await db.getAccountCounts();
  if (counts.ativo >= db.GUILD_MAX || counts.espera === 0) return;
  const [next] = await db.getWaitlist();
  await notifyStaff(
    guild,
    `🔔 Vaga aberta (${counts.ativo}/${db.GUILD_MAX}). Próximo da lista de espera: **${next.nick}** (<@${next.member_id}>). Aprove pelo painel da staff.`
  );
}

// Quando uma conta fica ativa, a pessoa recebe o cargo da patente dela.
async function onAccountsActivated(guild, discordId, accounts) {
  if (!accounts.some((a) => a.status === 'ativo')) return;
  const member = await db.getMember(discordId);
  if (member) await syncRankRole(guild, discordId, member.patente);
}

// Cria ou atualiza o registro de uma pessoa. Campos `undefined` ficam como estão; o
// telefone é obrigatório e não pode ser apagado. `smurfs` é um texto com nicks separados
// por vírgula. `approved`: feito por um oficial, as contas não passam pela aprovação.
// Retorna `{ error }` ou `{ member, accounts, created }`.
async function saveMember(
  guild,
  discordId,
  { nome, nick, origem, telefone, smurfs },
  { approved = false } = {}
) {
  telefone = normalizePhone(telefone);
  if (telefone !== undefined && !PHONE_REGEX.test(telefone || '')) {
    return { error: PHONE_INVALID };
  }
  const smurfNicks = parseNicks(smurfs);
  const nickError = validateNicks([...(nick ? [nick] : []), ...smurfNicks]);
  if (nickError) return { error: nickError };

  let existing = await db.getMember(discordId);

  if (!existing) {
    if (!nick || !nome || !origem || !telefone) {
      return {
        error:
          'Primeiro registro precisa de **nome**, **nick**, **origem** e **telefone** (smurf é opcional). Ex: `/registrar nome:"Maria Silva" nick:MeuNick origem:BR telefone:+351912345678`.',
      };
    }
    if (1 + smurfNicks.length > MAX_ACCOUNTS_PER_PERSON) {
      return { error: `No máximo ${MAX_ACCOUNTS_PER_PERSON} contas por pessoa.` };
    }
    // Quem já tem cargo de patente no Discord mantém essa patente (não volta a RECRUTA).
    const patente = await rankFromRoles(guild, discordId);
    try {
      const result = await db.registerMember(
        discordId,
        { nome, origem, telefone, patente },
        [nick, ...smurfNicks],
        { approved }
      );
      if (result) {
        const accounts = await withWaitPositions(result.accounts);
        await onAccountsActivated(guild, discordId, accounts);
        await notifyWaiting(guild, accounts);
        return { member: result.member, accounts, created: true };
      }
    } catch (err) {
      return { error: ruleErrorMessage(err) };
    }
    // Outro envio registrou a pessoa ao mesmo tempo: segue como atualização.
    existing = await db.getMember(discordId);
  }

  const fields = {};
  if (nome) fields.nome = nome;
  if (origem) fields.origem = origem;
  if (telefone !== undefined) fields.telefone = telefone;

  let accounts = await db.getAccounts(discordId);
  const main = accounts.find((a) => a.is_main);
  const renameMain = nick && main && main.nick !== nick;

  if (Object.keys(fields).length === 0 && !renameMain && smurfNicks.length === 0) {
    return {
      error: 'Informe ao menos um campo (nome, nick, origem, telefone ou smurf) para editar.',
    };
  }
  if (accounts.length + smurfNicks.length > MAX_ACCOUNTS_PER_PERSON) {
    return { error: `No máximo ${MAX_ACCOUNTS_PER_PERSON} contas por pessoa.` };
  }

  try {
    if (renameMain) await db.renameAccount(main.id, nick);
    const added = [];
    for (const smurf of smurfNicks) {
      added.push((await db.addAccount(discordId, smurf, { approved })).account);
    }
    await onAccountsActivated(guild, discordId, added);
    await notifyWaiting(guild, await withWaitPositions(added));
  } catch (err) {
    return { error: ruleErrorMessage(err) };
  }

  const member = await db.updateMember(discordId, fields);
  accounts = await withWaitPositions(await db.getAccounts(discordId));
  return { member, accounts, created: false };
}

function saveMemberMessage({ member, accounts, created }) {
  const lines = [
    created
      ? `Registrado: **${member.nome}** (${member.origem}) para <@${member.discord_id}>.`
      : `Dados atualizados: **${member.nome}** (${member.origem}) para <@${member.discord_id}>.`,
    ...accounts.map((a) => `• ${describeAccount(a)}`),
  ];
  if (created && accounts.some((a) => a.status === 'ativo')) {
    lines.push(`Patente: ${member.patente}.`);
  }
  if (accounts.some((a) => a.status === 'espera')) {
    lines.push('Contas na lista de espera entram quando um oficial aprovar.');
  }
  return lines.join('\n');
}

// Adiciona uma smurf (ou traz de volta uma conta inativa da própria pessoa).
async function addMemberAccount(guild, discordId, nick, { approved = false } = {}) {
  const member = await db.getMember(discordId);
  if (!member) return { error: 'Faça o registro antes de adicionar contas.' };
  const nickError = validateNicks([nick]);
  if (nickError) return { error: nickError };
  const accounts = await db.getAccounts(discordId);
  const isOwn = accounts.some((a) => a.nick.toLowerCase() === nick.toLowerCase());
  if (!isOwn && accounts.length >= MAX_ACCOUNTS_PER_PERSON) {
    return { error: `No máximo ${MAX_ACCOUNTS_PER_PERSON} contas por pessoa.` };
  }

  let result;
  try {
    result = await db.addAccount(discordId, nick, { approved });
  } catch (err) {
    return { error: ruleErrorMessage(err) };
  }
  const [account] = await withWaitPositions([result.account]);
  await onAccountsActivated(guild, discordId, [account]);
  await notifyWaiting(guild, [account]);
  return { account, reactivated: result.reactivated };
}

function addAccountMessage({ account, reactivated }) {
  const verb = reactivated ? 'Conta de volta' : 'Conta adicionada';
  const extra = account.status === 'espera' ? '\nEla entra quando um oficial aprovar.' : '';
  return `${verb}: ${describeAccount(account)}${extra}`;
}

// Escolhe a conta que vai receber pontos. Sem nick, só funciona se a pessoa tiver
// uma única conta ativa. Retorna `{ account }` ou `{ error }`.
async function resolveActiveAccount(discordId, nick) {
  const member = await db.getMember(discordId);
  if (!member) {
    return { error: `<@${discordId}> ainda não está registrado. Faça o registro primeiro.` };
  }
  const accounts = await db.getAccounts(discordId);
  const active = accounts.filter((a) => a.status === 'ativo');

  if (nick) {
    const account = accounts.find((a) => a.nick.toLowerCase() === nick.toLowerCase());
    if (!account) return { error: `<@${discordId}> não tem a conta **${nick}**.` };
    if (account.status !== 'ativo') {
      return { error: `A conta **${account.nick}** não está ativa (${describeStatus(account)}).` };
    }
    return { account };
  }

  if (active.length === 1) return { account: active[0] };
  if (active.length === 0) {
    return {
      error: accounts.some((a) => a.status === 'espera')
        ? 'Sua conta ainda está na lista de espera. Pontos só depois que um oficial aprovar.'
        : 'Nenhuma conta ativa para registrar pontos.',
    };
  }
  return {
    error: `Mais de uma conta ativa (${active.map((a) => `**${a.nick}**`).join(', ')}). Informe qual em \`conta:\`.`,
  };
}

// Registra os pontos de uma semana numa conta. Sem `week`, usa a semana atual.
// Retorna `{ error }` ou `{ account, week, points, total }`.
async function savePoints(account, points, week, updatedBy) {
  if (!Number.isInteger(points) || points < 0 || points > db.WEEK_MAX) {
    return { error: `Pontos devem estar entre 0 e ${db.WEEK_MAX}.` };
  }

  const season = await db.getActiveSeason();
  if (!season) {
    return { error: 'Nenhuma temporada ativa configurada.' };
  }

  const targetWeek = week || db.currentWeekNumber(season);
  if (targetWeek < 1 || targetWeek > db.WEEKS_PER_SEASON) {
    return { error: `Semana deve estar entre 1 e ${db.WEEKS_PER_SEASON}.` };
  }

  try {
    await db.setWeeklyPoints(account.id, season.id, targetWeek, points, updatedBy);
  } catch (err) {
    return { error: ruleErrorMessage(err) };
  }
  const total = await db.getSeasonTotal(account.id, season.id);
  return { account, week: targetWeek, points, total };
}

function savePointsMessage({ account, week, points, total }) {
  return `Pontos de **${account.nick}** na semana ${week} atualizados para **${points}**. Total na temporada: ${total}/${db.SEASON_TOTAL_MAX}${
    total >= db.SEASON_TOTAL_MAX ? ' 🏆 (máximo atingido!)' : ''
  }`;
}

// Status de uma pessoa com todas as contas. `season` pode ser null.
async function buildStatusEmbed(member, season, showPhone) {
  const accounts = await withWaitPositions(await db.getAccounts(member.discord_id));
  const mainNick = accounts.find((a) => a.is_main)?.nick || member.nick;

  const embed = new EmbedBuilder()
    .setTitle(`Status de ${mainNick}`)
    .setColor(0x2b2d31)
    .addFields(
      { name: 'Nome', value: member.nome, inline: true },
      { name: 'Origem', value: member.origem, inline: true },
      { name: 'Patente', value: member.patente, inline: true }
    );

  if (season) {
    embed.addFields({
      name: 'Temporada',
      value: `${season.name} (semana atual: ${db.currentWeekNumber(season)})`,
      inline: false,
    });
  }

  for (const account of accounts) {
    const lines = [describeStatus(account)];
    if (season && account.status !== 'espera') {
      const weekly = await db.getWeeklyPoints(account.id, season.id);
      const weeks = Array.from({ length: db.WEEKS_PER_SEASON }, (_, i) => {
        const w = weekly.find((r) => r.week_number === i + 1);
        return `S${i + 1}: ${w ? w.points : 0}`;
      });
      const total = weekly.reduce((sum, r) => sum + r.points, 0);
      lines.push(`${weeks.join(' · ')}`, `Total: **${total}/${db.SEASON_TOTAL_MAX}**`);
    }
    embed.addFields({
      name: `${account.nick}${account.is_main ? ' ⭐ principal' : ' · smurf'}`,
      value: lines.join('\n'),
      inline: false,
    });
  }

  if (showPhone && member.telefone) {
    embed.addFields({ name: 'Telefone', value: member.telefone, inline: false });
  }

  return embed;
}

module.exports = {
  PHONE_REGEX,
  PHONE_PLACEHOLDER,
  PHONE_HINT,
  ORIGIN_LABEL,
  ORIGIN_HINT,
  normalizePhone,
  NICK_MAX,
  MAX_ACCOUNTS_PER_PERSON,
  parseNicks,
  ruleErrorMessage,
  withWaitPositions,
  describeStatus,
  describeAccount,
  notifyStaff,
  notifySlotFree,
  onAccountsActivated,
  saveMember,
  saveMemberMessage,
  addMemberAccount,
  addAccountMessage,
  resolveActiveAccount,
  savePoints,
  savePointsMessage,
  buildStatusEmbed,
};
