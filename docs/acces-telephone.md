# Accès téléphone (Tailscale Serve)

Piloter depuis un téléphone les sessions qui tournent sur l'ordinateur : le téléphone affiche l'interface PieceMaker servie par le Mac ou le PC. Rien ne s'exécute sur le téléphone ; agents, fichiers, hudsucker et historique restent sur l'ordinateur.

## Pourquoi Tailscale Serve

| Option | Téléphone | Ce que voit un tiers |
|---|---|---|
| **Tailscale Serve** | App Tailscale (une fois) | Rien : WireGuard de bout en bout, aucune URL publique |
| Tunnel Cloudflare / ngrok / Funnel | Rien | Le relais termine le TLS et voit les pages |
| Remote Control Claude | App Claude | Relais Anthropic ; Claude seulement, sans Codex ni Dossier |
| Bureau à distance | Une app | L'écran, selon l'outil ; inutilisable sur un téléphone |

## Parcours utilisateur

1. Réglages › Téléphone. Si Tailscale manque : lien d'installation. S'il est déconnecté : le dire.
2. « Publier sur mon téléphone ». La première fois, Tailscale peut exiger d'autoriser HTTPS/Serve sur le tailnet : la commande affiche un lien de consentement, l'onglet le transforme en bouton, puis on republie.
3. « Copier le lien » (`https://<machine>.<tailnet>.ts.net`). Sur Mac, le presse-papiers universel le colle sur l'iPhone.
4. Téléphone : Tailscale connecté au même compte → lien dans Safari → « Sur l'écran d'accueil » → ouvrir l'icône → login PieceMaker (l'icône a un stockage distinct de Safari).

## Architecture

```
téléphone (Tailscale) ─HTTPS─▶ Tailscale Serve :443 (:8443 en dev)
  ─▶ passerelle PieceMaker 127.0.0.1:<éphémère>   (refuse tout autre compte que le propriétaire)
  ─▶ serveur PieceMaker (prod) ou Vite 5173 (dev)  (JWT inchangé)
```

- `server/piecemaker/remote/tailscale.ts` — binaire résolu hors PATH (`/Applications/Tailscale.app/...`, `C:\Program Files\Tailscale\tailscale.exe`), `status --json`, `serve status --json`, `serve --bg --yes --https=<port> <cible>`, `serve --https=<port> off`.
- `gateway.ts` — proxy HTTP + WebSocket en boucle locale. N'accepte que `Tailscale-User-Login` égal au compte de l'ordinateur ; ajoute `X-Forwarded-*` et `X-PieceMaker-Remote`, réécrit `Host` en `localhost:<port>` (Vite l'accepte).
- `keep-awake.ts` — `caffeinate -i -w <pid>` (macOS) ou `SetThreadExecutionState` via PowerShell (Windows) tant que l'accès est publié ; s'arrête avec le serveur.
- `keep-awake-router.ts` — `GET/POST /api/piecemaker/keep-awake` : interrupteur « Maintenir l’ordinateur actif » du menu ⋮ à droite des onglets (`WorkspaceMoreMenu.tsx`), instance distincte de celle de l’accès téléphone, non persistée (le temps de vie du serveur).
- `remote-access.ts` — état dans `<données CloudCLI>/acces-telephone.json` (séparé dev / bureau), routes `GET|POST /api/piecemaker/remote`, republication au démarrage (la passerelle change de port).
- `src/piecemaker/remote/RemoteAccessSettingsTab.tsx` — onglet Réglages › Téléphone.
- Vue téléphone : tous les onglets, le surplus dans le menu ⋮ ; barre de chat sur une ligne, envoi fixé à droite (`src/piecemaker/theme.css`) ; scan et Analyse Tabulaire repèrent les dossiers via `data-piecemaker-project-path`, posé par `sidebar-anonymization/bootstrap.tsx`.
- Défilement du chat sur iPhone : Safari n'a pas l'ancrage de défilement (`overflow-anchor`), les messages montés au-dessus de l'écran faisaient sauter la vue en remontant. `src/piecemaker/chat/scrollAnchoring.ts` coupe l'ancrage natif sur le volet du chat et compense lui-même, dans la micro-tâche qui suit la mutation (avant tout affichage). Pendant le geste et l'élan, `scrollTop` n'est jamais touché (iOS casserait l'élan) : une marge haute négative absorbe la croissance des messages au-dessus de l'écran, puis est remplacée par une seule correction de `scrollTop` 250 ms après l'arrêt. Un `transform` est exclu (il fausse l'IntersectionObserver du chargement paresseux et laisse des trous). Collé en bas sans contact, le volet reste en bas : sinon la remontée automatique du navigateur (fin de contenu) s'ajoutait à la compensation et les chats ne s'ouvraient plus au dernier message. Sur les navigateurs de bureau sans `overflow-anchor`, un polyfill d'ancrage classique s'applique ; ailleurs, rien.

## Invariants

- Jamais Funnel : publication refusée si `AllowFunnel` est actif sur le port.
- Jamais d'écrasement : si le port HTTPS sert déjà une autre cible, 409 ; à l'arrêt, seule la cible enregistrée est retirée, jamais `serve reset`.
- Dev (pas de `dist/`) sur 8443 vers Vite, bureau sur 443 : les deux ne se marchent pas dessus.
- `/api/piecemaker/local` (scan, renommage, SQL) refuse toute requête portant `Forwarded`, `X-Forwarded-*`, `X-PieceMaker-Remote`, `Tailscale-*` ou un `Host` non loopback.
- Tailscale = réseau ; l'authentification PieceMaker (JWT) reste exigée.

## Limites connues

- Pas de QR (aucune bibliothèque QR dans les dépendances) ; copie du lien seulement.
- Ordinateur portable capot fermé sur batterie : injoignable malgré le maintien d'éveil.
- Le nom de la machine figure dans les journaux publics Certificate Transparency.
- Le serveur CLI écoute déjà sur `0.0.0.0` (comportement CloudCLI) ; ce mode n'ajoute aucune écoute réseau.
