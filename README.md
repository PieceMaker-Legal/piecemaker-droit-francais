<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-sources/logo-white.png">
    <source media="(prefers-color-scheme: light)" srcset="public/logo-sources/logo-black.png">
    <img src="public/logo-sources/logo-black.png" alt="PieceMaker" width="140">
  </picture>
</p>

<h1 align="center">PieceMaker</h1>

<p align="center">L'assistant IA de l'avocat en droit français, installé sur son poste, qui travaille sur les pièces du dossier.</p>

- **Anonymiser les pièces** avant tout envoi à l'IA, et protéger les originaux du dossier.
- **Rechercher dans Légifrance et Judilibre**, avec vérification des citations.
- **Rédiger et réviser des documents Word**, avec propositions en suivi des modifications et playbooks de négociation.
- **Analyser un ensemble de documents** sous forme de tableau : une ligne par document, une colonne par question.
- **Suivre les échéances** de procédure ou de contrat de tous les dossiers, calculées et justifiées.
- **Préparer le bordereau** : tampon du cabinet et numérotation des pièces.
- **Suivre le temps passé** par dossier, avec Claude, Codex ou Mistral au choix.

## Installation

**Windows** (PowerShell) :

```powershell
irm https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/desktop-bootstrap/install.ps1 | iex
```

**macOS** (Terminal) :

```sh
curl -fsSL https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/desktop-bootstrap/install.sh | sh
```

Les deux commandes installent la dernière version publiée. Sous Windows, l'installeur `.exe` est aussi téléchargeable depuis la [page Releases](https://github.com/PieceMaker-Legal/piecemaker-droit-francais/releases/latest).

## Licence et attribution

PieceMaker est un fork orienté droit français de [CloudCLI UI](https://github.com/siteboon/claudecodeui), l'interface web open source pour Claude Code, Cursor CLI et Codex. Il est distribué sous licence AGPL-3.0-or-later ; les mentions et conditions de licence de CloudCLI restent applicables au code correspondant.
