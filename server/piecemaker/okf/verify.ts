import fs from 'node:fs';
import path from 'node:path';

import type { MarkdownOf } from './build.js';
import {
  PREMISE_TYPE,
  INVOLVES,
  MENTIONS,
  OKF_VERSION,
  PARTY_TYPE,
  STATES,
  bundleRoot,
  conceptId,
  fold,
  isoDateOf,
  isPremiseId,
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
import { readOntology, relationNames, ruleOf } from './ontology.js';
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

const ALLOWED: Record<string, string[]> = { [PREMISE_TYPE]: [INVOLVES], [PARTY_TYPE]: [] };
const ONTOLOGY_FICHE = '~/.piecemaker/ontologie.json';

export function verifyBundle(input: { projectPath: string; resources: string[]; markdownOf: MarkdownOf }): OkfError[] {
  const { projectPath, markdownOf } = input;
  const types = readTypes(projectPath);
  const ontology = readOntology(projectPath);
  const documentRelations = [...relationNames(ontology), STATES, MENTIONS];
  const concepts = readBundle(projectPath);
  const typeById = new Map(concepts.map((concept) => [concept.id, text(concept.frontmatter.type)]));
  const errors: OkfError[] = [];
  if (ontology.erreur) errors.push({ fiche: ONTOLOGY_FICHE, erreur: ontology.erreur });
  errors.push(...storedOntologyErrors());

  for (const concept of concepts) {
    const report = (erreur: string) => errors.push({ fiche: concept.id, erreur });
    if (concept.error) { report(concept.error); continue; }
    const type = text(concept.frontmatter.type);
    const resource = text(concept.frontmatter.resource);
    const reserved = isPremiseId(concept.id) ? PREMISE_TYPE : isPartyId(concept.id) ? PARTY_TYPE : '';
    if (!type) report('type absent');
    else if (reserved || type === PREMISE_TYPE || type === PARTY_TYPE) {
      if (type !== reserved) report(`type « ${type} » incompatible avec l'emplacement de la fiche`);
      if (!text(concept.frontmatter.title)) report('title absent');
    } else if (!types.includes(type)) report(`type « ${type} » hors arborescence (${types.join(', ')})`);
    if (!reserved) {
      if (!resource) report('resource absent');
      else {
        if (!fs.existsSync(path.join(projectPath, resource))) report(`document absent : ${resource}`);
        if (conceptId(resource) !== concept.id) report(`la fiche ne correspond pas à son document : ${resource}`);
        if (type && typeOf(resource, types, projectPath) !== type) report(`type « ${type} » différent du dossier du document`);
      }
    }
    const allowed = ALLOWED[reserved] || documentRelations;
    if (reserved === PREMISE_TYPE) for (const link of linkedReviews(concept)) {
      const { erreur } = reviewRowPieces(projectPath, link.fichier, link.colonne);
      if (erreur) report(`revue liée ${link.fichier} › colonne ${link.colonne} : ${erreur} ; la délier : pm okf revue "${text(concept.frontmatter.title)}" --fichier "${link.fichier}" --colonne ${link.colonne} --retirer`);
    }
    const markdown = resource ? markdownOf(resource) : null;
    for (const [name, entries] of Object.entries(relationsOf(concept.frontmatter))) {
      if (!allowed.includes(name) && entries.some((entry) => !entry.dismissed)) report(`relation hors ontologie : ${name} (relations admises : ${allowed.join(', ') || 'aucune'})`);
      const rule = ruleOf(ontology, name);
      for (const entry of entries) {
        if (entry.dismissed) continue;
        const link = `${name} → ${entry.target || '?'}`;
        const targetType = typeById.get(entry.target);
        if (targetType === undefined) report(`${link} : cible absente du dossier`);
        else if (name === STATES) { if (targetType !== PREMISE_TYPE) report(`${link} : la cible n'est pas une prémisse`); }
        else if (name === MENTIONS || name === INVOLVES) { if (targetType !== PARTY_TYPE) report(`${link} : la cible n'est pas une partie`); }
        else if (rule && !rule.target.includes(targetType)) report(`${link} : la cible est de type « ${targetType} », l'ontologie admet ${rule.target.join(', ')}`);
        if (entry.target === concept.id) report(`${link} : lien vers soi-même`);
        if (rule && !rule.source.includes(type)) report(`${link} : la source est de type « ${type} », l'ontologie admet ${rule.source.join(', ')}`);
        if (name === INVOLVES) continue;
        if (!entry.citation) report(`${link} : citation absente`);
        else if (!quoted(markdown, entry.citation)) report(`${link} : citation introuvable dans le document`);
      }
    }
  }

  for (const resource of input.resources) {
    if (!typeById.has(conceptId(resource))) errors.push({ fiche: conceptId(resource), erreur: 'document sans fiche : lancer pm dossier conversion, qui convertit puis analyse le dossier et écrit les fiches' });
  }
  return [...errors, ...indexErrors(projectPath, concepts.map((concept) => concept.id))];
}

export function contradictions(projectPath: string): OkfContradiction[] {
  const concepts = readBundle(projectPath).filter((concept) => !concept.error);
  return concepts.filter((concept) => concept.frontmatter.type === PREMISE_TYPE && concept.frontmatter.single_value === true).flatMap((premise) => {
    const valeurs = concepts.flatMap((concept) => (relationsOf(concept.frontmatter)[STATES] || [])
      .filter((entry) => entry.target === premise.id && !entry.dismissed && entry.value)
      .map((entry) => ({ piece: concept.id, valeur: entry.value as string })))
      .concat(reviewPieces(projectPath, premise, concepts).filter((piece) => piece.value).map((piece) => ({ piece: conceptId(piece.resource), valeur: piece.value })));
    return new Set(valeurs.map((entry) => isoDateOf(entry.valeur) ?? fold(squash(entry.valeur)))).size > 1 ? [{ premise: premise.id, titre: text(premise.frontmatter.title), valeurs }] : [];
  });
}
