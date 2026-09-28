---
name: conversion-md
description: Convertir une pièce (PDF, image scannée, etc.) en Markdown avec le smart converter de PieceMaker, y compris choisir entre markitdown et MinerU (OCR). À utiliser dès qu'il faut transformer une pièce en Markdown avant analyse ou anonymisation. Jamais pour un .docx : c'est un document de travail, lu et modifié directement (skill docx-cli).
---

# Conversion de documents en Markdown (smart_converter.py)

## Commande

`websocket-server/scripts/smart_converter.py` — arguments réels (argparse) :

```
python3 websocket-server/scripts/smart_converter.py <file> -o <output_dir> [--engine auto|markitdown|mineru] [--mode MODE] [--lang LANG]
```

- `file` : positionnel, fichier d'entrée.
- `-o` / `--output` : **requis**, répertoire de sortie.
- `--engine` : `auto` (défaut), `markitdown`, ou `mineru`.
- `--mode` : mode MinerU (`pipeline` / `hybrid` / `vlm`), ignoré si le moteur
  n'est pas MinerU.
- `--lang` : code langue OCR pour MinerU.

Exemple :
```
python3 websocket-server/scripts/smart_converter.py piece.pdf -o output/
python3 websocket-server/scripts/smart_converter.py scan.jpg -o output/ --mode hybrid --lang latin
```

Côté serveur ce script est enregistré dans `PYTHON_SCRIPTS.convert`
(`websocket-server/server.cjs`, ~ligne 3856) et déclenché via le Python
Bridge (`taskpane/modules/python-bridge.js` →
`executePythonScript('convert', file, options, callbacks)`).

## Quand utiliser markitdown vs MinerU

- **`markitdown`** — documents avec une vraie couche de texte : PPTX,
  XLSX, PDF "propre" (texte sélectionnable, pas d'image de page entière).
  Rapide, pas de modèle OCR à charger.
- **`mineru`** — PDF scannés ou basés sur image (pas de couche texte), scans
  papier, photos de documents. Plus lent (OCR + mise en page), mais
  nécessaire pour en extraire du texte exploitable.
- **`auto`** (par défaut) — inspecte le fichier et choisit automatiquement
  entre les deux ; c'est le choix par défaut à laisser tel quel sauf besoin
  spécifique (ex. forcer `mineru` sur un PDF qui a une couche de texte
  corrompue ou illisible).

## Enchaînement avec le scan PII

Le scan PII passe uniquement par PieceMaker (outil `conversion` du serveur MCP
`piecemaker`, ou le scan du dossier dans l'interface) : ne pas lancer
`websocket-server/scripts/convert_and_scan_pipeline.py` à la main. Ce script
appelle `smart_converter.py` puis le worker
`websocket-server/scripts/presidio-gliner/scanner_worker.py` (GLiNER chargé
une fois pour tout le lot) ; il exige `--database` (les codes déjà attribués
par tous les dossiers y sont réservés), reçoit le mapping du dossier sur son
entrée standard et renvoie le mapping fusionné en lignes `MAPPING:` que
PieceMaker écrit en base. Aucun fichier de mapping n'est écrit. Sortie
persistante : un Markdown par fichier. Dans le
pipeline d'administration d'un dossier, `-o` vise le sous-dossier
`Fichiers convertis PieceMaker/` du dossier (racine réservée aux originaux) ;
le manifeste technique caché `.piecemaker/anonymization-state.json` reste, lui, à
la racine du dossier, et sa clé est relative à la racine via `--case-root`. Les
détections brutes par fichier restent temporaires et sont supprimées après leur
fusion.
