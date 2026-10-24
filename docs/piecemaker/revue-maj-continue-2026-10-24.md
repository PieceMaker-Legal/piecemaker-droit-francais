# Revue MAJ-continue du 24 octobre 2026

Périmètre : les neuf commits de `9a644ad8` à `bfc8faa0`, puis les corrections
issues de cette revue. Contrôles locaux sur macOS ARM64 avec Node 24.11.1.
La revue porte sur les changements d’installation, de Python commun, de
Mistral Vibe 3, de Word et d’affichage des plans.

## Corrections de la revue

- Le test de la carte de plan ne compilait plus depuis l’ajout du cas Mistral
  sans chemin de fichier : il accédait à des propriétés absentes de certaines
  variantes. Chaque cas indique maintenant explicitement le chemin attendu.
- Le test de fin d’installation pouvait envoyer une seconde requête après
  fermeture du serveur et échouer avec `ECONNRESET`. Il vérifie maintenant le
  clic accepté, la fin de l’attente et un seul lancement, sans requête après
  fermeture.
- Le rapport Mistral contenait encore une exigence Developer ID/notarisation,
  contraire au bootstrap autosigné choisi. Il décrit désormais la signature
  locale et le parcours restant à vérifier. Le guide d’installation cite
  maintenant Vibe 3.0.2.

## Contrôles

| Ensemble | Résultat |
| --- | --- |
| Bootstrap, composants Python et raccords Electron `.mjs` | 77 réussis, 2 ignorés |
| Entrée Electron, mises à jour Windows et stockage/publication des mises à jour UI | 33 réussis |
| Mistral, historique, plans, sélection Python, Word, modèles locaux | 82 réussis, 2 ignorés |
| Cartes et visionneuse de plans Claude, Codex et Mistral | 10 réussis |
| Typage serveur, `tsc --noEmit -p server/tsconfig.json` | Réussi |
| Lint global | Réussi avec 174 avertissements, aucune erreur |
| Garde des données réelles sur les neuf commits | Réussi |

Les tests de carte et de visionneuse émettent un avertissement jsdom sur
`HTMLCanvasElement.getContext` lors de l’import du terminal. Ce message ne
constitue pas un échec de test.

## Limites

Le typage global échoue aussi dans trois fichiers non modifiés par les neuf
commits : `recentConversationTitleSync.test.ts` (argument
`backgroundSessionIds` manquant), `PdfPassageViewer.tsx` (type PDF sans méthode
`destroy`) et `RemoteAccessSettingsTab.tsx` (accès à un état potentiellement
nul). Leurs contenus sont identiques à ceux de `9a644ad8` ; cette revue ne les
modifie pas. Le dépôt entier ne peut donc pas être annoncé au vert.

Aucun run GitHub Actions n’est retourné par la recherche sur cette branche.
Les résultats ci-dessus sont locaux. Aucun build Vite, publication, nouveau
test Windows en VM ou installation depuis un téléchargement public n’est
réalisé ici. Les parcours Mac réels antérieurs restent documentés dans les
rapports dédiés ; ils ne remplacent pas ces essais manquants.
