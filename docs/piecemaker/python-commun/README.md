# Faisabilité d'un environnement Python commun — 22 octobre 2026

## Conclusion et portée

Une combinaison des dépendances actuelles de conversion, GLiNER, MinerU, Mistral Vibe et Légifrance est résoluble pour **CPython 3.12 / Windows x64**. Le calcul aboutit à **199 paquets** sans modifier les contraintes du dépôt, avec uv 0.9.24 et PyPI. Leurs versions sont conservées dans [windows-py312-resolution.txt](windows-py312-resolution.txt) et les exigences d'entrée dans [requirements.in](requirements.in).

Il s'agit d'une preuve de compatibilité des dépendances déclarées et de disponibilité des distributions, pas d'une validation fonctionnelle du runtime commun sur Windows. Aucun environnement PieceMaker installé n'a été modifié ; aucun modèle n'a été téléchargé ; aucune connexion à un compte fournisseur ni lecture de secrets n'a été effectuée.

## Exigences par élément

| Élément | Exigence actuelle dans PieceMaker | Python annoncé par le paquet | Version retenue par la résolution |
| --- | --- | --- | --- |
| Socle Python Windows | Archive Python 3.12 ; le bootstrap accepte 3.10 à 3.12 | Le sélecteur Vibe PieceMaker n'accepte que 3.12 et 3.13 | **3.12.x**, seule intersection actuelle des sélecteurs Windows |
| Conversion MarkItDown | `markitdown[all]>=0.1.4` | >=3.10 pour la version retenue | **0.1.5**, avec tous les extras demandés |
| Inspection PDF | `pypdf>=6.6.2` | >=3.9 pour la version retenue | **6.21.2** |
| GLiNER local | `gliner2[local]>=2.1.0` | >=3.10 | **2.1.0**, profil `local` inclus |
| Téléchargement des modèles | `huggingface-hub>=0.20.0` | >=3.10 pour 1.16.1 | **1.16.1**, contraintes transitives incluses |
| MinerU OCR | `mineru==4.0.11`, moteurs ONNX et llama.cpp | >=3.10 et <3.15 | **4.0.11**, sans ajouter ses extras `torch` ou `full` sur Windows |
| Moteur natif MinerU | MinerU impose `mineru-llama-cpp>=0.1.2,<1` | >=3.10 | **0.1.3** |
| Mistral Vibe | `mistral-vibe==2.25.0` | >=3.12 | **2.25.0**, avec sa liste de versions exactes |
| Légifrance : HTTP | `requests>=2.31.0` | >=3.10 pour la version retenue | **2.34.2**, également imposée par Vibe |
| Légifrance : configuration | `python-dotenv>=1.0.0` | >=3.10 pour 1.2.2 | **1.2.2**, également imposée par Vibe |
| Légifrance : confiance TLS | `truststore>=0.9.1` | >=3.10 | **0.10.4**, également imposée par Vibe |

Le MCP Légifrance ne déclare pas de minimum Python global dans son fichier de requirements. Ses dépendances retenues, Vibe et les sélecteurs du bootstrap déterminent ici le choix commun. Les minima de Python de ce tableau proviennent des métadonnées `Requires-Python` des versions précises, pas de la seule dernière version publiée.

Sources du dépôt : `server/piecemaker/vendor/websocket-server/scripts/requirements.txt`, `server/piecemaker/vendor/mcp/legifrance/requirements.txt`, `server/piecemaker/vibe-install.ts`, `server/piecemaker/vendor/installer/steps/04-conversion-md.mjs`, `desktop-bootstrap/composants/install.mjs`.

## Principales contraintes croisées

| Bibliothèque | Contraintes significatives | Version résolue |
| --- | --- | --- |
| PyTorch | GLiNER `>=2.1,<3` ; PEFT `>=1.13` | **2.14.1** |
| Transformers | GLiNER `>=4.43,<6` ; PEFT en dépend aussi | **5.17.0** |
| Tokenizers | MinerU `>=0.22,<0.24` ; Transformers 5.17 `>=0.23.1,<0.24` | **0.23.3** |
| PEFT | GLiNER `>=0.10,<1` | **0.21.2** |
| Safetensors | GLiNER `>=0.4,<1` | **0.8.0** |
| NumPy | GLiNER `>=1.24,<3` ; MinerU `>=1.21.6` ; Gradio `<3` | **2.5.4** |
| ONNX Runtime | MinerU `>=1.20.1` | **1.31.0** |
| Pydantic | GLiNER `>=2,<3` ; MinerU `>=2.12.5,<3` ; Vibe `==2.13.4` | **2.13.4** |
| HTTPX | Vibe `==0.28.1` ; Gradio `>=0.24.1,<1` | **0.28.1** |
| Starlette | Vibe `==1.3.1` ; Gradio `>=1.0.1,<2` ; FastAPI `>=0.46` | **1.3.1** |
| FastAPI | MinerU sans borne ; Gradio `>=0.115.2,<1` | **0.141.1** |
| Protobuf | Vibe `==6.33.6` | **6.33.6** |
| Certifi | Vibe `==2026.7.22` | **2026.7.22** |
| Gradio | MinerU `>=6.8,<7` | **6.30.0** |

Ces versions constituent une combinaison calculée, pas un choix déjà qualifié pour la production. La présence de roues Windows ne prouve pas le chargement effectif de toutes les DLL natives.

