# Données réelles : jamais dans le dépôt

Aucun nom, société, adresse, identifiant ou titre de document tiré de dossiers clients, de corpus de test ou de pièces scannées ne doit apparaître dans le dépôt ni dans son historique git : code, tests, fixtures, docs, commentaires, descriptions ou prompts de modèle, noms de fichiers ou de branches, messages de commit.

Un incident a imposé de réécrire tout l'historique. Cette règle existe pour qu'il ne se reproduise pas.

## Écrire des exemples

- Valeurs inventées : `Jean Dupont`, `Société Exemple SAS`, `12 rue des Lilas, Paris`.
- Ne jamais « adapter légèrement » une vraie valeur : l'inventer.
- Les documents de benchmark réels restent hors du dépôt.

## Garde mécanique

`scripts/piecemaker/guard-donnees-reelles/` contient un scanner qui compare des **hachages** SHA-256 de mots (et de suites de 2 ou 3 mots) à une liste interdite. La liste (`forbidden-hashes.json`) ne contient aucun texte en clair et les rapports n'affichent jamais le terme trouvé, seulement le commit, le fichier et la ligne.

| Couche | Quand | Fichier |
| --- | --- | --- |
| `pre-push` | avant tout push : messages, lignes ajoutées et chemins de chaque commit non encore distant | `.husky/pre-push` |
| CI | à chaque push et pull request | `.github/workflows/guard-donnees-reelles.yml` |
| Session Claude Code | avant toute écriture dans le dépôt, `git commit/tag/push` | `.claude/settings.local.json` (non versionné) |

Le hook de session n'est pas versionné (`.claude/` est ignoré) : le recopier sur chaque poste.

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write|Edit|MultiEdit|NotebookEdit|Bash",
        "hooks": [
          { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/scripts/piecemaker/guard-donnees-reelles/check.mjs\" claude-hook" }
        ]
      }
    ]
  }
}
```

## Ajouter un terme découvert

```sh
printf '%s\n' 'Nom Réel' | node scripts/piecemaker/guard-donnees-reelles/check.mjs add -
```

Sans `--exact`, la comparaison ignore casse et accents. Avec `--exact`, les accents comptent (utile pour un nom qui, sans accent, est un mot courant). Un mot courant et ambigu s'enregistre de préférence en suite de mots (« prénom nom »).

## Limites

- `git push --no-verify` contourne le hook local : la CI le signale après coup, trop tard pour empêcher la publication. Ne jamais l'utiliser.
- Le scanner ne connaît que les termes déjà ajoutés. Un nom réel jamais enregistré passe : lors d'une revue, chercher aussi les noms propres inattendus dans un diff.
- Tests : `node --test scripts/piecemaker/guard-donnees-reelles/check.test.mjs`.
