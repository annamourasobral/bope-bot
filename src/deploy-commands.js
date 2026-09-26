require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { REST, Routes } = require('discord.js');

const commands = [];
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  commands.push(command.data.toJSON());
}

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('Defina DISCORD_TOKEN e CLIENT_ID no .env antes de rodar este script.');
  process.exit(1);
}

const rest = new REST().setToken(DISCORD_TOKEN);

async function main() {
  const route = GUILD_ID
    ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
    : Routes.applicationCommands(CLIENT_ID);

  console.log(
    GUILD_ID
      ? `Registrando ${commands.length} comandos no servidor ${GUILD_ID} (instantâneo)...`
      : `Registrando ${commands.length} comandos globalmente (pode levar até 1h para propagar)...`
  );

  await rest.put(route, { body: commands });
  console.log('Comandos registrados com sucesso.');
}

main().catch(console.error);
