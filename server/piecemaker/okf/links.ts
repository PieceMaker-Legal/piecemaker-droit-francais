import fs from 'node:fs';
import path from 'node:path';

import type { MarkdownOf } from './build.js';
import {
  AGENT_ACTOR,
  conceptFile,
  conceptId,
  entityId,
  isEntityId,
  isoDateOf,
  isPartyId,
  parseConcept,
  partyId,
  relationsOf,
  squash,
  text,
} from './bundle.js';
import { HAS_DATE_TIME_VALUE, LEGAL_DOCUMENT, MATERIAL_ENTITY, fits, isFunctional, lofId, lofLabel, lofTerm } from './lof.js';
import { EXAMINED, fingerprintOf } from './premises.js';
import { reviewColumn, reviewFileName } from './reviews.js';
import type { OkfStore } from './store.js';
import { quoted } from './verify.js';

export type OkfTarget = { projectPath: string; projectId: string; store: OkfStore };

export type LinkInput = { source?: unknown; source_class?: unknown; relation?: unknown; target?: unknown; target_class?: unknown; piece?: unknown; citation?: unknown; value?: unknown };
export type Link = { source: string; relation: string; target: string };
export type ExamInput = { source?: unknown; motif?: unknown };
export type ReviewLinkInput = { premise?: unknown; classe?: unknown; fichier?: unknown; colonne?: unknown };
export type ReviewLink = { premise: string; fichier: string; colonne: number };

type Endpoint = { id: string; classId: string; title: string; create: boolean };

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
  if (isEntityId(id) || isPartyId(id)) throw new TypeError(`${role} : ${concept.id} n'est pas un document.`);
  return concept;
}

function classOf(value: unknown, role: string): string {
  const given = squash(text(value));
  if (!given) return '';
  const id = lofId(given, ['class']);
  if (!id) throw new TypeError(`${role} : classe hors LOF « ${given} ». Donner le libellé exact d'une classe de la Legal Ontologies Foundry (pm okf ontologie).`);
  return id;
}

function partyCodes(projectPath: string): string[] {
  const folder = path.dirname(conceptFile(projectPath, partyId('_')));
  return fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => name.endsWith('.md')).map((name) => name.slice(0, -3)) : [];
}

function endpoint(projectPath: string, value: unknown, classValue: unknown, role: string): Endpoint {
  const given = squash(text(value));
  if (!given) throw new TypeError(`${role} : donner un code de partie, un chemin de document ou le titre d'une fiche LOF.`);
  const wanted = classOf(classValue, role);
  const party = partyId(given);
  if (isPartyId(given) || partyCodes(projectPath).includes(given)) {
    if (!fs.existsSync(conceptFile(projectPath, party))) throw new TypeError(`${role} : ${party} n'est pas une partie du dossier. Parties : ${partyCodes(projectPath).join(', ') || 'aucune'}.`);
    if (wanted && wanted !== MATERIAL_ENTITY) throw new TypeError(`${role} : une partie est une « ${lofLabel(MATERIAL_ENTITY)} ».`);
    return { id: party, classId: MATERIAL_ENTITY, title: given, create: false };
  }
  const document = documentId(projectPath, given, role);
  if (!isEntityId(given) && fs.existsSync(conceptFile(projectPath, document))) {
    const concept = loadDocument(projectPath, document, role);
    const classId = lofId(text(concept.frontmatter.nature), ['class']) || LEGAL_DOCUMENT;
    if (wanted && wanted !== classId) throw new TypeError(`${role} : ${document} est un « ${lofLabel(classId)} ».`);
    return { id: document, classId, title: text(concept.frontmatter.title), create: false };
  }
  const id = entityId(given);
  if (!fs.existsSync(conceptFile(projectPath, id))) {
    if (isEntityId(given)) throw new TypeError(`${role} : aucune fiche ${given}. Donner son titre et sa classe LOF pour la créer.`);
    if (!wanted) throw new TypeError(`${role} : nouvelle fiche « ${given} » sans classe. Donner sa classe LOF (${role}_class).`);
    return { id, classId: wanted, title: given, create: true };
  }
  const stored = lofId(text(load(projectPath, id, role).frontmatter.lof), ['class']) || '';
  if (wanted && stored && wanted !== stored) throw new TypeError(`${role} : ${id} est déjà de classe « ${lofLabel(stored)} ».`);
  if (!wanted && !stored) throw new TypeError(`${role} : ${id} n'a pas de classe LOF. Donner sa classe (${role}_class).`);
  return { id, classId: stored || wanted, title: given, create: !stored };
}

function propertyOf(value: unknown): string {
  const given = squash(text(value));
  if (!given) throw new TypeError('relation absente.');
  const id = lofId(given, ['objprop', 'dataprop']);
  if (!id) throw new TypeError(`propriété hors LOF : « ${given} ». Donner le libellé exact d'une propriété de la Legal Ontologies Foundry (pm okf ontologie).`);
  return id;
}

const labels = (ids: string[] = []): string => ids.map(lofLabel).join(', ');

