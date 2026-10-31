# PP-OCRv6 Small dans PieceMaker

PP-OCRv6 Small remplace directement MinerU pour les PDF scannés et les images.
MarkItDown conserve les documents textuels et Office. Les anciens Markdown restent réutilisables.
Les formats d'état, noms de sortie et messages de progression du pipeline sont conservés.

## Modèles et installation

Les bibliothèques sont déclarées dans les dépendances du convertisseur et les verrous Python Mac ARM64 et Windows x64.
PaddleOCR 3.7.0 et PaddleX 3.7.2 utilisent ONNX Runtime sur CPU.
Les verrous conservent les autres versions, sauf NumPy 2.3.5 et PyYAML 6.0.2, exigés par cette combinaison.
Les bibliothèques ne sont pas installées par pip au premier appel d'un runtime géré.

Comme GLiNER, Small télécharge ses modèles séparément avec `huggingface_hub.snapshot_download`.
`ocr-small-checkpoints.json` fixe les dépôts, révisions, tailles et empreintes SHA-256 des fichiers officiels :

- [Détection Small ONNX](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_det_onnx/tree/28fe5895c24fd108c19eb3e8479f4ab385fbfc62).
- [Reconnaissance Small ONNX](https://huggingface.co/PaddlePaddle/PP-OCRv6_small_rec_onnx/tree/b8f84f0b80c529de40b4fbb3544b84fa7233a513).

Environ 31 Mo sont téléchargés dans le cache Hugging Face habituel, selon `HF_HOME`, `HF_HUB_CACHE` ou `HUGGINGFACE_HUB_CACHE`.
L'étape existante `04-conversion-md` vérifie les empreintes avant de déclarer les modèles prêts.
Le runtime charge uniquement ces snapshots locaux. Aucune pièce n'est envoyée à un service OCR.
La suppression retire seulement les snapshots marqués comme provisionnés par PieceMaker.
Elle conserve les blobs partagés, les autres révisions, les anciens modèles MinerU et les bibliothèques Python.

L'identifiant API `mineru` est conservé pour les interfaces déjà ouvertes.
Il désigne désormais Small, dans l'état, l'installation et la suppression.
`--engine small` force le nouvel OCR ; `--engine mineru` reste son alias de compatibilité.

## Conversion

`ocr_small.py` rend chaque page PDF à 300 DPI et lance un worker distinct.
Le worker utilise le profil OCR officiel du benchmark, sans orientation automatique ni redressement, avec deux threads CPU.
`ocr_markdown.py` regroupe les boîtes du JSON par hauteur, puis cherche des alignements numériques répétés.
Les zones suffisamment régulières deviennent des tableaux Markdown ; le reste reste du texte dans l'ordre de lecture.
Les cellules manquantes restent vides. Le traitement conserve chaque texte reconnu sans inventer de valeur.

Le superviseur mesure l'empreinte mémoire sous macOS et la mémoire résidente ailleurs.
Il arrête le worker au-delà de 35 % de la RAM totale ou sous 10 % de mémoire disponible, avec un minimum de 512 Mio.
`PIECEMAKER_OCR_RAM_BYTES` et `PIECEMAKER_OCR_FREE_FLOOR_BYTES` permettent d'ajuster ces seuils.
Les anciens réglages `PIECEMAKER_MINERU_*` correspondants restent acceptés.
La disparition du superviseur arrête aussi le worker.
Le Markdown final remplace l'ancien fichier seulement après la réussite de toutes les pages.
Les JSON intermédiaires restent dans un répertoire temporaire privé, supprimé à la fin.

Les coordonnées ne résolvent pas une boîte OCR contenant plusieurs cellules fusionnées.
Les tableaux purement textuels ou sans alignements numériques suffisants restent du texte.
Les colonnes complexes et les cellules fusionnées demandent donc une relecture ; ce traitement ne certifie pas leur structure.

## Vérification

Les contrôles couvrent les cellules vides, l'ordre du texte, les coordonnées invalides et un téléchargement corrompu.
Les tests existants couvrent aussi la reprise sans OCR, les PDF mixtes, l'installation et sa boîte de dialogue.
Un essai local fictif vérifie la chaîne PDF scanné → Small → JSON → Markdown et le nom de sortie demandé.
Un plafond mémoire volontairement insuffisant vérifie la conservation du PDF et du Markdown antérieur.
Les trois corpus existants sont relus depuis leurs JSON, sans relancer l'OCR lourd ni copier leurs données dans le dépôt.
La résolution des dépendances pour Windows ne remplace pas une installation réelle sous Windows.
