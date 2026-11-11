import fs from 'node:fs';
import path from 'node:path';

import type { MarkdownOf } from './build.js';
import {
  OKF_VERSION,
  RELATIONS,
  bundleRoot,
  conceptId,
  parseAtoms,
  parseConcept,
  readBundle,
  readGraphTypes,
  readTypes,
  relationsOf,
  squash,
  text,
  typeOf,
} from './bundle.js';

export type OkfError = { fiche: string; erreur: string };

export function quoted(markdown: string | null, citation: string): boolean {
  const needle = squash(citation.replace(/^…|…$/g, ''));
  return Boolean(markdown && needle && squash(markdown).includes(needle));
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

export function verifyBundle(input: { projectPath: string; resources: string[]; markdownOf: MarkdownOf }): OkfError[] {
  const { projectPath, markdownOf } = input;
  const types = readTypes(projectPath);
  const graphTypes = readGraphTypes(projectPath);
  const concepts = readBundle(projectPath);
  const typeById = new Map(concepts.map((concept) => [concept.id, text(concept.frontmatter.type)]));
  const errors: OkfError[] = [];

  for (const concept of concepts) {
    const report = (erreur: string) => errors.push({ fiche: concept.id, erreur });
    if (concept.error) { report(concept.error); continue; }
    const type = text(concept.frontmatter.type);
    const resource = text(concept.frontmatter.resource);
    if (!type) report('type absent');
    else if (!types.includes(type)) report(`type « ${type} » hors arborescence (${types.join(', ')})`);
    if (!resource) report('resource absent');
    else {
      if (!fs.existsSync(path.join(projectPath, resource))) report(`document absent : ${resource}`);
      if (conceptId(resource) !== concept.id) report(`la fiche ne correspond pas à son document : ${resource}`);
      if (type && typeOf(resource, types) !== type) report(`type « ${type} » différent du dossier du document`);
    }
    const markdown = resource ? markdownOf(resource) : null;
    for (const [name, entries] of Object.entries(relationsOf(concept.frontmatter))) {
      if (!RELATIONS.includes(name)) report(`relation inconnue : ${name} (${RELATIONS.join(', ')})`);
      for (const entry of entries) {
        if (entry.dismissed) continue;
        const link = `${name} → ${entry.target || '?'}`;
        if (!typeById.has(entry.target)) report(`${link} : cible absente du dossier`);
        else if (!graphTypes.includes(typeById.get(entry.target) as string)) report(`${link} : la cible n'est pas de type ${graphTypes.join(', ')}`);
        if (entry.target === concept.id) report(`${link} : lien vers soi-même`);
        if (!graphTypes.includes(type)) report(`${link} : la source n'est pas de type ${graphTypes.join(', ')}`);
        if (!entry.citation) report(`${link} : citation absente`);
        else if (!quoted(markdown, entry.citation)) report(`${link} : citation introuvable dans le document`);
      }
    }
    for (const atom of parseAtoms(concept.body)) {
      if (!quoted(markdown, atom.citation)) report(`atome ${atom.code} : citation introuvable dans le document`);
    }
  }

  for (const resource of input.resources) {
    if (!typeById.has(conceptId(resource))) errors.push({ fiche: conceptId(resource), erreur: 'document sans fiche : relancer l\'analyse du dossier' });
  }
  return [...errors, ...indexErrors(projectPath, concepts.map((concept) => concept.id))];
}
