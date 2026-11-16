import fs from 'node:fs';
import path from 'node:path';

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
import { EXAMINED, fingerprintOf } from './premises.js';
import { quoted } from './verify.js';

export type LinkInput = { source?: unknown; relation?: unknown; target?: unknown; citation?: unknown; value?: unknown; single?: unknown };
export type Link = { source: string; relation: string; target: string };
export type ExamInput = { source?: unknown; motif?: unknown };

function load(projectPath: string, id: string, role: string) {
  const filePath = conceptFile(projectPath, id);
  if (!fs.existsSync(filePath)) throw new TypeError(`${role} : aucune fiche ${id}. Vérifier le chemin : les fiches sont listées dans .piecemaker/okf/index.md.`);
  return { id, filePath, ...parseConcept(fs.readFileSync(filePath, 'utf8')) };
}

function documentId(projectPath: string, resource: unknown, role: string): string {
  const given = text(resource).replace(/^\/+/, '');
  if (!given) throw new TypeError(`${role} : donner le chemin du document depuis la racine du dossier.`);
  for (let name = given; ; name = name.slice(0, -3)) {
    if (fs.existsSync(conceptFile(projectPath, conceptId(name)))) return conceptId(name);
    if (!name.endsWith('.md')) return conceptId(given);
  }
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

function endpoints(projectPath: string, name: string, input: LinkInput): { source: string; target: string } {
  if (name === INVOLVES) return { source: premiseId(text(input.source)), target: partyId(text(input.target)) };
  return { source: documentId(projectPath, input.source, 'source'), target: name === STATES ? premiseId(text(input.target)) : documentId(projectPath, input.target, 'cible') };
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
  const ids = endpoints(projectPath, name, input);
  const source = name === INVOLVES ? load(projectPath, ids.source, 'source') : loadDocument(projectPath, ids.source, 'source');
  const citation = squash(text(input.citation));
  const value = squash(text(input.value));
  if (source.id === ids.target) throw new TypeError('un document ne peut pas être lié à lui-même.');

  if (name === INVOLVES) {
    if (!isPartyId(ids.target) || !fs.existsSync(conceptFile(projectPath, ids.target))) {
      const folder = path.dirname(conceptFile(projectPath, partyId('_')));
      const codes = fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3)) : [];
      throw new TypeError(`cible : ${ids.target} n'est pas une partie du dossier. Parties : ${codes.join(', ') || 'aucune'}. Cible admise : le code d'une partie (ex. PERSONNE_PHYSIQUE_01). Pour qualifier une personne de partie : pm dossier sql "UPDATE piecemaker_nodes SET data_json=json_set(data_json,'$.partySide','client') WHERE project_id=dossier() AND id='entity:<CODE>'" ('adversaire' pour la partie adverse), puis relancer pm okf link.`);
    }
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
  const ids = endpoints(projectPath, name, input);
  const source = name === INVOLVES ? load(projectPath, ids.source, 'source') : loadDocument(projectPath, ids.source, 'source');
  const relations = relationsOf(source.frontmatter);
  const entry = (relations[name] || []).find((candidate) => candidate.target === ids.target && !candidate.dismissed);
  if (!entry) throw new TypeError(`aucun lien ${name} vers ${ids.target}.`);
  if (DERIVED_ACTORS.includes(entry.origin)) entry.dismissed = true;
  else relations[name] = relations[name].filter((candidate) => candidate !== entry);
  save(source, relations);
  return { source: source.id, relation: name, target: ids.target };
}

export function markExamined(projectPath: string, input: ExamInput, origin = AGENT_ACTOR, now = new Date().toISOString()): { source: string; motif: string } {
  const concept = loadDocument(projectPath, documentId(projectPath, input.source, 'source'), 'source');
  const motif = squash(text(input.motif));
  if (!motif) throw new TypeError('motif absent : dire en une phrase pourquoi aucun passage du document ne justifie un lien ni une prémisse.');
  const resource = text(concept.frontmatter.resource);
  fs.writeFileSync(concept.filePath, serializeConcept({ ...concept.frontmatter, [EXAMINED]: { motif, by: origin, at: now, empreinte: fingerprintOf(projectPath, resource) } }, concept.body));
  return { source: concept.id, motif };
}

export function unmarkExamined(projectPath: string, input: ExamInput): { source: string } {
  const concept = loadDocument(projectPath, documentId(projectPath, input.source, 'source'), 'source');
  if (!concept.frontmatter[EXAMINED]) throw new TypeError(`${concept.id} n'est pas marquée examinée sans lien.`);
  const frontmatter = { ...concept.frontmatter };
  delete frontmatter[EXAMINED];
  fs.writeFileSync(concept.filePath, serializeConcept(frontmatter, concept.body));
  return { source: concept.id };
}
