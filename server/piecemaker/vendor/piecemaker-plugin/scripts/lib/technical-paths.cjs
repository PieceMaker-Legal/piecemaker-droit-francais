/**
 * Chemins techniques d'un dossier juridique : la liste unique de ce qui n'est
 * jamais une pièce, et que l'arborescence ne liste, ne classe ni ne déplace.
 *
 * Deux niveaux :
 * - `isIgnoredName` : noms jamais parcourus, par aucun recensement (fichiers et
 *   dossiers cachés comme `.piecemaker` ou `.git`, verrous Office `~$…`,
 *   arborescences de code comme `node_modules`).
 * - `isTechnicalPath` : en plus, tout ce qui vit sous un dossier produit par
 *   PieceMaker — dont `Fichiers convertis PieceMaker`, où sont rangées les
 *   pièces `.md` converties. L'arborescence (classement, pièces à classer,
 *   déplacements, dossiers de l'arborescence) s'en sert.
 *
 * Module pur, sans dépendance Node : les hooks, le serveur et les interfaces
 * des plugins l'importent tels quels.
 */

/** Sous-dossier où la conversion écrit le Markdown de chaque pièce (et le mapping). */
const CONVERTED_FOLDER = 'Fichiers convertis PieceMaker';
/** Exports des analyses tabulaires. */
const REVIEW_FOLDER = 'Tabular Review';
/** Copies tamponnées des pièces. */
const STAMPED_FOLDER = 'Pièces tamponnées';
/** Dossier technique de chaque dossier juridique (état, index, caches). */
const PIECEMAKER_FOLDER = '.piecemaker';

/** Dossiers produits par PieceMaker : ni pièces à classer, ni destinations de rangement. */
const GENERATED_FOLDERS = Object.freeze([CONVERTED_FOLDER, REVIEW_FOLDER, STAMPED_FOLDER]);

/**
 * Arborescences techniques jamais parcourues (comparées sans casse). Un dossier
 * juridique finit par héberger autre chose que des pièces, par exemple une copie
 * de projet Node dont les milliers de fichiers noieraient la liste des pièces.
 * `piecemaker_output` est l'ancien dossier de sortie, qui n'est pas un dossier
 * juridique.
 */
const IGNORED_DIRECTORY_NAMES = Object.freeze([
  'node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'target', '__pycache__', 'venv',
  'piecemaker_output',
]);

const generated = new Set(GENERATED_FOLDERS.map((name) => name.normalize('NFC').toLowerCase()));
const ignored = new Set(IGNORED_DIRECTORY_NAMES);

const clean = (value) => String(value ?? '').normalize('NFC').trim();

/** Segments d'un chemin relatif au dossier juridique, `\` comme `/`. */
function segmentsOf(relativePath) {
  return clean(relativePath).replaceAll('\\', '/').split('/').map((segment) => segment.trim()).filter((segment) => segment && segment !== '.');
}

/**
 * Nom jamais parcouru : caché (`.piecemaker`, `.git`, `.DS_Store`…), verrou
 * Office (`~$…`) ou arborescence de code (`node_modules`…).
 */
function isIgnoredName(name) {
  const value = clean(name);
  if (!value) return false;
  return value.startsWith('.') || value.startsWith('~$') || ignored.has(value.toLowerCase());
}

/** Nom d'un dossier produit par PieceMaker (`Fichiers convertis PieceMaker`…). */
function isGeneratedFolderName(name) {
  return generated.has(clean(name).toLowerCase());
}

/** Segment technique : ignoré partout ou dossier produit par PieceMaker. */
function isTechnicalName(name) {
  return isIgnoredName(name) || isGeneratedFolderName(name);
}

/**
 * Vrai si le chemin (relatif au dossier juridique) est technique ou passe par
 * un dossier technique : `.piecemaker/…`, `Fichiers convertis PieceMaker/x.md`,
 * `node_modules/…`, `a/.git/…`. Un chemin qui sort du dossier (`..`) l'est aussi.
 */
function isTechnicalPath(relativePath) {
  return segmentsOf(relativePath).some((segment) => segment === '..' || isTechnicalName(segment));
}

/** Refuse un chemin technique, pour les opérations qui touchent au disque. */
function assertNotTechnicalPath(relativePath, what = 'Ce chemin') {
  if (isTechnicalPath(relativePath)) {
    throw new TypeError(`${what} relève d’un dossier technique de PieceMaker et n’entre pas dans l’arborescence : ${clean(relativePath)}`);
  }
}

module.exports = {
  CONVERTED_FOLDER,
  GENERATED_FOLDERS,
  IGNORED_DIRECTORY_NAMES,
  PIECEMAKER_FOLDER,
  REVIEW_FOLDER,
  STAMPED_FOLDER,
  assertNotTechnicalPath,
  isGeneratedFolderName,
  isIgnoredName,
  isTechnicalName,
  isTechnicalPath,
};