export function addLink(target: OkfTarget, input: LinkInput, markdownOf: MarkdownOf, origin = AGENT_ACTOR, now = new Date().toISOString()): Link {
  const { projectPath, projectId, store } = target;
  const property = propertyOf(input.relation);
  const term = lofTerm(property)!;
  const source = endpoint(projectPath, input.source, input.source_class, 'source');
  const piece = loadDocument(projectPath, documentId(projectPath, input.piece, 'pièce'), 'pièce');
  const citation = squash(text(input.citation));
  if (!quoted(markdownOf(text(piece.frontmatter.resource)), citation)) throw new TypeError('citation introuvable mot pour mot dans la pièce.');
  if (!fits(source.classId, term.domain)) throw new TypeError(`source : « ${lofLabel(source.classId)} » hors du domaine de « ${term.label} » (${labels(term.domain)}).`);
  let targetId: string;
  let value = '';
  let targetEndpoint: Endpoint | null = null;
  if (term.kind === 'dataprop') {
    if (property !== HAS_DATE_TIME_VALUE) throw new TypeError(`« ${term.label} » : seule « ${lofLabel(HAS_DATE_TIME_VALUE)} » porte une valeur dans l'index.`);
    value = isoDateOf(squash(text(input.value))) || '';
    if (!value) throw new TypeError('valeur : donner la date au format AAAA-MM-JJ.');
    targetId = piece.id;
  } else {
    targetEndpoint = endpoint(projectPath, input.target, input.target_class, 'cible');
    if (!fits(targetEndpoint.classId, term.range)) throw new TypeError(`cible : « ${lofLabel(targetEndpoint.classId)} » hors du codomaine de « ${term.label} » (${labels(term.range)}).`);
    if (targetEndpoint.id === source.id) throw new TypeError('une fiche ne peut pas être liée à elle-même.');
    targetId = targetEndpoint.id;
    if (isFunctional(property)) {
      const other = (relationsOf(fs.existsSync(conceptFile(projectPath, source.id)) ? load(projectPath, source.id, 'source').frontmatter : {})[term.label] || []).find((entry) => !entry.dismissed && entry.target !== targetId);
      if (other) throw new TypeError(`« ${term.label} » est fonctionnelle : ${source.id} la porte déjà vers ${other.target}. Retirer ce lien d'abord.`);
    }
  }
  store.transaction(() => {
    for (const entry of [source, targetEndpoint]) if (entry?.create) store.upsertPremise(projectId, { id: entry.id, title: entry.title, description: entry.title, single: false, by: origin, at: now, lofClass: entry.classId });
    store.upsertRelation(projectId, { source: source.id, relation: property, target: targetId, citation, value, origin, at: now, dismissed: false, piece: piece.id });
  });
  return { source: source.id, relation: term.label, target: targetId };
}

export function removeLink(target: OkfTarget, input: LinkInput): Link {
  const { projectPath, projectId, store } = target;
  const property = propertyOf(input.relation);
  const term = lofTerm(property)!;
  const given = squash(text(input.source));
  const source = isPartyId(given) || partyCodes(projectPath).includes(given) ? partyId(given) : isEntityId(given) || !fs.existsSync(conceptFile(projectPath, documentId(projectPath, given, 'source'))) ? entityId(given) : documentId(projectPath, given, 'source');
  const targetGiven = squash(text(term.kind === 'dataprop' ? input.piece : input.target));
  const entries = relationsOf(load(projectPath, source, 'source').frontmatter)[term.label] || [];
  const entry = entries.find((candidate) => !candidate.dismissed && [candidate.target, candidate.piece].some((value) => value && [targetGiven, partyId(targetGiven), entityId(targetGiven), conceptId(targetGiven.replace(/^\/+|\.md$/g, ''))].includes(value)));
  if (!entry) throw new TypeError(`aucun lien « ${term.label} » depuis ${source} vers ${targetGiven}.`);
  store.deleteRelation(projectId, source, property, entry.target);
  store.dropUnstatedPremise(projectId, source);
  store.dropUnstatedPremise(projectId, entry.target);
  return { source, relation: term.label, target: entry.target };
}

export function markExamined(target: OkfTarget, input: ExamInput, origin = AGENT_ACTOR, now = new Date().toISOString()): { source: string; motif: string } {
  const { projectPath, projectId, store } = target;
  const concept = loadDocument(projectPath, documentId(projectPath, input.source, 'source'), 'source');
  const motif = squash(text(input.motif));
  if (!motif) throw new TypeError('motif absent : dire en une phrase pourquoi aucun passage du document ne justifie un lien.');
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

export function linkReview(target: OkfTarget, input: ReviewLinkInput, origin = AGENT_ACTOR, now = new Date().toISOString()): ReviewLink {
  const { projectPath, projectId, store } = target;
  const entity = endpoint(projectPath, input.premise, input.classe, 'fiche');
  if (!isEntityId(entity.id)) throw new TypeError('fiche : une revue se lie à une fiche LOF, pas à une partie ni à un document.');
  const file = reviewFileName(input.fichier);
  const { index } = reviewColumn(projectPath, file, input.colonne);
  store.transaction(() => {
    if (entity.create) store.upsertPremise(projectId, { id: entity.id, title: entity.title, description: entity.title, single: false, by: origin, at: now, lofClass: entity.classId });
    store.upsertReviewLink(projectId, { premise: entity.id, file, column: index, by: origin, at: now });
  });
  return { premise: entity.id, fichier: file, colonne: index };
}

export function unlinkReview(target: OkfTarget, input: ReviewLinkInput): ReviewLink {
  const { projectPath, projectId, store } = target;
  const id = entityId(squash(text(input.premise)));
  const file = reviewFileName(input.fichier);
  const given = Number(text(String(input.colonne ?? '')));
  const column = Number.isInteger(given) && text(String(input.colonne ?? '')) !== '' ? given : reviewColumn(projectPath, file, input.colonne).index;
  if (!store.deleteReviewLink(projectId, id, file, column)) throw new TypeError(`aucune revue ${file} › colonne ${column} liée à ${id}.`);
  store.dropUnstatedPremise(projectId, id);
  return { premise: id, fichier: file, colonne: column };
}
