const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const db = require('../db');
const { isOfficer } = require('../permissions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('temporada')
    .setDescription('Gerencia temporadas da guilda')
    .addSubcommand((sub) =>
      sub
        .setName('nova')
        .setDescription('(Oficiais) Inicia uma nova temporada, encerrando a atual')
        .addStringOption((opt) =>
          opt.setName('nome').setDescription('Nome da temporada (ex: Temporada 3)').setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('inicio')
            .setDescription('Data de início (AAAA-MM-DD). Padrão: hoje')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName('atual').setDescription('Mostra a temporada ativa')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'atual') {
      const season = await db.getActiveSeason();
      if (!season) {
        await interaction.reply({ content: 'Nenhuma temporada ativa configurada.', flags: MessageFlags.Ephemeral });
        return;
      }
      const week = db.currentWeekNumber(season);
      await interaction.reply(
        `Temporada ativa: **${season.name}** (início: ${new Date(season.start_date).toLocaleDateString('pt-BR')}, semana atual: ${week}/${db.WEEKS_PER_SEASON})`
      );
      return;
    }

    if (sub === 'nova') {
      if (!isOfficer(interaction)) {
        await interaction.reply({ content: 'Apenas oficiais podem criar temporadas.', flags: MessageFlags.Ephemeral });
        return;
      }

      const nome = interaction.options.getString('nome');
      const inicioStr = interaction.options.getString('inicio');
      const inicio = inicioStr ? new Date(inicioStr) : new Date();

      if (Number.isNaN(inicio.getTime())) {
        await interaction.reply({ content: 'Data inválida. Use o formato AAAA-MM-DD.', flags: MessageFlags.Ephemeral });
        return;
      }

      const season = await db.createSeason(nome, inicio.toISOString().slice(0, 10));
      await interaction.reply(
        `Nova temporada criada: **${season.name}** a partir de ${new Date(season.start_date).toLocaleDateString('pt-BR')}. A temporada anterior foi encerrada.`
      );
    }
  },
};
