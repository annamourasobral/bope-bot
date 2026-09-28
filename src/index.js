require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { Client, GatewayIntentBits, Collection, MessageFlags } = require('discord.js');
const db = require('./db');
const { startHealthServer } = require('./health');
const { isPanelInteraction, handlePanelInteraction } = require('./panel');
const { isStaffInteraction, handleStaffInteraction } = require('./staff-panel');

const REQUIRED_ENV = ['DISCORD_TOKEN', 'DATABASE_URL'];
const missingEnv = REQUIRED_ENV.filter((name) => !process.env[name]);
if (missingEnv.length > 0) {
  console.error(`Variáveis de ambiente faltando: ${missingEnv.join(', ')}`);
  process.exit(1);
}

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
  // Sugestões enquanto a pessoa digita uma opção (ex: "membro"). Sem resposta de erro:
  // se falhar, o Discord só não mostra sugestões.
  if (interaction.isAutocomplete()) {
    const command = client.commands.get(interaction.commandName);
    try {
      await command?.autocomplete?.(interaction);
    } catch (error) {
      console.error(`Erro no autocomplete de /${interaction.commandName}:`, error.message);
    }
    return;
  }

  let run;
  let name;
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    run = () => command.execute(interaction);
    name = `/${interaction.commandName}`;
  } else if (isPanelInteraction(interaction)) {
    run = () => handlePanelInteraction(interaction);
    name = interaction.customId;
  } else if (isStaffInteraction(interaction)) {
    run = () => handleStaffInteraction(interaction);
    name = interaction.customId;
  } else if (interaction.isButton()) {
    // Botões de um comando usam o nome dele como prefixo, ex: "remover:apagar:123".
    const command = client.commands.get(interaction.customId.split(':')[0]);
    if (!command?.handleButton) return;
    run = () => command.handleButton(interaction);
    name = interaction.customId;
  } else {
    return;
  }

  try {
    await run();
  } catch (error) {
    console.error(`Erro ao executar ${name}:`, error);
    const payload = {
      content: 'Ocorreu um erro ao executar este comando.',
      flags: MessageFlags.Ephemeral,
    };
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
      } else {
        await interaction.reply(payload);
      }
    } catch (replyError) {
      console.error('Não foi possível avisar o usuário do erro:', replyError.message);
    }
  }
});

client.on('error', (error) => {
  console.error('Erro no cliente do Discord:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Promise rejeitada sem tratamento:', reason);
});

async function main() {
  if (process.env.PORT) {
    startHealthServer();
  }
  await db.init();
  const keepAliveMinutes = Number(process.env.DB_KEEPALIVE_MINUTES);
  if (keepAliveMinutes > 0) {
    db.startKeepAlive(keepAliveMinutes);
    console.log(`Keep-alive do banco ativo (a cada ${keepAliveMinutes} min)`);
  }
  await client.login(process.env.DISCORD_TOKEN);
}

main().catch((err) => {
  console.error('Falha ao iniciar o bot:', err);
  process.exit(1);
});
