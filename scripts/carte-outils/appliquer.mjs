#!/usr/bin/env node
import fs from 'node:fs';
import { ROOT, applyEdit, commitChanges, embedSnapshot } from './graph.mjs';

const [file, ...rest] = process.argv.slice(2);
if (!file) {
  console.error('Usage : node scripts/carte-outils/appliquer.mjs modifications.json ["message de commit"]');
  process.exit(2);
}
const edits = JSON.parse(fs.readFileSync(file, 'utf8'));
const results = edits.map((edit) => {
  try {
    if (typeof edit.id !== 'string' || typeof edit.lu !== 'string') throw new Error('id et lu attendus.');
    const r = applyEdit(ROOT, edit.id, edit.lu, typeof edit.expected === 'string' ? edit.expected : undefined);
    return { id: edit.id, statut: r.unchanged ? 'inchangee' : 'appliquee' };
  } catch (error) {
    return { id: edit.id, statut: 'refusee', erreur: error.message };
  }
});
const commit = commitChanges(ROOT, rest.join(' '));
if (commit.committed) embedSnapshot(ROOT);
console.log(JSON.stringify({ results, commit }, null, 2));
