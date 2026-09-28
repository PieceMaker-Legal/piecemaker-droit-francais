const fs = require('node:fs');
const path = require('node:path');

const {
  anonymizationStateFile,
  readAnonymizationState,
  stateKey,
  statFingerprint,
} = require('../piecemaker-plugin/scripts/lib/anonymization-state.cjs');
const { safeCaseFiles } = require('../piecemaker-plugin/scripts/lib/commits.cjs');
const { markdownCounterpart } = require('../piecemaker-plugin/scripts/lib/protection.cjs');
const { documentIndexFile } = require('./document-index.cjs');

const HASH_KEY = /^[a-f0-9]{64}$/i;

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
  migrateAnonymizationState(root, renames);
  migrateDocumentIndex(root, renames);
  return renames;
}

module.exports = { reconcileRenamedOriginals };
