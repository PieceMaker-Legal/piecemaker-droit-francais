import fs from 'node:fs';

import type { MarkdownOf } from './build.js';
import {
  AGENT_ACTOR,
  RELATIONS,
  SCAN_ACTOR,
  conceptFile,
  conceptId,
  parseConcept,
  readGraphTypes,
  relationsOf,
  serializeConcept,
  squash,
  text,
} from './bundle.js';
import { quoted } from './verify.js';

export type LinkInput = { source?: unknown; relation?: unknown; target?: unknown; citation?: unknown };

function load(projectPath: string, resource: unknown, role: string) {
  const id = conceptId(text(resource).replace(/^\/+/, ''));
  const filePath = conceptFile(projectPath, id);
  if (!text(resource) || !fs.existsSync(filePath)) throw new TypeError(`${role} : aucune fiche pour « ${text(resource)} ». Donner le chemin du document depuis la racine du dossier.`);
  return { id, filePath, ...parseConcept(fs.readFileSync(filePath, 'utf8')) };
}

function relationName(value: unknown): string {
  const name = text(value);
  if (!RELATIONS.includes(name)) throw new TypeError(`relation inconnue : « ${name} ». Relations admises : ${RELATIONS.join(', ')}.`);
  return name;
}

export function addLink(projectPath: string, input: LinkInput, markdownOf: MarkdownOf): { source: string; relation: string; target: string } {
  const name = relationName(input.relation);
  const source = load(projectPath, input.source, 'source');
  const target = load(projectPath, input.target, 'cible');
  const graphTypes = readGraphTypes(projectPath);
  const citation = squash(text(input.citation));
  if (source.id === target.id) throw new TypeError('un document ne peut pas être lié à lui-même.');
  for (const concept of [source, target]) {
    if (!graphTypes.includes(text(concept.frontmatter.type))) throw new TypeError(`${concept.id} est de type « ${text(concept.frontmatter.type)} » : seuls les types ${graphTypes.join(', ')} entrent dans le graphe.`);
  }
  if (!quoted(markdownOf(text(source.frontmatter.resource)), citation)) throw new TypeError('citation introuvable mot pour mot dans le document source.');
  const relations = relationsOf(source.frontmatter);
  relations[name] = [...(relations[name] || []).filter((entry) => entry.target !== target.id), { target: target.id, citation, origin: AGENT_ACTOR }]
    .sort((left, right) => left.target.localeCompare(right.target));
  fs.writeFileSync(source.filePath, serializeConcept({ ...source.frontmatter, relations }, source.body));
  return { source: source.id, relation: name, target: target.id };
}

export function removeLink(projectPath: string, input: LinkInput): { source: string; relation: string; target: string } {
  const name = relationName(input.relation);
  const source = load(projectPath, input.source, 'source');
  const target = conceptId(text(input.target).replace(/^\/+/, ''));
  const relations = relationsOf(source.frontmatter);
  const entry = (relations[name] || []).find((candidate) => candidate.target === target && !candidate.dismissed);
  if (!entry) throw new TypeError(`aucun lien ${name} vers ${target}.`);
  if (entry.origin === SCAN_ACTOR) entry.dismissed = true;
  else relations[name] = relations[name].filter((candidate) => candidate !== entry);
  if (!relations[name].length) delete relations[name];
  const frontmatter = { ...source.frontmatter, relations };
  if (!Object.keys(relations).length) delete (frontmatter as Record<string, unknown>).relations;
  fs.writeFileSync(source.filePath, serializeConcept(frontmatter, source.body));
  return { source: source.id, relation: name, target };
}
