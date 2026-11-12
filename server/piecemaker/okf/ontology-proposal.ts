import fs from 'node:fs';

import { text } from './bundle.js';
import type { OntologyRelation } from './ontology.js';
import { normalizeOntology, ontologyFile } from './ontology.js';

export type OntologyProposal = { relations: OntologyRelation[]; motif: string; date: string };
export type OntologyLines = { lignes: Record<string, { debut: number; fin: number }>; total: number };

export const proposalFile = (): string => ontologyFile().replace(/\.json$/, '.proposition.json');

export function readProposal(): OntologyProposal | null {
  const filePath = proposalFile();
  if (!fs.existsSync(filePath)) return null;
  try {
    const stored = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { relations: normalizeOntology(stored), motif: text(stored.motif), date: text(stored.date) };
  } catch {
    return null;
  }
}

export function proposeOntology(value: unknown): OntologyProposal {
  const relations = normalizeOntology(value);
  const motif = text((value as { motif?: unknown } | null)?.motif);
  if (motif.length > 1000) throw new TypeError('motif : 1000 caractères au plus.');
  const proposal = { relations, motif, date: new Date().toISOString() };
  const filePath = proposalFile();
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(proposal, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
  return proposal;
}

export function dropProposal(): void {
  fs.rmSync(proposalFile(), { force: true });
}

export function ontologyLines(names: string[]): OntologyLines {
  const filePath = ontologyFile();
  if (!fs.existsSync(filePath)) return { lignes: {}, total: 0 };
  const lines = fs.readFileSync(filePath, 'utf8').replace(/\n$/, '').split('\n');
  const found: OntologyLines['lignes'] = {};
  for (const name of names) {
    const index = lines.findIndex((line) => line.trim().replace(/,$/, '') === `"name": ${JSON.stringify(name)}`);
    if (index < 0) continue;
    let start = index;
    while (start > 0 && lines[start].trim() !== '{') start -= 1;
    const indent = lines[start].indexOf('{');
    let end = index;
    while (end < lines.length - 1 && !(lines[end].indexOf('}') === indent && lines[end].trim().startsWith('}'))) end += 1;
    found[name] = { debut: start + 1, fin: end + 1 };
  }
  return { lignes: found, total: lines.length };
}
