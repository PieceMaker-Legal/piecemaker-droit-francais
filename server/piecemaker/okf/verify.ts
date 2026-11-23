import fs from 'node:fs';
import path from 'node:path';

import type { MarkdownOf } from './build.js';
import type { Concept } from './bundle.js';
import {
  OKF_VERSION,
  UNCLASSIFIED,
  bundleRoot,
  conceptId,
  fold,
  isEntityId,
  isoDateOf,
  isPartyId,
  parseConcept,
  readBundle,
  readTypes,
  relationsOf,
  squash,
  text,
  typeOf,
  typographic,
} from './bundle.js';
import { HAS_DATE_TIME_VALUE, MATERIAL_ENTITY, TEMPORAL_INSTANT, fits, isFunctional, lofId, lofLabel, lofTerm } from './lof.js';
import { readOntology } from './ontology.js';
import { storedOntologyErrors } from './ontology-proposal.js';
import { linkedReviews, reviewPieces } from './premises.js';
import { reviewRowPieces } from './reviews.js';

export type OkfError = { fiche: string; erreur: string };
export type OkfContradiction = { premise: string; titre: string; valeurs: Array<{ piece: string; valeur: string }> };

export function quoted(markdown: string | null, citation: string): boolean {
  const fragments = typographic(citation.replace(/^(?:…|\.\.\.)|(?:…|\.\.\.)$/g, '')).split(/…|\.\.\./).map((fragment) => fragment.trim()).filter(Boolean);
  if (!markdown || !fragments.length) return false;
  const haystack = typographic(markdown);
  let from = 0;
  for (const fragment of fragments) {
    const found = haystack.indexOf(fragment, from);
    if (found < 0) return false;
    from = found + fragment.length;
  }
  return true;
}

function indexErrors(projectPath: string, ids: string[]): OkfError[] {
  const filePath = path.join(bundleRoot(projectPath), 'index.md');
  if (!fs.existsSync(filePath)) return [{ fiche: '/index.md', erreur: 'index.md absent' }];
  const source = fs.readFileSync(filePath, 'utf8');
  const errors: OkfError[] = [];
  try {
    if (String(parseConcept(source).frontmatter.okf_version) !== OKF_VERSION) errors.push({ fiche: '/index.md', erreur: `okf_version doit valoir ${OKF_VERSION}` });
  } catch {
    errors.push({ fiche: '/index.md', erreur: 'okf_version absent' });
  }
  for (const id of ids) {
    if (!source.includes(`](${encodeURI(id)})`)) errors.push({ fiche: '/index.md', erreur: `fiche non listée : ${id}` });
  }
  return errors;
}

const ONTOLOGY_FICHE = '~/.piecemaker/ontologie.json';
const labels = (ids: string[] = []): string => ids.map(lofLabel).join(', ');
export const classOf = (concept: Pick<Concept, 'frontmatter'>): string => lofId(text(concept.frontmatter.lof), ['class']) || '';

