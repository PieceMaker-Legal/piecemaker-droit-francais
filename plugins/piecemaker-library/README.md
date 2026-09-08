# Bibliothèque PieceMaker

Plugin CloudCLI autonome : une liste de skills, une liste d’agents, les MCP et connecteurs du dossier, et les marketplaces Legal / Anthropic existantes. Les titres et descriptions viennent du frontmatter YAML. Le contenu complet est demandé uniquement à l’ouverture du document.

## Installation locale

Avec Node 22 ou plus récent, depuis `plugins/piecemaker-library/` :

```sh
node install.mjs /chemin/vers/piecemaker-droit-francais
```

Le plugin est copié dans le répertoire de plugins déterminé par `product.config.json` de PieceMaker, avec priorité à `CLOUDCLI_HOME`. Il nécessite le module `server/piecemaker/library` et le pont de visionneuse `src/piecemaker/library` de PieceMaker. Sur CloudCLI sans ces extensions, le backend de bibliothèque n’est pas disponible.

La source du plugin est versionnée dans `plugins/piecemaker-library/` du dépôt PieceMaker. Relancer l’installation après une modification locale. Aucun dépôt distant n’est requis pour cette installation.

## Données et activation

- Le catalogue appartient au backend PieceMaker hébergé dans CloudCLI : `~/.piecemaker/library-backend/catalog.sqlite` (ou `PIECEMAKER_HOME`).
- Les skills et agents importés sont désactivés au départ. Un toggle persiste l’activation pour le chemin canonique du dossier ; le backend ajoute alors les instructions aux prochains messages de chat. Les instructions d’agents sont des rôles transmis au modèle, sans création automatique de sous-processus agent.
- Les fichiers associés sont conservés dans la base, puis matérialisés uniquement pour les éléments activés. Les instructions indiquent leurs chemins. La désactivation retire cette copie active.
- La visionneuse réutilise le volet natif `EditorSidebar` de CloudCLI, avec édition et enregistrement direct dans le catalogue. Les métadonnées YAML sont actualisées à chaque sauvegarde et les modifications concurrentes sont détectées. Elle ne crée aucun fichier dans le dossier et ne transmet rien au chat.
- MCP et connecteurs réutilisent les réglages d’activation par dossier existants. Une acquisition depuis la marketplace installe le connecteur désactivé globalement ; ses skills et agents entrent également dans le catalogue.
- Une désactivation ne supprime pas les instructions déjà reçues dans l’historique d’une conversation. Commencer une nouvelle session pour repartir sans ce contexte.

Le retrait des répertoires de découverte empêche leur chargement automatique par Claude/Codex. Il ne constitue pas un confinement système : un processus local disposant des mêmes droits que l’utilisateur peut lire les données backend. Le plugin ne promet pas une isolation système des sessions.

## Validation

```sh
npm install --ignore-scripts
npm test
```

Les tests couvrent le chargement des métadonnées, l’ouverture explicite, l’activation limitée au dossier et les réponses arrivant après un changement de dossier.
