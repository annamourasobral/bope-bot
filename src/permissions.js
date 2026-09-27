const { PermissionFlagsBits } = require('discord.js');
const { RANKS } = require('./ranks');

// Patentes que gerenciam membros (aprovar, remover, editar pontos de outros...).
const OFFICER_RANKS = ['CAPITÃO', 'MAJOR', 'CORONEL'];
const OFFICER_RANK_ROLE_IDS = RANKS.filter((r) => OFFICER_RANKS.includes(r.name)).map(
  (r) => r.roleId
);

function hasRole(member, roleId) {
  const roles = member?.roles;
  if (!roles) return false;
  // GuildMember tem roles.cache; um membro vindo direto da API tem só um array de IDs.
  return roles.cache ? roles.cache.has(roleId) : roles.includes(roleId);
}

// Oficial = quem tem "Gerenciar Servidor", o cargo OFFICER_ROLE_ID (opcional) ou o
// cargo de CAPITÃO, MAJOR ou CORONEL.
function isOfficer(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }
  const roleIds = [...OFFICER_RANK_ROLE_IDS];
  if (process.env.OFFICER_ROLE_ID) roleIds.push(process.env.OFFICER_ROLE_ID);
  return roleIds.some((id) => hasRole(interaction.member, id));
}

module.exports = { isOfficer, OFFICER_RANKS };
