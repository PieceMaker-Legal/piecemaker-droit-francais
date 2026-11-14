import fs from 'node:fs';

import { DEFAULT_DOCUMENT_TYPES } from '../../../plugins/piecemaker-dossier/src/document-types.js';
import type { DocumentType } from '../../../plugins/piecemaker-dossier/src/document-types.js';

import { text } from './bundle.js';
import type { OntologyRelation } from './ontology.js';
import { normalizeDocumentTypes, normalizeOntology, ontologyErrors, ontologyFile, readOntology } from './ontology.js';

export type OntologyProposal = { relations?: OntologyRelation[]; documentTypes?: DocumentType[]; motif: string; date: string };
export type ProposalPart = 'relations' | 'documentTypes';
export type OntologyLines = { lignes: Record<string, { debut: number; fin: number }>; total: number };

export const proposalFile = (): string => ontologyFile().replace(/\.json$/, '.proposition.json');

function readJson(filePath: string): unknown {
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) : undefined;
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
    if (!stored) return null;
    return {
      ...(stored.relations === undefined ? {} : { relations: normalizeOntology(stored) }),
      ...(stored.documentTypes === undefined ? {} : { documentTypes: normalizeDocumentTypes(stored.documentTypes) }),
      motif: text(stored.motif),
      date: text(stored.date),
    };
  } catch {
    return null;
  }
}

const differs = (next: unknown, current: unknown): boolean => next !== undefined && JSON.stringify(next) !== JSON.stringify(current);

export function proposeOntology(projectPath: string, value: unknown): OntologyProposal {
  const errors = ontologyErrors(value);
  if (errors.length) throw new TypeError(errors.join('\n'));
  const supplied = value as { relations?: unknown; documentTypes?: unknown; motif?: unknown };
  const current = readOntology(projectPath);
  const pending = readProposal();
  const relations = supplied.relations === undefined ? pending?.relations : normalizeOntology(supplied);
  const documentTypes = supplied.documentTypes === undefined ? pending?.documentTypes : normalizeDocumentTypes(supplied.documentTypes);
  const proposal: OntologyProposal = {
    ...(differs(relations, current.relations) ? { relations } : {}),
    ...(differs(documentTypes, current.documentTypes || DEFAULT_DOCUMENT_TYPES) ? { documentTypes } : {}),
    motif: text(supplied.motif) || pending?.motif || '',
    date: new Date().toISOString(),
  };
  if (proposal.relations || proposal.documentTypes) writeProposal(proposal);
  else dropProposal();
  return proposal;
}

export function dropProposal(part?: ProposalPart): void {
  const pending = part && readProposal();
  if (pending) delete pending[part];
  if (pending && (pending.relations || pending.documentTypes)) writeProposal(pending);
  else fs.rmSync(proposalFile(), { force: true });
}

export function storedOntologyErrors(): Array<{ fiche: string; erreur: string }> {
  return [ontologyFile(), proposalFile()].flatMap((filePath) => {
    const fiche = `~/.piecemaker/${filePath.split(/[\\/]/).pop()}`;
    try {
      const stored = readJson(filePath);
      return stored === undefined ? [] : ontologyErrors(stored).map((erreur) => ({ fiche, erreur }));
    } catch (error) {
      return [{ fiche, erreur: `JSON illisible : ${error instanceof Error ? error.message : String(error)}` }];
    }
  });
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
