# PieceMaker

Assistant IA pour le droit français : chat juridique, chronologie de dossier,
recherche et rédaction de brouillons — bâti sur [CloudCLI](docs/README.md) et
le harnais de citations [Mike](https://github.com/open-legal-products/mike).

## Installation

macOS / Linux :

```
curl -fsSL https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/scripts/piecemaker/cli/piecemaker.sh | sh
```

Windows (PowerShell) :

```
irm https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/scripts/piecemaker/cli/piecemaker.ps1 | iex
```

Chaque commande clone le dépôt si besoin, installe le socle (proxy
d'anonymisation, MCP, GLiNER) puis l'application, et ouvre le chat sur
`http://localhost:5173`. Aucune des deux n'installe Ollama.

## Anonymisation

Aucune pièce en clair ne quitte la machine : un proxy PII local
pseudonymise chaque requête (scan GLiNER, mapping réversible) avant tout
appel à un modèle, et ré-identifie la réponse au retour. Les modèles ne
voient jamais un nom, une adresse ou une pièce réelle.

## Mike — citations vérifiées

Chaque décision ou disposition citée par l'assistant est vérifiée
mécaniquement contre le texte réellement lu dans le tour de conversation :
recherche de sous-chaîne tolérante à la casse, aux espaces et à la
ponctuation, jamais un jugement du modèle. Un extrait retrouvé est recalé
sur sa source, un extrait introuvable est signalé — jamais surligné à tort.
Un panneau de lecture permet d'ouvrir chaque citation à côté du chat.

## CloudCLI

PieceMaker est un fork de CloudCLI : l'interface de chat, la gestion des
sessions et le socle applicatif viennent de ce projet, sur lequel les
ajouts juridiques (harnais Mike, anonymisation, chronologie, graphe
juridique) se branchent sans modifier le code d'origine.
