// Regras de registro, pontos e status compartilhadas entre os comandos slash e o painel.
const { EmbedBuilder } = require('discord.js');
const db = require('./db');
const { DEFAULT_RANK, syncRankRole } = require('./ranks');

const PHONE_REGEX = /^\+\d{8,15}$/;

// Cria ou atualiza o registro de um membro. Campos `undefined` ficam como estão;
// `telefone: null` apaga o telefone. Retorna `{ error }` ou `{ member, created }`.
async function saveMember(guild, discordId, { nome, nick, origem, telefone }) {
  if (telefone && !PHONE_REGEX.test(telefone)) {
    return { error: 'Telefone inválido. Use o formato com DDI, ex: `+5511987654321`.' };
  }

  const existing = await db.getMember(discordId);

  if (!existing) {
    if (!nick || !nome || !origem) {
      return {
        error:
          'Primeiro registro precisa de **nome**, **nick** e **origem** (telefone é opcional). Ex: `/registrar nome:"Maria Silva" nick:MeuNick origem:BR`.',
      };
    }
    const member = await db.createMember(discordId, { nick, nome, origem, telefone });
    await syncRankRole(guild, discordId, DEFAULT_RANK);
    return { member, created: true };
  }

  const fields = {};
  if (nome) fields.nome = nome;
  if (nick) fields.nick = nick;
  if (origem) fields.origem = origem;
  if (telefone !== undefined) fields.telefone = telefone;

  if (Object.keys(fields).length === 0) {
    return { error: 'Informe ao menos um campo (nome, nick, origem ou telefone) para editar.' };
  }

  const member = await db.updateMember(discordId, fields);
  return { member, created: false };
}

function saveMemberMessage({ member, created }) {
  return created
    ? `Registrado: **${member.nome}** (nick: ${member.nick}, ${member.origem}) para <@${member.discord_id}>. Patente inicial: ${DEFAULT_RANK}.`
    : `Dados atualizados: **${member.nome}** (nick: ${member.nick}, ${member.origem}) para <@${member.discord_id}>.`;
}

// Registra os pontos de uma semana. Sem `week`, usa a semana atual da temporada.
// Retorna `{ error }` ou `{ member, week, points, total }`.
async function savePoints(discordId, points, week, updatedBy) {
  if (!Number.isInteger(points) || points < 0 || points > db.WEEK_MAX) {
    return { error: `Pontos devem estar entre 0 e ${db.WEEK_MAX}.` };
  }

  const member = await db.getMember(discordId);
  if (!member) {
    return { error: `<@${discordId}> ainda não está registrado. Faça o registro primeiro.` };
  }

  const season = await db.getActiveSeason();
  if (!season) {
    return { error: 'Nenhuma temporada ativa configurada.' };
  }

  const targetWeek = week || db.currentWeekNumber(season);
  if (targetWeek < 1 || targetWeek > db.WEEKS_PER_SEASON) {
    return { error: `Semana deve estar entre 1 e ${db.WEEKS_PER_SEASON}.` };
  }

  await db.setWeeklyPoints(member.discord_id, season.id, targetWeek, points, updatedBy);
  const total = await db.getSeasonTotal(member.discord_id, season.id);
  return { member, week: targetWeek, points, total };
}

function savePointsMessage({ member, week, points, total }) {
  return `Pontos de **${member.nick}** na semana ${week} atualizados para **${points}**. Total na temporada: ${total}/${db.SEASON_TOTAL_MAX}${
    total >= db.SEASON_TOTAL_MAX ? ' 🏆 (máximo atingido!)' : ''
  }`;
}

async function buildStatusEmbed(member, season, showPhone) {
  const weekly = await db.getWeeklyPoints(member.discord_id, season.id);
  const total = await db.getSeasonTotal(member.discord_id, season.id);
  const currentWeek = db.currentWeekNumber(season);

  const weeksLine = Array.from({ length: db.WEEKS_PER_SEASON }, (_, i) => {
    const w = weekly.find((r) => r.week_number === i + 1);
    return `Semana ${i + 1}: ${w ? w.points : 0}/${db.WEEK_MAX}`;
  }).join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`Status de ${member.nick}`)
    .setColor(0x2b2d31)
    .addFields(
      { name: 'Nome', value: member.nome, inline: true },
      { name: 'Origem', value: member.origem, inline: true },
      { name: 'Patente', value: member.patente, inline: true },
      { name: 'Status', value: member.active ? 'Ativo' : 'Inativo', inline: true },
      {
        name: 'Temporada',
        value: `${season.name} (semana atual: ${currentWeek})`,
        inline: false,
      },
      { name: 'Pontos por semana', value: weeksLine, inline: false },
      { name: 'Total na temporada', value: `${total}/${db.SEASON_TOTAL_MAX}`, inline: false }
    );

  if (showPhone && member.telefone) {
    embed.addFields({ name: 'Telefone', value: member.telefone, inline: false });
  }

  return embed;
}

module.exports = {
  PHONE_REGEX,
  saveMember,
  saveMemberMessage,
  savePoints,
  savePointsMessage,
  buildStatusEmbed,
};
