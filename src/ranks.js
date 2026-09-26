// Patentes da guilda, da mais baixa para a mais alta.
// Os IDs de cargo (role) são do servidor oficial da BØPE (1510849075195543632).
const RANKS = [
  { name: 'RECRUTA', roleId: '1512926083748728963' },
  { name: 'SOLDADO', roleId: '1511019366966231210' },
  { name: 'SARGENTO', roleId: '1512858802578264225' },
  { name: 'TENENTE', roleId: '1512925918203478219' },
  { name: 'CAPITÃO', roleId: '1511019522688155749' },
  { name: 'MAJOR', roleId: '1511019626396516422' },
  { name: 'CORONEL', roleId: '1512836744989642805' },
];

const DEFAULT_RANK = RANKS[0].name;
const RANK_NAMES = RANKS.map((r) => r.name);
const RANK_ROLE_IDS = RANKS.map((r) => r.roleId);

function roleIdForRank(rankName) {
  return RANKS.find((r) => r.name === rankName)?.roleId;
}

// Aplica a patente como cargo no Discord: remove os outros cargos de patente
// e adiciona o correspondente. Best-effort — se o cargo não existir no servidor
// (ex: servidor de testes) ou o bot não tiver permissão, só loga e segue.
async function syncRankRole(guild, discordId, rankName) {
  if (!guild) return;
  try {
    const member = await guild.members.fetch(discordId);
    const targetRoleId = roleIdForRank(rankName);

    const rolesToRemove = RANK_ROLE_IDS.filter(
      (id) => id !== targetRoleId && member.roles.cache.has(id)
    );
    if (rolesToRemove.length > 0) {
      await member.roles.remove(rolesToRemove);
    }
    if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
      await member.roles.add(targetRoleId);
    }
  } catch (err) {
    console.warn(
      `Não foi possível sincronizar cargo de patente para ${discordId}:`,
      err.message
    );
  }
}

module.exports = {
  RANKS,
  DEFAULT_RANK,
  RANK_NAMES,
  syncRankRole,
};