Le modèle GLiNER n'a pas de version pip : PieceMaker épingle séparément `fastino/gliner2-privacy-filter-PII-multi` à la révision `59894c087cb2923b01f337d4ee72f6ff84d5bdd6`. MinerU utilise les répertoires de modèles `MinerU-4_models_onnx` et `MinerU2.5-Pro-2605-1.2B-GGUF`. Ces poids restent hors du venv et leur chargement n'a pas été testé dans cet essai.

## Deux réserves établies expérimentalement

### Les versions récentes de chaque composant ne sont pas toutes compatibles

Forcer **MarkItDown 0.1.9** avec **Vibe 2.25.0** fait échouer la résolution : le premier exige `certifi>=2026.10.19`, le second `certifi==2026.7.22`. C'est un conflit réel, indépendant du nombre de fichiers ou de la plateforme.

La sélection initiale de MarkItDown 0.1.5 ne vient cependant pas uniquement de Vibe : les extras `all` des versions 0.1.6 à 0.1.8 demandent une préversion d'Azure Content Understanding, que la politique du résolveur ne sélectionne pas implicitement ici. En ajoutant explicitement `azure-ai-contentunderstanding==1.2.0b1`, un second calcul réussit avec **MarkItDown 0.1.8**, dans un ensemble de **200 paquets**. Cette variante n'est pas le manifeste conservé et introduit une dépendance bêta ; elle montre que 0.1.5 n'est pas une limite intrinsèque du venv commun.

Conclusion pratique : choisir une combinaison commune signifie coordonner les mises à jour de Vibe et de la conversion. Ne pas utiliser `--no-deps` ou écraser une contrainte pour faire disparaître le conflit.

### Un paquet doit être construit avant distribution

L'examen des fichiers publiés sur PyPI pour les 199 versions a trouvé **198 distributions wheel compatibles avec CPython 3.12 / Windows x64**. Seul **Jieba 0.42.1**, demandé par MinerU, est distribué uniquement en source. Une résolution avec `--only-binary :all:` échoue donc sur ce paquet.

Une construction isolée avec `pip wheel --no-deps --use-pep517 jieba==0.42.1` a produit `jieba-0.42.1-py3-none-any.whl`, sans modifier les environnements applicatifs. En proposant cette roue locale au résolveur, le calcul des **199 mêmes versions** réussit avec `--only-binary :all:`. Elle est universelle et ne dépend pas d'un compilateur C++ sur le poste utilisateur. Le test a construit la roue sur macOS ; il n'a pas exécuté ce paquet sous Windows. Aucun binaire n'est ajouté au dépôt.

## Reproduction du calcul

Depuis la racine du dépôt, dans un répertoire de travail temporaire :

```sh
uv --no-config pip compile docs/piecemaker/python-commun/requirements.in \
  --constraints docs/piecemaker/python-commun/windows-py312-resolution.txt \
  --python-platform x86_64-pc-windows-msvc --python-version 3.12 \
  --default-index https://pypi.org/simple --no-header --no-annotate \
  --output-file /tmp/piecemaker-python-windows-resolution.txt
```

Pour tester le parcours entièrement précompilé, construire Jieba dans un dossier temporaire avec `python -m pip wheel --no-deps --use-pep517 --wheel-dir <roues> jieba==0.42.1`, puis ajouter `--only-binary :all: --find-links <roues>` à la commande uv. Les fichiers de cette étude ne sont utilisés par aucun installateur : ils n'effectuent pas une migration de l'application et ne constituent pas un verrou de production avec empreintes.

## Adaptations encore nécessaires dans PieceMaker

L'installation commune ne suffit pas à elle seule : le résolveur Vibe et son streaming ciblent actuellement `.piecemaker/vibe`, le lanceur Légifrance crée son propre `.venv` et les moteurs locaux utilisent `config.pythonPath` / `config.venvPath`. Ces consommateurs doivent être alignés sur un interpréteur commun, puis les installations à la demande doivent cesser de le modifier avec pip.

Avant adoption : construire l'environnement Windows en CI, vérifier tous les imports natifs et `pip check`, puis exécuter une conversion Word fictive, une conversion OCR, une inférence du modèle GLiNER épinglé, le protocole MCP Légifrance et le streaming Vibe à travers le proxy. Ajouter un essai de mise à jour et de retour arrière. Un venv commun est compatible au niveau des exigences ; ces essais restent nécessaires pour le qualifier fonctionnellement.

Les exécutables Node/Electron, Git, le proxy Rust et le binaire `docx` restent indépendants de Python : un venv unique ne les absorbe pas. Les processus GLiNER, MinerU, Vibe et MCP peuvent rester distincts tout en utilisant le même interpréteur.

## Sources des métadonnées

Métadonnées JSON PyPI lues pour les versions précises et contrôle des tags des wheels avec `packaging` 24.2 : [Vibe 2.25.0](https://pypi.org/pypi/mistral-vibe/2.25.0/json), [MinerU 4.0.11](https://pypi.org/pypi/mineru/4.0.11/json), [GLiNER2 2.1.0](https://pypi.org/pypi/gliner2/2.1.0/json), [MarkItDown 0.1.5](https://pypi.org/pypi/markitdown/0.1.5/json), [MarkItDown 0.1.9](https://pypi.org/pypi/markitdown/0.1.9/json), [Jieba 0.42.1](https://pypi.org/pypi/jieba/0.42.1/json). Les dépendances transitives ont également été contrôlées à leur version résolue.
