# BØPE Bot

Bot Discord para gestão da guilda **BØPE** (Wild Rift).

## Funcionalidades

### Pessoas, contas e smurfs

Cada **pessoa** (usuário do Discord) tem nome, origem, telefone e patente, e pode ter até **5 contas do jogo**: a principal (⭐) e smurfs. Pontos, ranking e o limite da guilda são **por conta**: quem tem duas contas ocupa duas vagas e aparece duas vezes no ranking. Nicks são únicos na guilda (sem diferenciar maiúsculas).

Cada conta tem um status:

- **✅ ativa** — ocupa vaga, registra pontos, aparece no ranking
- **⏳ lista de espera** — aguarda aprovação de um oficial; não pontua
- **⛔ inativa** — saiu da guilda; o histórico fica guardado

A guilda tem no máximo **140 contas ativas**. O modo de registro é escolhido no painel da staff (⚙️ Registro):

- **🔓 Aberto** — conta nova entra ativa se houver vaga; se a guilda estiver cheia, vai para a lista de espera. Use na semana de registro inicial.
- **🔒 Aprovação** — toda conta nova (inclusive smurf nova) vai para a lista de espera e um oficial aprova. Use no dia a dia, para quem não é da guilda não ocupar vaga.

Quando uma conta é desativada ou apagada e há gente esperando, o bot avisa no canal da staff quem é o próximo da fila.

Regras de pontos: máximo **600 pontos/semana** por conta, **4 semanas por temporada**, total máximo **2400 pontos** por conta.

### Oficiais

São oficiais quem tem o cargo **CAPITÃO**, **MAJOR** ou **CORONEL** (IDs em [src/ranks.js](src/ranks.js)), quem tem a permissão "Gerenciar Servidor" e, opcionalmente, quem tem o cargo definido em `OFFICER_ROLE_ID`.

### Comandos

- `/registrar` — registra/atualiza nome, nick da conta principal, origem (BR/PT), telefone (obrigatório, com DDI) e smurfs (opcional, `smurf:Conta2, Conta3`). Só passe o que quiser mudar.
- `/status [membro]` — dados da pessoa e de cada conta (status e pontos por semana). Telefone só aparece para o próprio membro ou oficiais.
- `/membros [pagina]` — lista as contas ativas, com as smurfs identificadas
- `/pontos pontos [conta] [membro] [semana]` — registra pontos semanais. Com mais de uma conta ativa, informe `conta:`. Editar de outro membro é só para oficiais.
- `/patente membro patente` — (oficiais) promove/rebaixa uma pessoa, atualizando também o cargo no Discord
- `/ranking` — ranking por conta: quem bateu o máximo (2400 pts) primeiro, e a classificação geral
- `/temporada nova|atual` — inicia uma nova temporada ou mostra a atual (oficiais)
- `/painel [tipo]` — (oficiais) publica no canal atual o painel dos membros ou, com `tipo:staff`, o painel da staff
- `/remover membro acao [conta]` — (oficiais) **desativar** (sai do ranking e libera a vaga, mantém o histórico) ou **apagar dados** (definitivo, após confirmação) de uma conta ou, sem `conta`, de todas as contas da pessoa

### Painel do membro

Para quem usa o Discord no celular, os membros podem fazer tudo pelo painel em vez dos comandos slash. Um oficial usa `/painel` uma vez num canal (ex: `#registro`) e fixa a mensagem. Botões:

- **📝 Registrar / editar** — formulário com nome, nick, origem, telefone e, no primeiro registro, "Você tem smurf? Se sim, coloque o nick". Telefone é obrigatório. Para quem já é membro vem preenchido.
- **➕ Adicionar conta** — registra uma smurf depois. Com o nick de uma conta própria desativada, ela volta (ativa ou na lista de espera, conforme o modo).
- **🎯 Pontos** — semana (padrão: atual) e pontos; quem tem mais de uma conta ativa escolhe a conta no formulário
- **📊 Meu status** — contas, status (e posição na lista de espera) e pontos da temporada

### Painel da staff

Um oficial usa `/painel tipo:staff` num canal **só de oficiais** e fixa a mensagem. Os avisos de lista de espera e vagas abertas vão para esse canal. Todo botão confere se quem tocou é oficial.

- **👥 Membros** — lista com pontos e telefone, filtros (ativos / lista de espera / inativos / todos) e páginas
- **⏳ Lista de espera** — fila por ordem de chegada; escolha uma conta para ✅ aprovar (se houver vaga) ou ❌ recusar (fica inativa)
- **📭 Sem pontos** — contas ativas que ainda não registraram pontos na semana atual
- **🏆 Ranking**
- **📤 Exportar** — planilha CSV (abre no Excel/Google Sheets) com todas as contas, telefones e pontos por semana
- **🎯 Pontos** · **🎖️ Patente** · **🗑️ Remover** — as ações de oficial em formulários
- **⚙️ Registro** — alterna entre registro aberto e aprovação

As respostas dos dois painéis só aparecem para quem tocou no botão. Os painéis continuam funcionando após reinícios do bot; para atualizar o texto, apague a mensagem antiga e use `/painel` de novo.

### Patentes

Quando a primeira conta de uma pessoa fica ativa (no registro ou ao ser aprovada da lista de espera), ela recebe automaticamente o cargo da patente dela no Discord (**RECRUTA** para quem é novo). As demais patentes só podem ser atribuídas por oficiais via `/patente`:

`RECRUTA → SOLDADO → SARGENTO → TENENTE → CAPITÃO → MAJOR → CORONEL`

