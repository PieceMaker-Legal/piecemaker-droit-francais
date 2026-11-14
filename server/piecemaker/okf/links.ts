import fs from 'node:fs';

import type { MarkdownOf } from './build.js';
import {
  AGENT_ACTOR,
  DERIVED_ACTORS,
  PREMISE_TYPE,
  INVOLVES,
  MENTIONS,
  PARTY_TYPE,
  STATES,
  conceptFile,
  conceptId,
  premiseId,
  isPremiseId,
  isPartyId,
  parseConcept,
  partyId,
  relationsOf,
  serializeConcept,
  squash,
  text,
  writeIfChanged,
} from './bundle.js';
import type { Ontology } from './ontology.js';
import { readOntology, relationNames, ruleOf } from './ontology.js';
import { quoted } from './verify.js';

export type LinkInput = { source?: unknown; relation?: unknown; target?: unknown; citation?: unknown; value?: unknown; single?: unknown };
export type Link = { source: string; relation: string; target: string };

function load(projectPath: string, id: string, role: string) {
  const filePath = conceptFile(projectPath, id);
  if (!fs.existsSync(filePath)) throw new TypeError(`${role} : aucune fiche ${id}.`);
  return { id, filePath, ...parseConcept(fs.readFileSync(filePath, 'utf8')) };
}

function documentId(resource: unknown, role: string): string {
  const name = text(resource).replace(/^\/+/, '');
  if (!name) throw new TypeError(`${role} : donner le chemin du document depuis la racine du dossier.`);
  return conceptId(name);
}

function loadDocument(projectPath: string, id: string, role: string) {
  const concept = load(projectPath, id, role);
  if ([PREMISE_TYPE, PARTY_TYPE].includes(text(concept.frontmatter.type))) throw new TypeError(`${role} : ${concept.id} n'est pas un document.`);
  return concept;
}

function relationName(value: unknown, ontology: Ontology | null): string {
  const name = text(value);
  if (name === MENTIONS) throw new TypeError(`${MENTIONS} est posé par l'analyse du dossier : qualifier la personne de partie dans l'index.`);
  if (!name) throw new TypeError('relation absente.');
  const writable = ontology ? [...relationNames(ontology), STATES, INVOLVES] : null;
  if (writable && !writable.includes(name)) throw new TypeError(`relation hors ontologie : « ${name} ». Relations admises : ${writable.join(', ')}. Seul l'avocat modifie l'ontologie (onglet Index › Ontologie).`);
  return name;
}

function endpoints(name: string, input: LinkInput): { source: string; target: string } {
  if (name === INVOLVES) return { source: premiseId(text(input.source)), target: partyId(text(input.target)) };
  return { source: documentId(input.source, 'source'), target: name === STATES ? premiseId(text(input.target)) : documentId(input.target, 'cible') };
}

function save(concept: { filePath: string; frontmatter: Record<string, unknown>; body: string }, relations: ReturnType<typeof relationsOf>): void {
  const frontmatter = { ...concept.frontmatter, relations };
  for (const name of Object.keys(relations)) if (!relations[name].length) delete relations[name];
  if (!Object.keys(relations).length) delete (frontmatter as Record<string, unknown>).relations;
  fs.writeFileSync(concept.filePath, serializeConcept(frontmatter, concept.body));
}

export function addLink(projectPath: string, input: LinkInput, markdownOf: MarkdownOf, origin = AGENT_ACTOR, now = new Date().toISOString()): Link {
  const ontology = readOntology(projectPath);
  const name = relationName(input.relation, ontology);
  const ids = endpoints(name, input);
  const source = name === INVOLVES ? load(projectPath, ids.source, 'source') : loadDocument(projectPath, ids.source, 'source');
  const citation = squash(text(input.citation));
  const value = squash(text(input.value));
  if (source.id === ids.target) throw new TypeError('un document ne peut pas être lié à lui-même.');

  if (name === INVOLVES) {
    if (!isPartyId(ids.target) || !fs.existsSync(conceptFile(projectPath, ids.target))) throw new TypeError(`cible : ${ids.target} n'est pas une partie du dossier.`);
  } else if (!quoted(markdownOf(text(source.frontmatter.resource)), citation)) {
    throw new TypeError('citation introuvable mot pour mot dans le document source.');
  }
  const rule = ruleOf(ontology, name);
  if (rule) {
    const target = loadDocument(projectPath, ids.target, 'cible');
    for (const [concept, allowed, role] of [[source, rule.source, 'source'], [target, rule.target, 'cible']] as const) {
      const type = text(concept.frontmatter.type);
      if (!allowed.includes(type)) throw new TypeError(`${role} : ${concept.id} est de type « ${type} ». L'ontologie admet ${name} ${role === 'source' ? 'depuis' : 'vers'} : ${allowed.join(', ')}.`);
    }
  }
  if (name === STATES) {
    const premiseFile = conceptFile(projectPath, ids.target);
    const title = text(input.target);
    if (!fs.existsSync(premiseFile)) {
      if (isPremiseId(title)) throw new TypeError(`cible : aucune fiche ${title}. Donner le titre de la prémisse pour la créer.`);
      writeIfChanged(premiseFile, serializeConcept({ type: PREMISE_TYPE, title, description: title, ...(input.single === true ? { single_value: true } : {}), generated: { by: origin, at: now } }, ''));
    } else if (input.single === true) {
      const premise = load(projectPath, ids.target, 'cible');
      fs.writeFileSync(premiseFile, serializeConcept({ ...premise.frontmatter, single_value: true }, premise.body));
    }
  }

  const relations = relationsOf(source.frontmatter);
  relations[name] = [...(relations[name] || []).filter((entry) => entry.target !== ids.target), { target: ids.target, citation, origin, at: now, ...(value ? { value } : {}) }]
    .sort((left, right) => left.target.localeCompare(right.target));
  save(source, relations);
  return { source: source.id, relation: name, target: ids.target };
}

export function removeLink(projectPath: string, input: LinkInput): Link {
  const name = relationName(input.relation, null);
  const ids = endpoints(name, input);
  const source = name === INVOLVES ? load(projectPath, ids.source, 'source') : loadDocument(projectPath, ids.source, 'source');
  const relations = relationsOf(source.frontmatter);
  const entry = (relations[name] || []).find((candidate) => candidate.target === ids.target && !candidate.dismissed);
  if (!entry) throw new TypeError(`aucun lien ${name} vers ${ids.target}.`);
  if (DERIVED_ACTORS.includes(entry.origin)) entry.dismissed = true;
  else relations[name] = relations[name].filter((candidate) => candidate !== entry);
  save(source, relations);
  return { source: source.id, relation: name, target: ids.target };
}
