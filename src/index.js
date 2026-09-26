require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, MessageFlags, ActivityType } = require('discord.js');
const db = require('./db');
const { startHealthServer } = require('./health');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  presence: {
    status: 'online',
  },
});
client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter((f) => f.endsWith('.js'))) {
  const command = require(path.join(commandsPath, file));
  client.commands.set(command.data.name, command);
}

client.once('clientReady', () => {
  console.log(`Bot conectado como ${client.user.tag}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`Erro ao executar /${interaction.commandName}:`, error);
    const payload = {
      content: 'Ocorreu um erro ao executar este comando.',
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
});

async function main() {
  if (process.env.PORT) {
    startHealthServer();
  }
  await db.init();
  await client.login(process.env.DISCORD_TOKEN);
}

main().catch((err) => {
  console.error('Falha ao iniciar o bot:', err);
  process.exit(1);
});
