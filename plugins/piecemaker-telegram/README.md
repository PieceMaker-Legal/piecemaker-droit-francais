# Telegram dans PieceMaker

L’onglet **Telegram** apparaît dans l’espace de travail d’un dossier. Il comporte un guide et trois actions : installer le canal officiel, enregistrer le bot principal, puis lier un bot à chaque dossier souhaité.

## Installation

Comme tous les plugins PieceMaker : compilé et installé par la chaîne commune `plugins/toolchain`, embarqué dans l'application Electron et réinstallé à chaque démarrage si besoin. Depuis le dépôt : `npm run plugins`. Voir `docs/plugins.md`.

## Mise en route

1. Dans l’onglet Telegram, cliquez sur **Installer depuis la bibliothèque**. Le canal officiel `telegram@claude-plugins-official` est installé pour l’utilisateur. Il reste désactivé dans les sessions Claude ordinaires ; PieceMaker l’active seulement pour les sessions Telegram qu’il lance.
2. Dans Telegram, ouvrez [@BotFather](https://t.me/BotFather), envoyez `/newbot`, puis copiez le jeton remis. Créez un bot principal et un bot distinct par dossier.
3. Ouvrez [@userinfobot](https://t.me/userinfobot) pour connaître votre identifiant numérique Telegram.
4. Saisissez le jeton et cet identifiant pour le bot principal. Ouvrez ensuite sa conversation et envoyez `/start`.
5. Choisissez un dossier enregistré dans PieceMaker, saisissez le jeton de son bot et le même identifiant, puis cliquez sur **Lier ce bot au dossier** et **Démarrer**. Ouvrez sa conversation et envoyez `/start` pour parler à Claude.

Le bot principal répond à `/status`, `/launch <dossier>`, `/stop <dossier>` et `/restart <dossier>`. Le nom affiché par `/status` peut servir de cible. Une session qui se termine envoie un avis au bot principal ; vous pouvez alors la relancer avec `/launch`.

## Stockage et fonctionnement

Les jetons, identifiants autorisés et associations aux dossiers sont conservés dans la table `piecemaker_telegram_bots` de `auth.db`. L’API ne renvoie jamais les jetons au navigateur. L’accès au service du plugin est limité aux appels authentifiés de l’hôte PieceMaker.

Le canal Telegram officiel exige aussi ses fichiers de fonctionnement sous `~/.claude/channels/piecemaker-telegram-<id>/`. PieceMaker y projette la liste d’accès depuis `auth.db` et transmet le jeton à la session Claude par son environnement. **Délier** un bot retire cette projection et son enregistrement. Le bot principal est un superviseur ; il ne lance pas de session Claude. Chaque bot de dossier a une session Claude distincte, dans le chemin enregistré pour ce dossier.

Le serveur PieceMaker doit rester ouvert pour que les bots fonctionnent. L’accès aux Channels dépend aussi de la version et de la disponibilité de Claude Code pour le compte utilisé. Les sessions de dossier utilisent le mode de permission `auto` de Claude Code.
