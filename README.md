# Bot Discord Tickets

Bot Discord compatible avec `discord.js v14`.

## Installation locale

1. Installe Node.js 18 ou plus.
2. Ouvre un terminal dans ce dossier.
3. Lance `npm install`.
4. Copie `.env.example` en `.env`.
5. Remplis `DISCORD_TOKEN`, `CLIENT_ID` et, si possible, `GUILD_ID`.
6. Lance `npm start`.

## Permissions Discord necessaires

Dans le Developer Portal, active:

- `SERVER MEMBERS INTENT`
- `MESSAGE CONTENT INTENT`

Invite le bot avec ces scopes:

- `bot`
- `applications.commands`

Permissions conseillees:

- Manage Channels
- Manage Messages
- Send Messages
- Read Message History
- View Channels
- Attach Files
- Embed Links

## Premier demarrage

1. Lance le bot.
2. Sur ton serveur Discord, utilise `/setup`.
3. Envoie un panneau avec `/panel ticket`.
4. Ajoute `categorie` pour choisir ou le salon du ticket s'ouvre et `role_accepte` pour choisir le role qui peut voir le ticket.
5. Ajoute `choix` si tu veux un menu deroulant, par exemple `FIVEM ACCOUNT / emoji | FORTNITE ACCOUNT / emoji`.
6. Clique sur le bouton ou le menu du panneau pour creer un ticket.

Les transcripts sont sauvegardes dans `data/transcripts`.