Os IDs dos cargos do servidor oficial estão em [src/ranks.js](src/ranks.js) — se algum cargo for recriado ou o bot for usado em outro servidor, atualize os IDs lá. A sincronização de cargo é *best-effort*: se o cargo não existir no servidor (ex: servidor de testes) ou o bot não tiver permissão, o registro/patente ainda funciona no banco, só o cargo do Discord não é aplicado (fica um aviso no log).

## Stack

- Node.js + [discord.js](https://discord.js.org/) v14 (slash commands)
- PostgreSQL (persistência) — recomendado [Neon](https://neon.tech) (grátis, sem expiração)

> Por que Postgres e não um arquivo local (SQLite/JSON)? O Render (plano free) apaga o disco a cada deploy/restart. Um banco externo garante que os dados dos membros não se percam.

## Setup local

1. Instale as dependências:
   ```bash
   npm install
   ```
2. Copie `.env.example` para `.env` e preencha:
   - `DISCORD_TOKEN` e `CLIENT_ID`: crie uma aplicação em https://discord.com/developers/applications, adicione um Bot, copie o token e o Application ID.
   - `GUILD_ID`: ID do servidor da guilda (ative "Modo desenvolvedor" no Discord, clique com botão direito no servidor > Copiar ID). Use durante o desenvolvimento para os comandos aparecerem na hora.
   - `DATABASE_URL`: crie um banco grátis em https://neon.tech (ou Supabase), copie a connection string.
   - `OFFICER_ROLE_ID`: (opcional) ID de um cargo extra com poderes de oficial. CAPITÃO, MAJOR, CORONEL e quem tem "Gerenciar Servidor" já são oficiais.
3. Convide o bot para o servidor com os escopos `bot` e `applications.commands` (gere o link em Developer Portal > OAuth2 > URL Generator). Permissões mínimas: `Send Messages`, `Use Slash Commands`, `Embed Links`, `Manage Roles` (necessária para atribuir as patentes automaticamente).
   - **Importante**: no servidor, o cargo do bot precisa estar **acima** de todos os 7 cargos de patente na hierarquia de cargos (Configurações do Servidor > Cargos), senão o Discord não deixa o bot atribuí-los.
4. Registre os comandos:
   ```bash
   npm run deploy-commands
   ```
5. Rode o bot:
   ```bash
   npm start
   ```
6. Dentro do Discord, use `/temporada nova nome:"Temporada 1"` para iniciar a primeira temporada antes de registrar pontos.

## Deploy no Render

1. Suba este projeto para um repositório no GitHub.
2. No [Render](https://render.com), crie um **Web Service** apontando para o repo.
   - Build command: `npm install`
   - Start command: `npm start`
   - O código já sobe um pequeno servidor HTTP de health-check (usa a variável `PORT` que o Render define automaticamente) — isso é só para o Render considerar o serviço "no ar", não afeta o bot.
3. Configure as variáveis de ambiente do `.env.example` em Render > Environment (não defina `GUILD_ID` em produção para os comandos ficarem disponíveis em qualquer servidor onde o bot esteja, ou defina se quiser restringir a um único servidor).
4. Depois do primeiro deploy, rode `npm run deploy-commands` **uma vez localmente** (apontando para o mesmo `DISCORD_TOKEN`/`CLIENT_ID`) para registrar os comandos — ou rode via Render Shell.

### Atenção: plano free do Render "dorme"

Um **Web Service** no plano free do Render hiberna após ~15 min sem receber requisições HTTP, o que derruba a conexão do bot com o Discord. Duas opções:
- Upgradar para um plano pago (ou usar "Background Worker", que não dorme, mas também não é gratuito no Render).
- Usar um serviço de ping gratuito (ex. [UptimeRobot](https://uptimerobot.com)) batendo na URL pública do serviço a cada poucos minutos para mantê-lo acordado. Não é 100% confiável, mas funciona bem para uma guilda pequena.

## Estrutura

```
src/
  commands/          comandos slash
  db/index.js        acesso ao Postgres (schema, migração, queries)
  members.js         regras de registro, contas, pontos e status (usadas por comandos e painéis)
  panel.js           painel do membro (botões e formulários)
  staff-panel.js     painel da staff
  permissions.js     quem é oficial
  ranks.js           patentes e cargos do Discord
  health.js          mini servidor HTTP (health check)
  index.js           bot principal
  deploy-commands.js registro dos slash commands na API do Discord
test/                testes (npm test)
```

## Testes

```sh
npm test
```

Roda os testes de comandos, painéis e regras sem banco. Os testes de banco (migração, limite de 140, lista de espera, nicks únicos, registros simultâneos) precisam de um Postgres **de teste**, porque apagam todas as tabelas:

```sh
TEST_DATABASE_URL=postgres://usuario@localhost:5432/bope_test npm test
```

**Nunca** aponte `TEST_DATABASE_URL` para o banco de produção (Neon).

## Manter o banco acordado (opcional)

O plano free do Neon hiberna o banco após ~5 min sem uso. O primeiro clique num botão do painel depois disso pode demorar e o Discord mostrar "Esta interação falhou" (basta tocar de novo). Para evitar, defina `DB_KEEPALIVE_MINUTES=4` nas variáveis de ambiente: o bot faz uma consulta mínima a cada 4 minutos e o banco não hiberna.

**Atenção:** com o banco sempre acordado, o consumo de horas de computação do Neon aumenta. Confira o limite do seu plano e o uso em *Neon → Billing/Usage* antes de ativar. Sem a variável, o keep-alive fica desligado.

## Termos e privacidade

- [Termos de Serviço](TERMS.md)
- [Política de Privacidade](PRIVACY.md)
