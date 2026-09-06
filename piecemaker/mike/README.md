# Mike dans PieceMaker

`upstream/` conserve les 822 fichiers suivis nécessaires de Mike, copiés sans
modification depuis le commit `dd91a85ba274f9e31f942ee7a69feab4a7f8afe1` du dépôt
`open-legal-products/mike`. `source-manifest.json` conserve leurs empreintes SHA-256.
La licence originale est dans `upstream/LICENSE`.

Les pages Workflows, Tabular review et Library sont servies par le frontend Mike
original. La passerelle `server/piecemaker/mike/` ouvre une session locale Mike
pour chaque compte CloudCLI et intègre ces pages dans l’espace central. Les
adaptations sont uniquement dans `integration/` et `src/piecemaker/mike/`.
Le compositeur et les sessions de conversation restent ceux de CloudCLI.

Le projet Docker `piecemaker-mike` possède son réseau et ses volumes propres.
Il ne modifie pas le projet Docker `mike` éventuellement déjà installé.

```sh
node scripts/piecemaker/mike/runtime.mjs build
node scripts/piecemaker/mike/runtime.mjs start
node scripts/piecemaker/mike/runtime.mjs status
node scripts/piecemaker/mike/runtime.mjs stop
```

L’ouverture d’un espace démarre ce runtime à la demande. Docker doit être
installé et actif. Le premier démarrage télécharge et construit les dépendances.
La configuration générée et la clé de passerelle vivent dans `~/.piecemaker/mike`.
Les documents sont conservés dans les volumes de stockage Mike.

Ports locaux : frontend 3010, backend 3011, passerelle intégrée 3012,
Supabase 54331, Postgres 54332, stockage 9010/9011, Redis 6389.
Cette passerelle est destinée à l’utilisation locale par navigateur sur la même
machine que PieceMaker. Ces ports ne constituent pas une publication distante.

`integration/catalogue.cjs` appelle le synchroniseur original Mike et ajoute
les skills de `PieceMaker-Legal/claude-for-legal-fr` à son catalogue d’add-ons.
Les cinq workflows par défaut traduits en français sont conservés dans
`server/piecemaker/vendor/mike-defaults-fr/`, avec leur provenance.
Les skills, agents et MCP PieceMaker existants restent dans Organisation.

Les workflows sélectionnés et les instructions des sous-agents sont insérés
dans le brouillon natif pour que l’utilisateur puisse les consulter avant envoi.
Les documents choisis dans Mike sont téléchargés via l’API authentifiée puis
ajoutés comme pièces jointes au compositeur CloudCLI.

Le moteur Tabular utilise le backend original et l’adaptateur HTTP
`integration/provider-fetch.mjs` pour le compte Codex local et le proxy PII
PieceMaker. Il nécessite une connexion Codex et le proxy de l’application actif.
Aucun secret fournisseur n’est envoyé au frontend Mike.
