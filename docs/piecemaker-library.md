# Bibliothèque centrale

Le plugin Bibliothèque est développé dans `plugins/piecemaker-library/`, à la demande de l’utilisateur. Son installation copie uniquement ses fichiers exécutables dans le répertoire de plugins de l’application. Il utilise le slot `tab` et le RPC de CloudCLI. L’intégration hôte est limitée aux ajouts PieceMaker décrits ci-dessous ; la seule modification de CloudCLI concerne l’isolation de son répertoire de plugins via `product.config.json`, avec repli sur `~/.claude-code-ui` lorsque cette configuration est absente.

## Backend

`server/piecemaker/library/` possède une base SQLite distincte sous `PIECEMAKER_HOME/library-backend`. Les métadonnées, instructions et fichiers associés y sont centralisés. L’empreinte du contenu déduplique les copies identiques ; les origines restent enregistrées. Deux versions différentes restent deux entrées distinctes.

Un serveur interne sur une adresse de boucle locale et un port aléatoire expose uniquement le catalogue, les activations et les routes utiles aux MCP / marketplaces. Un jeton renouvelé à chaque démarrage protège cette interface. Le sous-processus du plugin, atteint par le RPC authentifié de CloudCLI, relaie les appels. Ni le jeton interne ni la base ne sont servis comme assets du plugin.

Le harnais de bibliothèque décore le service public des providers après le harnais de citations. Il ajoute les seules instructions activées pour le chemin canonique du dossier et masque ce complément dans l’écho utilisateur et l’historique affiché. Les noms de commandes restent au début du message. Les agents activés fournissent leurs instructions de rôle ; cette activation ne crée pas de sous-agent.

Une activation vaut simultanément pour Claude, Codex, Cursor, Mistral et OpenCode. Le harnais commun décore `run` et `getRunner`, de sorte que le choix du provider ne crée aucune activation séparée. Les copies de découverte natives restent un mécanisme de compatibilité supplémentaire pour les providers qui savent lire ces répertoires ; Mistral n’en expose actuellement aucun.

## Import et retrait des installations globales

Depuis la racine, avec la version de Node compatible avec `better-sqlite3` :

```sh
npx tsx --tsconfig server/tsconfig.json server/piecemaker/library/migrate-cli.ts
npx tsx --tsconfig server/tsconfig.json server/piecemaker/library/migrate-cli.ts --withdraw
```

Le premier appel importe les cinq workflows vendus dans `mike-defaults-fr`, les skills personnelles Claude/Codex/Agents, les agents Claude et l’ancienne bibliothèque personnelle PieceMaker. Le second retire les installations globales importées après vérification et conserve une sauvegarde avec manifeste dans `library-backend/migration-*`. Aucun original n’est retiré en cas d’échec d’import préalable. Les skills système et les règles d’architecture locales du dépôt sont exclues.

Le marqueur `centralized.json` empêche les installateurs de skills PieceMaker de recréer leurs liens globaux lors d’une mise à jour. Les hooks de protection restent indépendants de cette politique.

Pour restaurer une installation, consulter le manifeste de migration puis remettre l’entrée sauvegardée à son chemin `source`, uniquement si ce chemin est libre. Les liens relatifs retrouvent leur validité à leur emplacement d’origine. Retirer le marqueur seulement si l’on souhaite rétablir la gestion globale historique.

## Limites de portée

Les éléments inactifs ne sont ni ajoutés au contexte du chat, ni copiés dans les répertoires de découverte des providers. La base et les sauvegardes restent des fichiers de l’utilisateur : ce mécanisme n’est pas un sandbox interdisant toute lecture par un shell disposant des mêmes droits. Les copies vendorisées et les catalogues de plugins tiers restent leurs sources de livraison.

Une désactivation concerne les prochains messages ; elle ne retire pas les contenus déjà présents dans un transcript. L’activation des MCP et plugins existants conserve leurs règles de portée et peut nécessiter une nouvelle session du provider.

## Frontend

Le plugin possède sa liste et ses onglets. `src/piecemaker/library/` monte le composant natif `EditorSidebar` de CloudCLI dans un volet redimensionnable à droite de la liste, sans écrire de document dans le dossier ni utiliser le chat. Le contenu est fermé au démontage du plugin et à l’expiration de l’authentification. Un adaptateur en mémoire fournit le document à l’éditeur ; les lectures des fichiers ordinaires conservent leur transport habituel. Le téléchargement et l’aperçu Markdown natifs sont disponibles. Enregistrer (ou Ctrl/Cmd+S) sauvegarde le document dans le catalogue et actualise ses métadonnées YAML, sans changer ses activations. Une vérification de la version précédente empêche d’écraser une modification concurrente. Les fichiers associés restent conservés séparément du document principal.

L’onglet Skills affiche aussi les installations détectées par Claude, Codex, Cursor, Mistral et OpenCode. Le plugin normalise leur provider, leur scope, leur commande, leur nom, leur description et leur chemin source. Les métadonnées de dossier ne sont conservées que pour les scopes `project` et `repo`. Cette liste reste distincte du catalogue central et ne reçoit donc aucun bouton d’activation.
