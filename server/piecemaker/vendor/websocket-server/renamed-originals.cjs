const fs = require('node:fs');
const path = require('node:path');

const {
  anonymizationStateFile,
  readAnonymizationState,
  stateKey,
  statFingerprint,
} = require('../piecemaker-plugin/scripts/lib/anonymization-state.cjs');
const { originalFilesOverview, safeCaseFiles } = require('../piecemaker-plugin/scripts/lib/commits.cjs');
const {
  documentKey,
  markdownCounterpart,
  readProtection,
  relativeKey,
  WORKSPACE_SUBDIR,
  writeProtection,
} = require('../piecemaker-plugin/scripts/lib/protection.cjs');
const { documentIndexFile } = require('./document-index.cjs');
const { STAMPED_PIECES_SUBFOLDER } = require('./lib/stamping.cjs');

const HASH_KEY = /^[a-f0-9]{64}$/i;
const PIECE_NAME = /^(\d{4}-\d{2}-\d{2})_\S/;
const FORBIDDEN_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f]/;
const MAX_NAME_LENGTH = 150;
// Dossiers produits par PieceMaker : une pièce n'y est jamais rangée.
const GENERATED_FOLDERS = new Set([WORKSPACE_SUBDIR, 'Tabular Review', STAMPED_PIECES_SUBFOLDER]);

const fingerprintId = ({ size, mtimeMs }) => `${size}:${mtimeMs}`;

const absoluteIn = (root, relative) => path.join(root, ...relative.split('/'));

const stemOf = (file) => path.basename(file, path.extname(file));

