#!/usr/bin/env node
import fs from 'node:fs';

const { results = [], commit = {} } = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const clean = (text) => String(text ?? '').replace(/[\r\n]+/g, ' ').replace(/[<>`]/g, '').slice(0, 300);
const lines = ['Modifications envoyées depuis la Carte des outils (docs/carte-outils.html).', ''];
if (commit.committed) {
  lines.push(`Commit ${clean(commit.commit)} : ${(commit.instructions || []).length} instruction(s).`, '');
  for (const titre of commit.instructions || []) lines.push(`- ${clean(titre)}`);
  lines.push('');
} else {
  lines.push(`Aucun commit : ${clean(commit.reason || 'rien à écrire')}.`, '');
}
const refused = results.filter((r) => r.statut === 'refusee');
if (refused.length) {
  lines.push(`${refused.length} modification(s) refusée(s) :`, '');
  for (const r of refused) lines.push(`- ${clean(r.id)} : ${clean(r.erreur)}`);
  lines.push('');
}
const unchanged = results.filter((r) => r.statut === 'inchangee').length;
if (unchanged) lines.push(`${unchanged} modification(s) déjà présente(s) dans le code.`, '');
process.stdout.write(`${lines.join('\n')}\n`);
