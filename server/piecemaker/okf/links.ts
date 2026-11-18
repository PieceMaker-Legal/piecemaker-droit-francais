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
  squash,
  text,
} from './bundle.js';
import type { Ontology } from './ontology.js';
import { readOntology, relationNames, ruleOf } from './ontology.js';
import { EXAMINED, fingerprintOf } from './premises.js';
import type { OkfStore } from './store.js';
import { quoted } from './verify.js';

// Links, premises and examinations are written to SQLite only. The fiches read here are the views
// generated from it just before (createOkfBackend rebuilds them before and after each write).
export type OkfTarget = { projectPath: string; projectId: string; store: OkfStore };

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

export function addLink(target: OkfTarget, input: LinkInput, markdownOf: MarkdownOf, origin = AGENT_ACTOR, now = new Date().toISOString()): Link {
  const { projectPath, projectId, store } = target;
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
      throw new TypeError(`cible : ${ids.target} n'est pas une partie du dossier. Parties : ${codes.join(', ') || 'aucune'}. Cible admise : le code d'une partie (ex. PERSONNE_PHYSIQUE_01). La qualification d'une partie attend l'avocat : il désigne une partie cliente ou adverse dans l'onglet Dossier, vue générale (colonnes Parties clientes et Parties adverses, ou champ Rôle de la fiche) ; ne la qualifie pas toi-même.`);
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
  store.transaction(() => {
    if (name === STATES) {
      const title = text(input.target);
      if (!fs.existsSync(conceptFile(projectPath, ids.target)) && isPremiseId(title)) throw new TypeError(`cible : aucune fiche ${title}. Donner le titre de la prémisse pour la créer.`);
      store.upsertPremise(projectId, { id: ids.target, title, description: title, single: input.single === true, by: origin, at: now });
    }
    store.upsertRelation(projectId, { source: source.id, relation: name, target: ids.target, citation, value, origin, at: now, dismissed: false });
  });
  return { source: source.id, relation: name, target: ids.target };
}

export function removeLink(target: OkfTarget, input: LinkInput, now = new Date().toISOString()): Link {
  const { projectPath, projectId, store } = target;
  const name = relationName(input.relation, null);
  const ids = endpoints(projectPath, name, input);
  const source = name === INVOLVES ? load(projectPath, ids.source, 'source') : loadDocument(projectPath, ids.source, 'source');
  const entry = (relationsOf(source.frontmatter)[name] || []).find((candidate) => candidate.target === ids.target && !candidate.dismissed);
  if (!entry) throw new TypeError(`aucun lien ${name} vers ${ids.target}.`);
  if (DERIVED_ACTORS.includes(entry.origin)) store.upsertRelation(projectId, { source: source.id, relation: name, target: ids.target, citation: entry.citation, value: entry.value || '', origin: entry.origin, at: now, dismissed: true });
  else store.deleteRelation(projectId, source.id, name, ids.target);
  if (name === STATES) store.dropUnstatedPremise(projectId, ids.target);
  return { source: source.id, relation: name, target: ids.target };
}

export function markExamined(target: OkfTarget, input: ExamInput, origin = AGENT_ACTOR, now = new Date().toISOString()): { source: string; motif: string } {
  const { projectPath, projectId, store } = target;
  const concept = loadDocument(projectPath, documentId(projectPath, input.source, 'source'), 'source');
  const motif = squash(text(input.motif));
  if (!motif) throw new TypeError('motif absent : dire en une phrase pourquoi aucun passage du document ne justifie un lien ni une prémisse.');
  store.setExam(projectId, { source: concept.id, motif, by: origin, at: now, empreinte: fingerprintOf(projectPath, text(concept.frontmatter.resource)) });
  return { source: concept.id, motif };
}

export function unmarkExamined(target: OkfTarget, input: ExamInput): { source: string } {
  const { projectPath, projectId, store } = target;
  const concept = loadDocument(projectPath, documentId(projectPath, input.source, 'source'), 'source');
  if (!concept.frontmatter[EXAMINED]) throw new TypeError(`${concept.id} n'est pas marquée examinée sans lien.`);
  store.clearExam(projectId, concept.id);
  return { source: concept.id };
}
