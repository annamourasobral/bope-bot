# Política de Privacidade — BØPE Bot

_Última atualização: 27 de setembro de 2026_

Esta política explica quais dados o **BØPE Bot** ("bot") guarda, para quê, quem pode vê-los e como pedir que sejam corrigidos ou apagados. Ela vale para membros do Brasil e de Portugal e busca seguir a LGPD (Lei nº 13.709/2018) e o RGPD/GDPR (Regulamento UE 2016/679).

**Responsável pelos dados:** a liderança da guilda BØPE. Contato: **[E-MAIL DE CONTATO]**.

## 1. Dados que guardamos

| Dado | Como é obtido | Obrigatório? |
|---|---|---|
| ID de usuário do Discord | Automaticamente, quando você usa um comando ou é registrado por um oficial | Sim |
| Nome | Informado por você (ou por um oficial) em `/registrar` | Sim |
| Nick no Wild Rift (conta principal) | Informado em `/registrar` ou no painel | Sim |
| Nicks de outras contas (smurfs) | Informados por você no registro ou em "Adicionar conta" | Não |
| Status de cada conta (ativa, lista de espera, inativa) e data da mudança | Automaticamente e pelos oficiais | — |
| Origem (BR ou PT) | Informada em `/registrar` | Sim |
| Telefone | Informado em `/registrar` | **Não, é opcional** |
| Patente | Definida pelos oficiais (inicia como RECRUTA) | Sim |
| Pontos semanais por temporada, de cada conta | Informados por você ou por um oficial | — |
| Conclusão de temporada | Registrada automaticamente ao atingir o máximo de pontos | — |
| Datas de criação e alteração, e quem alterou os pontos | Automaticamente | — |

O bot **não** lê o conteúdo das suas mensagens, não acessa suas mensagens privadas, não usa cookies e não recolhe dados de localização ou do dispositivo. Ele só processa as informações que chegam pelos comandos.

## 2. Para que usamos

Os dados servem apenas para a organização interna da guilda: identificar os membros, controlar patentes e cargos no servidor, calcular pontos e ranking e permitir que a liderança entre em contato com os membros (telefone, quando informado).

A base legal é o consentimento que você dá ao registrar os seus dados e o interesse legítimo da guilda em organizar os seus membros. Os dados **não são vendidos, não são usados para publicidade e não são compartilhados** com ninguém fora da guilda, exceto os prestadores técnicos da secção 4.

## 3. Quem pode ver

- **Qualquer pessoa no servidor** pode ver, pelos comandos `/membros`, `/status` e `/ranking`: nome, nicks (inclusive das smurfs), origem, patente, pontos e o status de cada conta.
- **O telefone** só aparece para você mesmo e para os oficiais, em respostas visíveis apenas para quem executou o comando.
- **Oficiais** podem ver e editar os dados de todos os membros, ver a lista de espera e exportar uma planilha com os dados de todos (inclusive telefones) para a organização da guilda. A planilha não deve ser compartilhada fora da liderança.

Se não quiser que o seu nome real fique visível aos outros membros, use um nome ou apelido no campo "nome".

## 4. Onde os dados ficam

- **Banco de dados:** [Neon](https://neon.tech) (PostgreSQL), com servidores na União Europeia (Frankfurt, Alemanha).
- **Hospedagem do bot:** [Discloud](https://discloudbot.com).
- **Discord:** os comandos e as respostas passam pelos servidores do Discord, de acordo com a [política de privacidade do Discord](https://discord.com/privacy).

A ligação ao banco de dados é cifrada (SSL).

## 5. Por quanto tempo guardamos

Os dados ficam guardados enquanto você for membro da guilda. Membros que saem podem ser marcados como inativos. Os seus dados são apagados definitivamente quando você pede (secção 6) ou quando o bot é desativado.

## 6. Seus direitos

Você pode, a qualquer momento:

- **corrigir** os seus dados, usando `/registrar` com os campos que quer mudar;
- **consultar** os dados guardados sobre você, com `/status`;
- **pedir que tudo seja apagado**, incluindo os pontos e o histórico, ou retirar o seu consentimento, falando com um oficial ou escrevendo para **[E-MAIL DE CONTATO]**.

Pedidos de exclusão são atendidos em até 15 dias. Se achar que os seus dados foram tratados de forma indevida, também pode reclamar à ANPD (Brasil) ou à CNPD (Portugal).

## 7. Menores de idade

O bot segue a idade mínima exigida pelo Discord. Não recolhemos de propósito dados de quem está abaixo dessa idade. Se isso acontecer, os dados serão apagados assim que soubermos.

## 8. Alterações nesta política

Esta política pode ser atualizada. A data no topo indica a versão mais recente, e mudanças importantes serão avisadas no servidor da guilda.
