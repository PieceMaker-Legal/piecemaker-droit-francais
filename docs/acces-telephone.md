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

1. Réglages › Téléphone. Si Tailscale manque : lien vers l'installeur officiel (`.pkg` sur Mac, `.exe` sur Windows). S'il est déconnecté : le dire.
2. Console d'administration Tailscale, une seule fois : onglet DNS, tout en bas, section « HTTPS Certificates » › « Enable HTTPS » (MagicDNS activé).
3. « Publier sur mon téléphone ». La première fois, Tailscale peut exiger d'autoriser HTTPS/Serve sur le tailnet : la commande affiche un lien de consentement, l'onglet le transforme en bouton, puis on republie.
4. « Copier le lien » (`https://<machine>.<tailnet>.ts.net`).
5. Téléphone : Tailscale connecté au même compte → lien dans Safari → « Sur l'écran d'accueil » → ouvrir l'icône → login PieceMaker (l'icône a un stockage distinct de Safari).

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
- Défilement du chat sur iPhone : depuis Safari 27, WebKit fait l'ancrage de défilement (`overflow-anchor`) et une écriture de `scrollTop` pendant l'élan ne l'arrête plus ; `src/piecemaker/chat/scrollAnchoring.ts` ne fait alors rien, comme sur Chrome et l'app de bureau (le chargement paresseux de CloudCLI compte sur cet ancrage natif). Il ne s'active que là où `overflow-anchor` manque. Sur Safari iOS 26 et antérieurs (une écriture de `scrollTop` y arrête l'élan), pendant le geste et l'élan une marge haute négative absorbe, dès la mutation et avant affichage, la croissance des messages au-dessus de l'écran, puis une seule correction de `scrollTop` la remplace 250 ms après l'arrêt ; collé en bas, le volet reste en bas (sinon la remontée automatique du navigateur en fin de contenu s'ajoute à la compensation et les chats ne s'ouvrent plus au dernier message). Un `transform` est exclu : il fausse l'IntersectionObserver du chargement paresseux et laisse des trous. Sur Safari de bureau sans `overflow-anchor`, un polyfill d'ancrage classique s'applique.

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
