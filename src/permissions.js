const { PermissionFlagsBits } = require('discord.js');

function isOfficer(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }
  const officerRoleId = process.env.OFFICER_ROLE_ID;
  if (!officerRoleId) return false;
  return interaction.member.roles.cache.has(officerRoleId);
}

module.exports = { isOfficer };
