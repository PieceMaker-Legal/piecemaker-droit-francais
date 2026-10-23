# Installation macOS depuis un profil vierge : plugins et pipeline

Essai réel du 23 octobre 2026 sur macOS Apple Silicon, branche `MAJ-continue`, avec documents entièrement fictifs. Le parcours a révélé un défaut de sélection du Python, corrigé puis vérifié dans l’application Electron.

## Périmètre du banc

Le banc `~/.piecemaker-clean-mac/` possède une identité d’application, un profil utilisateur, une base, des certificats et des caches séparés. Le serveur utilise le port 3229. Avant installation, les données PieceMaker, les profils fournisseurs et le cache Hugging Face sont absents. Aucun Node, npm, Python, Vibe, Claude, Codex ou Git externe n’est exposé dans le PATH initial.

Le paquet local reprend l’enveloppe Electron et l’interface compilée 2.0.43 du banc précédent. Il embarque le backend de la branche, les cinq plugins recompilés et une archive Python commune préparée localement. Les ressources suivent les exclusions du packaging existant. L’installation utilise le Node d’Electron et `installRuntimeComponents({ requirePrebuilt: true })`, avec contrôle d’empreinte, extraction et validation de l’archive. Le Python installé et le modèle GLiNER sont placés dans les répertoires neufs du banc.

Le Mac conserve ses logiciels habituels. Cette isolation par profil est complétée par le contrôle des processus réellement exécutés et des bibliothèques natives du runtime. La qualification d’une nouvelle DMG distribuée, signée Developer ID et notarisée reste un parcours distinct.

## Défaut reproduit et correctif

Le premier scan échoue à 25 %, après deux tentatives de chargement du scanner GLiNER. Les processus observés utilisent le Python système du Mac. Le wrapper `pythonExecutable()` de `server/piecemaker/knowledge/pipeline.ts` ne consultait pas `config.json` et définissait `PYTHON_PATH=python3`, ce qui prenait la priorité sur le bon chemin configuré dans le lanceur existant. La résolution d’environnement d’Electron avait réexposé un Python externe.

Le wrapper lit maintenant le chemin enregistré par l’installation. Un runtime marqué `shared` est prioritaire sur un `PYTHON_PATH` externe ; son absence produit une erreur demandant de réinstaller les composants. Les installations historiques gardent leur possibilité de surcharge et peuvent utiliser leur interpréteur configuré. Le chemin explicitement injecté par un appelant reste prioritaire.

Deux tests échouent avant le correctif : choix du runtime commun avec une surcharge externe invalide, et refus de repli quand le runtime commun manque. Les sept tests ciblés du pipeline passent après correction, dont la compatibilité avec une installation historique. La compilation backend et le lint ciblé passent.

## Vérifications effectuées

| Contrôle | Résultat observé |
| --- | --- |
| Préparation CA, Python commun et `pip check` depuis le profil vide | Réussie, environ 259 secondes |
| Premier lancement natif | Écran de création de compte, puis création d’un compte fictif depuis l’interface |
| Parcours initial | Configuration d’identité fictive et fin de l’assistant, sans connexion à un compte IA réel |
| Plugins installés | Dossier, Bibliothèque, Analyse Tabulaire, Bordereau, Timesheet : cinq sur cinq |
| Ressources des plugins | Les cinq entrées JavaScript sont servies et activées |
| Serveur de plugin | Le RPC des modèles d’Analyse Tabulaire répond avec le Node embarqué |
| Contrôle visuel | Les cinq panneaux chargent leur contenu ; Bordereau voit les deux fichiers et Timesheet affiche son état vide |
| GLiNER | Installation déclenchée par `/configuration/install`, cache initialement vide, cinq fichiers du checkpoint conformes aux SHA-256 attendus |
| Conversion | DOCX et PDF avec couche texte convertis en deux Markdown ; le sélecteur du convertisseur choisit MarkItDown pour les deux |
| Scan après correction | Second dossier fictif neuf, deux fichiers analysés, personne détectée et pseudonyme enregistré en base |
| Interpréteur réellement utilisé | Le parent du pipeline et le worker GLiNER utilisent le Python du runtime commun installé dans le banc |
| Intégrité des originaux | Empreintes du DOCX et du PDF identiques avant et après le scan |
| Interface après scan | Bouclier de protection actif, cinq pseudonymes, personne fictive visible dans Dossier |
| Fermeture normale | Menu Quitter d’Electron ; serveur, helpers et processus natifs du banc arrêtés |
| Relance | Compte et cinq plugins conservés ; graphe strictement identique et empreintes des deux Markdown conservées |

Le scan après correction a pris environ 277 secondes sur ce poste. Ce temps comprend le chargement du modèle et le traitement des deux documents. Il s’agit d’une mesure ponctuelle sur le Mac de développement.

## Runtime contrôlé

Les 197 exigences du verrou macOS sont vérifiées dans l’interpréteur installé. L’inspection des commandes de chargement des 181 bibliothèques natives ne trouve aucune dépendance vers Homebrew ou un Python de développement externe. Les identifiants internes `LC_ID_DYLIB` sont distingués des dépendances effectivement chargées.

| Élément | Version vérifiée |
| --- | --- |
| Python | 3.12.15 |
| MarkItDown | 0.1.5 |
| GLiNER2 | 2.1.0 |
| Torch | 2.11.0 |
| Transformers | 5.17.0 |
| Mistral Vibe | 3.0.2 |
| MinerU | 4.0.11 |
| pypdf | 6.21.2 |
| python-docx | 1.2.0 |

Le checkpoint GLiNER vérifié est `59894c087cb2923b01f337d4ee72f6ff84d5bdd6`. Les journaux, empreintes, résultats HTTP et documents fictifs restent hors dépôt dans le répertoire `proof/` du banc ; les identifiants du compte de contrôle restent privés.

## Limites de cette validation

Le test qualifie l’installation locale des composants et plugins, puis le pipeline réel depuis des données et caches neufs. La signature du paquet de contrôle est locale. L’enregistrement de la CA dans le magasin de confiance macOS, une nouvelle DMG notarée et le téléchargement public de cette DMG restent à qualifier.

Les mises à jour d’interface sont désactivées dans ce banc pour conserver l’interface de contrôle ; leur cycle possède sa [validation distincte](validation-mistral-word-macos-2026-10-22.md). Aucun build Vite, incrément de version, push ou publication n’est effectué pour cet essai.

Les modèles OCR MinerU, les connexions aux fournisseurs IA et les appels Légifrance avec identifiants ne sont pas exercés ici. Windows et macOS Intel restent à tester sur leurs plateformes. Cet essai fonctionnel ne mesure pas la qualité générale de reconnaissance des entités.
