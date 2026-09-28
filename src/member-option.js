// Opção "membro" dos comandos slash: autocomplete que só sugere pessoas registradas,
// em vez do seletor de usuários do Discord (que lista todo mundo do servidor).
const db = require('./db');

// Uso: .addStringOption((opt) => memberOption(opt, 'Descrição', true))
function memberOption(opt, description, required) {
  return opt
    .setName('membro')
    .setDescription(description)
    .setRequired(required)
    .setAutocomplete(true);
}

function personLabel(person) {
  const extra = person.accounts > 1 ? ` (+${person.accounts - 1} smurf)` : '';
  return `${person.main_nick}${extra} — ${person.nome} · ${person.patente}`.slice(0, 100);
}

async function respondMemberAutocomplete(interaction) {
  const typed = interaction.options.getFocused().trim();
  const { people } = await db.listPeople({ search: typed || null, limit: 25 });
  await interaction.respond(people.map((p) => ({ name: personLabel(p), value: p.discord_id })));
}

// Discord ID escolhido na opção (ou null se ela ficou vazia). Se a pessoa digitou algo
// sem escolher da lista, o valor não será um ID registrado e o comando avisa.
function getMemberId(interaction) {
  return interaction.options.getString('membro')?.trim() || null;
}

const NOT_FROM_LIST =
  'Membro não encontrado. Escolha um nome **da lista** que aparece ao digitar (só membros registrados).';

module.exports = {
  memberOption,
  personLabel,
  respondMemberAutocomplete,
  getMemberId,
  NOT_FROM_LIST,
};