function readJsonObject(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJsonAtomically(file, value, spacing) {
  const temporary = `${file}.piecemaker-${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, spacing)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
}

function moveEntry(record, from, to) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return;
  const source = Object.keys(record).find((key) => (HASH_KEY.test(key) ? key.toLowerCase() : stateKey(key)) === from);
  if (!source) return;
  const entry = record[source];
  delete record[source];
  record[to] = entry;
}

function orphanKeysByFingerprint(root, originals) {
  const liveKeys = new Set(originals.map((file) => stateKey(file.path)));
  const orphans = new Map();
  for (const [key, entry] of Object.entries(readAnonymizationState(root).files)) {
    if (liveKeys.has(key) || !entry.converted) continue;
    const id = fingerprintId(entry.converted);
    orphans.set(id, [...(orphans.get(id) || []), key]);
  }
  return orphans;
}

async function markdownStems(root) {
  try {
    const files = await safeCaseFiles(root);
    return [...new Set(files.filter((file) => path.extname(file).toLowerCase() === '.md').map(stemOf))];
  } catch {
    return [];
  }
}

function previousPathCandidates(root, file, orphanKeys, stems) {
  const directory = path.posix.dirname(file.path);
  const prefix = directory === '.' ? '' : `${directory}/`;
  const extension = path.posix.extname(file.path);
  return stems
    .map((stem) => `${prefix}${stem}${extension}`)
    .filter((previous) => previous !== file.path
      && orphanKeys.has(stateKey(previous))
      && !fs.existsSync(absoluteIn(root, previous)));
}

function uniqueRenames(candidates) {
  const claims = new Map();
  for (const { previous } of candidates) claims.set(previous, (claims.get(previous) || 0) + 1);
  return candidates.filter(({ previous }) => claims.get(previous) === 1);
}

function renameMarkdown(root, { previous, current }) {
  const markdown = markdownCounterpart(absoluteIn(root, previous), root);
  if (!markdown.exists) return false;
  const target = path.join(path.dirname(markdown.path), `${stemOf(current)}.md`);
  if (fs.existsSync(target)) return false;
  fs.renameSync(markdown.path, target);
  return true;
}

function migrateAnonymizationState(root, renames) {
  const file = anonymizationStateFile(root);
  const state = readJsonObject(file);
  if (!state) return;
  for (const { previous, current } of renames) moveEntry(state.files, stateKey(previous), stateKey(current));
  writeJsonAtomically(file, state, 2);
}

function migrateDocumentIndex(root, renames) {
  const file = documentIndexFile(root);
  const index = readJsonObject(file);
  if (!index) return;
  for (const { previous, current } of renames) {
    const from = stateKey(previous);
    const to = stateKey(current);
    for (const section of ['documents', 'overrides', 'entityDecisions']) moveEntry(index[section], from, to);
    for (const revision of Array.isArray(index.revisions) ? index.revisions : []) {
      if (revision && String(revision.documentKey || '').toLowerCase() === from) revision.documentKey = to;
    }
  }
  writeJsonAtomically(file, index);
}

function migrateProtection(root, renames) {
  const protection = readProtection(root);
  if (!protection.exists) return;
  const moved = new Map(renames.map(({ previous, current }) => [previous, current]));
  if (![...protection.unprotected, ...protection.resources].some((key) => moved.has(key))) return;
  const move = (keys) => [...keys].map((key) => moved.get(key) || key);
  writeProtection(root, { unprotected: move(protection.unprotected), resources: move(protection.resources) });
}

/** Reporte un renommage sur tout l'état indexé par chemin : anonymisation, index, protection. */
function migrateRenames(root, renames) {
  migrateAnonymizationState(root, renames);
  migrateDocumentIndex(root, renames);
  migrateProtection(root, renames);
}

/** Nom de pièce `AAAA-MM-JJ_<titre>` : date réelle, titre non vide, utilisable comme nom de fichier. */
function validatedPieceName(value) {
  const name = String(value || '').normalize('NFC').trim();
  const date = PIECE_NAME.exec(name)?.[1];
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!date || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new TypeError('Le nom doit commencer par une date AAAA-MM-JJ, suivie de « _ » et du titre de la pièce.');
  }
  if (FORBIDDEN_NAME_CHARACTERS.test(name)) throw new TypeError('Le nom ne peut contenir aucun des caractères / \\ : * ? " < > |.');
  if (name.length > MAX_NAME_LENGTH) throw new TypeError(`Le nom dépasse ${MAX_NAME_LENGTH} caractères.`);
  return name;
}

/** Sous-dossier de rangement, relatif au dossier juridique (`''` pour la racine). */
function validatedDirectory(value) {
  const segments = String(value).normalize('NFC').replaceAll('\\', '/').split('/').map((segment) => segment.trim()).filter(Boolean);
  if (segments.some((segment) => segment === '..' || segment.startsWith('.') || FORBIDDEN_NAME_CHARACTERS.test(segment))) {
    throw new TypeError(`Dossier de rangement invalide : ${value}`);
  }
  if (segments.length && GENERATED_FOLDERS.has(segments[0])) throw new TypeError(`Une pièce ne se range pas dans « ${segments[0]} ».`);
  return segments.join('/');
}

/**
 * Renomme une pièce et/ou la range dans un autre sous-dossier, en gardant la
 * parité avec son Markdown : le `.md` prend le même nom et l'état indexé par
 * chemin suit la pièce. Sans nouveau nom, la pièce garde le sien ; sans dossier,
 * elle reste dans le sien. Le nom doit rester unique dans le dossier juridique,
 * le Markdown converti étant rangé à plat.
 */
async function renamePiece(caseRoot, piecePath, newName, targetDirectory) {
  const root = fs.realpathSync(caseRoot);
  const renaming = String(newName ?? '').trim() !== '';
  const requested = relativeKey(path.resolve(root, String(piecePath || '')), root)?.normalize('NFC');
  const originals = await originalFilesOverview(root);
  const piece = originals.find((file) => file.path.normalize('NFC') === requested);
  if (!piece) throw new TypeError(`Pièce introuvable dans le dossier : ${piecePath}`);
  const previous = piece.path;
  const extension = path.posix.extname(previous);
  const name = renaming ? validatedPieceName(newName) : path.posix.basename(previous, extension);
  const directory = targetDirectory === undefined || targetDirectory === null
    ? path.posix.dirname(previous).replace(/^\.$/, '')
    : validatedDirectory(targetDirectory);
  const current = `${directory ? `${directory}/` : ''}${name}${extension}`;
  const key = documentKey(name);
  const ownKey = documentKey(previous);
  const taken = originals.some((file) => file.path !== previous && documentKey(file.path) === key)
    || (key !== ownKey && (await markdownStems(root)).some((stem) => documentKey(stem) === key));
  if (taken) throw new TypeError(`Une autre pièce du dossier porte déjà ce nom : ${name}`);
  if (current !== previous) {
    if (current.toLowerCase() !== previous.toLowerCase() && fs.existsSync(absoluteIn(root, current))) {
      throw new TypeError(`Un fichier existe déjà à cet emplacement : ${current}`);
    }
    fs.mkdirSync(path.dirname(absoluteIn(root, current)), { recursive: true });
    fs.renameSync(absoluteIn(root, previous), absoluteIn(root, current));
    renameMarkdown(root, { previous, current });
    migrateRenames(root, [{ previous, current }]);
  }
  const markdown = markdownCounterpart(absoluteIn(root, current), root);
  return { previous, current, markdown: markdown.exists ? relativeKey(markdown.path, root) : null };
}

async function reconcileRenamedOriginals(caseRoot, originals) {
  const root = fs.realpathSync(caseRoot);
  const orphans = orphanKeysByFingerprint(root, originals);
  if (!orphans.size) return [];
  const suspects = originals
    .filter((file) => !file.converted)
    .map((file) => ({ file, keys: orphans.get(fingerprintId(statFingerprint(fs.statSync(absoluteIn(root, file.path))))) }))
    .filter(({ keys }) => keys);
  if (!suspects.length) return [];
  const stems = await markdownStems(root);
  const candidates = suspects.flatMap(({ file, keys }) => {
    const matches = previousPathCandidates(root, file, new Set(keys), stems);
    return matches.length === 1 ? [{ previous: matches[0], current: file.path }] : [];
  });
  const renames = uniqueRenames(candidates).filter((rename) => renameMarkdown(root, rename));
  if (!renames.length) return [];
  migrateRenames(root, renames);
  return renames;
}

module.exports = { reconcileRenamedOriginals, renamePiece };
