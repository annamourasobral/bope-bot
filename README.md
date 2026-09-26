# BØPE Bot

Bot Discord para gestão da guilda **BØPE** (Wild Rift).

## Funcionalidades

- `/registrar` — registra/atualiza seu nome, nick, origem (BR/PT) e telefone (opcional). Campos são editáveis a qualquer momento (só passe o que quiser mudar).
- `/status [membro]` — consulta status (nome, nick, origem, patente, pontos por semana, total na temporada). Telefone só aparece para o próprio membro ou oficiais.
- `/membros [pagina]` — lista os membros registrados
- `/pontos [pontos] [membro] [semana]` — registra/atualiza pontos semanais. Qualquer membro pode atualizar os próprios; editar de outro membro é só para oficiais.
- `/patente membro patente` — (oficiais) promove/rebaixa um membro, atualizando também o cargo no Discord
- `/ranking` — mostra quem bateu o máximo (2400 pts) primeiro, e a classificação geral
- `/temporada nova|atual` — inicia uma nova temporada ou mostra a atual (oficiais)

Regras: máximo **600 pontos/semana**, **4 semanas por temporada**, total máximo **2400 pontos**.

### Patentes

Ao se registrar pela primeira vez, o membro recebe automaticamente o cargo **RECRUTA** no Discord. As demais patentes só podem ser atribuídas por oficiais via `/patente`:

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
   - `OFFICER_ROLE_ID`: ID do cargo que pode usar `/pontos` e `/temporada nova` (opcional — quem tem permissão "Gerenciar Servidor" já tem acesso).
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
  commands/        comandos slash
  db/index.js       acesso ao Postgres (schema + queries)
  permissions.js    checagem de "oficial"
  health.js         mini servidor HTTP p/ Render
  index.js          bot principal
  deploy-commands.js registro dos slash commands na API do Discord
```