export function verifyBundle(input: { projectPath: string; resources: string[]; markdownOf: MarkdownOf }): OkfError[] {
  const { projectPath, markdownOf } = input;
  const types = readTypes(projectPath);
  const ontology = readOntology(projectPath);
  const concepts = readBundle(projectPath);
  const byId = new Map(concepts.filter((concept) => !concept.error).map((concept) => [concept.id, concept]));
  const errors: OkfError[] = [];
  if (ontology.erreur) errors.push({ fiche: ONTOLOGY_FICHE, erreur: ontology.erreur });
  errors.push(...storedOntologyErrors());

  for (const concept of concepts) {
    const report = (erreur: string) => errors.push({ fiche: concept.id, erreur });
    if (concept.error) { report(concept.error); continue; }
    const type = text(concept.frontmatter.type);
    const resource = text(concept.frontmatter.resource);
    const classId = classOf(concept);
    if (text(concept.frontmatter.lof) && !classId) report(`classe hors LOF : ${text(concept.frontmatter.lof)}`);
    if (!type) report('type absent');
    if (isEntityId(concept.id)) {
      if (!text(concept.frontmatter.title)) report('title absent');
      if (!classId) report(`fiche sans classe LOF : la relier de nouveau en donnant sa classe (pm okf link "${text(concept.frontmatter.title)}" … --source_class <classe>)`);
      else if (type !== lofLabel(classId)) report(`type « ${type} » différent de la classe LOF « ${lofLabel(classId)} »`);
      for (const link of linkedReviews(concept)) {
        const { erreur } = reviewRowPieces(projectPath, link.fichier, link.colonne);
        if (erreur) report(`revue liée ${link.fichier} › colonne ${link.colonne} : ${erreur} ; la délier : pm okf revue "${text(concept.frontmatter.title)}" --fichier "${link.fichier}" --colonne ${link.colonne} --retirer`);
      }
    } else if (isPartyId(concept.id)) {
      if (classId !== MATERIAL_ENTITY || type !== lofLabel(MATERIAL_ENTITY)) report(`une partie est une « ${lofLabel(MATERIAL_ENTITY)} »`);
    } else {
      if (type !== UNCLASSIFIED && !types.includes(type)) report(`type « ${type} » hors arborescence (${types.join(', ')})`);
      if (!resource) report('resource absent');
      else {
        if (!fs.existsSync(path.join(projectPath, resource))) report(`document absent : ${resource}`);
        if (conceptId(resource) !== concept.id) report(`la fiche ne correspond pas à son document : ${resource}`);
        if (type && typeOf(resource, types, projectPath) !== type) report(`type « ${type} » différent du dossier du document`);
      }
    }
    for (const [name, entries] of Object.entries(relationsOf(concept.frontmatter))) {
      const property = lofId(name, ['objprop', 'dataprop']);
      const live = entries.filter((entry) => !entry.dismissed);
      if (!property) {
        if (live.length) report(`relation hors LOF : ${name}`);
        continue;
      }
      const term = lofTerm(property)!;
      if (term.kind === 'objprop' && isFunctional(property) && new Set(live.map((entry) => entry.target)).size > 1) report(`« ${name} » est fonctionnelle : une seule cible admise`);
      if (live.length && classId && !fits(classId, term.domain)) report(`${name} : « ${lofLabel(classId)} » hors du domaine (${labels(term.domain)})`);
      for (const entry of live) {
        const link = `${name} → ${entry.target || '?'}`;
        const target = byId.get(entry.target);
        if (!target) report(`${link} : cible absente du dossier`);
        else if (term.kind === 'objprop' && classOf(target) && !fits(classOf(target), term.range)) report(`${link} : « ${lofLabel(classOf(target))} » hors du codomaine (${labels(term.range)})`);
        if (term.kind === 'objprop' && entry.target === concept.id) report(`${link} : lien vers soi-même`);
        if (property === HAS_DATE_TIME_VALUE && !isoDateOf(entry.value || '')) report(`${link} : date absente`);
        const piece = byId.get(entry.piece || '') || (!isEntityId(concept.id) && !isPartyId(concept.id) ? concept : undefined);
        if (!piece) {
          report(`${link} : pièce absente`);
          continue;
        }
        if (!entry.citation) report(`${link} : citation absente`);
        else if (!quoted(markdownOf(text(piece.frontmatter.resource)), entry.citation)) report(`${link} : citation introuvable dans ${piece.id}`);
      }
    }
  }

  for (const resource of input.resources) {
    if (!concepts.some((concept) => concept.id === conceptId(resource))) errors.push({ fiche: conceptId(resource), erreur: 'document sans fiche : lancer pm dossier conversion, qui convertit puis analyse le dossier et écrit les fiches' });
  }
  return [...errors, ...indexErrors(projectPath, concepts.map((concept) => concept.id))];
}

export function contradictions(projectPath: string): OkfContradiction[] {
  const concepts = readBundle(projectPath).filter((concept) => !concept.error);
  const label = lofLabel(HAS_DATE_TIME_VALUE);
  return concepts.filter((concept) => isEntityId(concept.id) && fits(classOf(concept), [TEMPORAL_INSTANT])).flatMap((entity) => {
    const valeurs = (relationsOf(entity.frontmatter)[label] || []).filter((entry) => !entry.dismissed && entry.value)
      .map((entry) => ({ piece: entry.piece || entry.target, valeur: entry.value as string }))
      .concat(reviewPieces(projectPath, entity, concepts).filter((piece) => piece.value).map((piece) => ({ piece: conceptId(piece.resource), valeur: piece.value })));
    return new Set(valeurs.map((entry) => isoDateOf(entry.valeur) ?? fold(squash(entry.valeur)))).size > 1 ? [{ premise: entity.id, titre: text(entity.frontmatter.title), valeurs }] : [];
  });
}
