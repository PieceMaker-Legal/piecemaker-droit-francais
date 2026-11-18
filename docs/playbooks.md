# Playbooks contractuels

Le plugin `plugins/piecemaker-playbooks/` permet de définir des positions de négociation et de revoir un contrat selon ces règles.
Il possède son onglet, son serveur RPC et ses données par dossier.
Il utilise la chaîne commune des plugins, sans modification de CloudCLI.

Le [README du plugin](../plugins/piecemaker-playbooks/README.md) décrit le parcours, les formats et les limites.

## Architecture

| Partie | Responsabilité |
| --- | --- |
| `src/domain/model.ts` | Validation des règles, références et résultats ; recherche des extraits. |
| `src/domain/prompts.ts` | Compilation du guide et revue complète du contrat. |
| `src/server/documents.ts` | Lecture Word/texte et contrôle des chemins, liens et tailles. |
| `src/server/store.ts` | Stockage local atomique, versions des guides et reçus de publication. |
| `src/server/jobs.ts` | Sessions IA, correction de format, arrêt et reprise explicite. |
| `src/server/api.ts` | Autorisation RPC, contrôles du dossier et sauvegarde Word conditionnelle. |
| `src/client/WordReview.tsx` | Véritable éditeur Eigenpal, propositions et enregistrement des révisions. |
| `src/client/word.ts` | Rapprochement d'une proposition avec un passage Word unique. |

Les façades `piecemaker-tabular-review/src/{server,client}/runtime.ts` exposent le transport et les fonctions hôtes déjà utilisés par l'analyse tabulaire.
Leur code est inclus dans le bundle Playbooks. Aucun appel RPC au plugin tabulaire n'est nécessaire.

## Invariants

- Les règles importées restent non validées jusqu'à confirmation de l'avocat.
- Une revue conserve une copie des règles et du texte de départ.
- Une règle oubliée ou une citation non retrouvée ne devient pas une conclusion positive silencieuse.
- Le dossier doit être protégé et le proxy doit répondre avant une session IA.
- Les résultats du modèle ne constituent ni une preuve formelle ni une nouvelle prémisse OKF.
- Le serveur ne lit que des fichiers réguliers du dossier enregistré ; les liens symboliques sont refusés.
- Les propositions Word passent par l'API de suivi des modifications Eigenpal.
- L'original reste intact. La sauvegarde de la copie contrôle l'empreinte et les doubles publications.
- Les données utilisateur ne résident jamais dans le plugin installé.

## Validation locale

Depuis la racine du dépôt :

```sh
node plugins/toolchain/cli.mjs --check
npx tsc -p plugins/piecemaker-playbooks/tsconfig.json
npx tsx --test plugins/piecemaker-playbooks/src/tests/*.test.ts
```

Le test `word.test.ts` nécessite Chromium installé pour `playwright-core`.
Il ouvre un serveur HTTP temporaire et bloque les requêtes HTTPS extérieures.
Les réponses IA sont simulées ; aucun fournisseur payant n'est appelé.

La compilation et la livraison suivent `docs/plugins.md`.
Ajouter les sources ne redémarre ni le serveur de développement ni l'application installée.
