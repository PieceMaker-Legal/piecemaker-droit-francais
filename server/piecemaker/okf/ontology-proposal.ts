import fs from 'node:fs';

import type { ClassificationFolder } from '../../../plugins/piecemaker-tabular-review/src/shared.js';

import { text } from './bundle.js';
import { normalizeArborescence, ontologyErrors, ontologyFile } from './ontology.js';
import { readArborescence } from './sealed.js';

export type OntologyProposal = { arborescence?: ClassificationFolder[]; motif: string; date: string };
export type ProposalPart = 'arborescence';

export const proposalFile = (): string => ontologyFile().replace(/\.json$/, '.proposition.json');

function readJson(filePath: string): unknown {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '')) : undefined;
}

function writeProposal(value: object): void {
  const filePath = proposalFile();
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, filePath);
}

export function readProposal(): OntologyProposal | null {
  try {
    const stored = readJson(proposalFile()) as Record<string, unknown> | undefined;
    if (!stored || stored.arborescence === undefined) return null;
    return { arborescence: normalizeArborescence(stored.arborescence), motif: text(stored.motif), date: text(stored.date) };
  } catch {
    return null;
  }
}

export function proposeOntology(_projectPath: string, value: unknown): OntologyProposal {
  const errors = ontologyErrors(value);
  if (errors.length) throw new TypeError(errors.join('\n'));
  const supplied = value as { arborescence: unknown; motif?: unknown };
  const pending = readProposal();
  const arborescence = normalizeArborescence(supplied.arborescence);
  const proposal: OntologyProposal = {
    ...(JSON.stringify(arborescence) !== JSON.stringify(readArborescence()) ? { arborescence } : {}),
    motif: text(supplied.motif) || pending?.motif || '',
    date: new Date().toISOString(),
  };
  if (proposal.arborescence) writeProposal(proposal);
  else dropProposal();
  return proposal;
}

export function dropProposal(_part?: ProposalPart): void {
  fs.rmSync(proposalFile(), { force: true });
}

export function storedOntologyErrors(): Array<{ fiche: string; erreur: string }> {
  return [ontologyFile(), proposalFile()].flatMap((filePath) => {
    const fiche = `~/.piecemaker/${filePath.split(/[\\/]/).pop()}`;
    try {
      const stored = readJson(filePath);
      return stored === undefined ? [] : ontologyErrors(stored, true).map((erreur) => ({ fiche, erreur }));
    } catch (error) {
      return [{ fiche, erreur: `JSON illisible : ${error instanceof Error ? error.message : String(error)}` }];
    }
  });
}
