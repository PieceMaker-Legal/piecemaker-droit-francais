import fs from 'node:fs';
import path from 'node:path';

export const VOLETS = ['dossier', 'index', 'tabular-review', 'tampon'];
export const REVIEW_FOLDER = 'Tabular Review';
export const COLUMN_FORMATS = ['text', 'list', 'date', 'amount', 'yes_no', 'tags'];
export const RESEARCH_SOURCES = ['cassation', 'appel', 'conseil_etat', 'caa', 'premiere_instance'];
export const CASSATION_MATIERES = ['CIVIL', 'COMMERCIAL', 'PENAL', 'SOCIAL'];
export const PREMIERE_INSTANCE_TYPES = ['TRIBUNAL_JUDICIAIRE', 'TRIBUNAL_GRANDE_INSTANCE', 'TRIBUNAL_INSTANCE', 'TRIBUNAL_COMMERCE', 'CONSEIL_PRUDHOMMES', 'TRIBUNAL_CORRECTIONNEL', 'TRIBUNAL_SECURITE_SOCIALE', 'TRIBUNAL_BAUX_RURAUX', 'JURIDICTION_PROXIMITE', 'OUTRE_MER', 'TRIBUNAL_CONFLITS'];

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const literal = (value) => `'${String(value).replace(/'/g, "''")}'`;

export function chronologieSql({ action, dossier, piece, date, libelle }) {
  const scope = dossier && String(dossier).trim() ? `dossier(${literal(String(dossier).trim())})` : 'dossier()';
  if (action === 'lister') {
    return `SELECT id, doc_date AS date, label AS libelle, json_extract(data_json, '$.nature') AS nature FROM piecemaker_nodes WHERE project_id = ${scope} AND kind = 'document' ORDER BY doc_date IS NULL, doc_date, label`;
  }
  if (!piece || !String(piece).trim()) throw new Error('Indiquez la pièce à modifier (colonne id de « lister »).');
  const changes = [];
  if (date !== undefined) {
    if (date !== '' && !DATE.test(date)) throw new Error('Date attendue au format AAAA-MM-JJ, ou chaîne vide pour l’effacer.');
    changes.push(`doc_date = ${date ? literal(date) : 'NULL'}`);
  }
  if (libelle !== undefined) {
    if (!String(libelle).trim()) throw new Error('Le libellé ne peut pas être vide.');
    changes.push(`label = ${literal(String(libelle).trim())}`);
  }
  if (!changes.length) throw new Error('Indiquez une date ou un libellé.');
  return `UPDATE piecemaker_nodes SET ${changes.join(', ')} WHERE project_id = ${scope} AND kind = 'document' AND id = ${literal(String(piece).trim())}`;
}

export async function tabularIndex(tabularFn, { action, project, ...input }) {
  if (action === 'arborescence') return tabularFn({ ...input, action, project });
  const found = await tabularFn({ action: 'index', project });
  if (action === 'ouvrir') return found;
  if (action === 'preparer' || action === 'lancer') {
    if (!found.projet) throw new Error('L’index est déjà lancé : utilisez colonnes pour ses questions, ou relancer pour les nouvelles pièces.');
    return tabularFn({ ...input, action, project, projet: found.projet });
  }
  if (!found.fichier) throw new Error('L’index n’est pas encore lancé : lancez-le avec lancer, sur accord de l’avocat.');
  return tabularFn({ ...input, action, project, fichier: found.fichier });
}

export async function refuseIndex(tabularFn, project, { fichier, projet }) {
  const name = typeof fichier === 'string' ? path.basename(fichier.trim()) : '';
  const draft = typeof projet === 'string' ? projet.trim() : '';
  if (!name && !draft) return;
  const { analyses = [], projets = [] } = await tabularFn({ action: 'lister', project });
  const isIndex = [...analyses, ...projets].some((entry) => entry.index && ((name && entry.fichier === name) || (draft && entry.projet === draft)));
  if (isIndex) throw new Error('L’index du dossier s’affiche toujours dans l’onglet Dossier : utilisez tabular_review_index.');
}

export function reviewFile(dossier, fichier) {
  const name = path.basename(String(fichier ?? '').trim());
  if (!name.endsWith('.json')) throw new Error('Indiquez le fichier JSON de la review (colonne fichier de « lister »).');
  const file = path.join(dossier, REVIEW_FOLDER, name);
  if (!fs.existsSync(file)) throw new Error(`Tabular review introuvable : ${name}`);
  return name;
}
