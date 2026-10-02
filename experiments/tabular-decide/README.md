# Essai : GLiNER2.5-multi-Decide contre Luna sur la tabular review

Banc d'essai isolé. Rien dans l'application ni dans le plugin n'en dépend : aucun fichier hors de ce dossier n'a été modifié.

## Tout supprimer

```sh
rm -rf experiments/tabular-decide
```

Le dossier contient son propre environnement Python (`.venv/`), le modèle téléchargé (`.hf/`, 1,1 Go) et les décisions (`corpus/`). L'environnement Python de PieceMaker (`~/.piecemaker/venv`) n'a pas été touché, et la recherche Légifrance utilisée pour constituer le corpus a été effacée de `~/.piecemaker/tabular-review/research/` après copie.

## Contenu

| Fichier | Rôle |
| --- | --- |
| `search.json` | Critères de la recherche juridique (mêmes filtres que l'onglet Recherche juridique). |
| `fetch.ts` | Lance la recherche avec le code du plugin et copie les 100 premières décisions retenues dans `corpus/`. |
| `columns.json` | Les quatre questions posées aux deux modèles. |
| `luna.ts` | Luna (`gpt-5.6-luna`, Codex) avec le prompt, la vérification de citations et les relances du plugin, 3 sessions en parallèle. |
| `decide.py` | GLiNER2.5-multi-Decide en local, CPU seul, 3 threads, priorité basse. `sweep` compare les réglages de vitesse, `run <réglage>` traite le corpus. |
| `truth.py`, `truth-manual.json` | Vérité de référence : solution et inaptitude par expression régulière, harcèlement et sécurité par lecture des dispositifs et motifs. |
| `score.ts` | Compare les deux modèles à la vérité et vérifie les citations de Decide avec le vérifieur du plugin. |
| `results/` | Sorties brutes et `report.json`. |
| `RESULTATS.md` | Synthèse. |

## Rejouer

```sh
export PATH="$HOME/.nvm/versions/node/v24.11.1/bin:$PATH"
cd experiments/tabular-decide
npx tsx fetch.ts
python3 truth.py
npx tsx luna.ts
.venv/bin/python decide.py sweep
.venv/bin/python decide.py run chunk384-b4
npx tsx score.ts
```

Luna est appelée directement par Codex, sans le proxy d'anonymisation : le corpus ne contient que des décisions publiées sur Légifrance.
