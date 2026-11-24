import fs from 'node:fs';
import path from 'node:path';

import { LINKS_HEADING, PROJECTS, linksSection, splitFrontmatter } from './generate.js';

export type LibraryConcept = { id: string; type: string; title: string; description: string; domaine: string; status: string; dossier: string };
export type LibraryEdge = { from: string; to: string };
export type LibraryTemplate = LibraryConcept & { resource: string; projects: string[]; guidelines: string[] };

const LINK = /\[[^\]]*\]\(([^)\s#]+)(?:#[^)\s]*)?(?:\s+"[^"]*")?\)/g;
const SKIPPED = new Set(['assets']);
const EDITABLE = new Set(['guidelines', 'templates', 'domains', PROJECTS]);
export const MAX_LINES = 500;

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const posix = (value: string): string => value.split(path.sep).join('/');

function markdownFiles(root: string): string[] {
  return (fs.readdirSync(root, { recursive: true }) as string[])
    .map(posix)
    .filter((file) => file.endsWith('.md') && !SKIPPED.has(file.split('/')[0]) && !file.split('/').some((part) => part.startsWith('.')));
}

/** Cible d'un lien Markdown, en identifiant du bundle (`/guidelines/x.md`), ou null pour un lien externe. */
export function resolveLink(from: string, target: string): string | null {
  if (/^[a-z]+:/i.test(target) || !target.endsWith('.md')) return null;
  const resolved = target.startsWith('/') ? path.posix.normalize(target) : path.posix.normalize(path.posix.join(path.posix.dirname(from), target));
  return resolved.startsWith('/..') ? null : resolved;
}

const linksOf = (id: string, body: string): string[] => [...body.matchAll(LINK)].map((match) => resolveLink(id, match[1])).filter((value): value is string => Boolean(value));

/** Graphe et liste de la Library : concepts, liens, et pour chaque template ses projets attachés et ses guidelines. */
export function readLibrary(root: string) {
  if (!fs.existsSync(path.join(root, 'index.md'))) return { concepts: [], edges: [], templates: [] };
  const concepts: LibraryConcept[] = [];
  const edges: LibraryEdge[] = [];
  const bodies = new Map<string, string>();
  const resources = new Map<string, string>();
  for (const file of markdownFiles(root)) {
    const id = `/${file}`;
    const { frontmatter, body } = splitFrontmatter(fs.readFileSync(path.join(root, file), 'utf8'));
    bodies.set(id, body);
    if (path.posix.basename(file) === 'index.md' || file === 'log.md') continue;
    concepts.push({ id, type: text(frontmatter.type) || 'Concept', title: text(frontmatter.title) || path.posix.basename(file, '.md'), description: text(frontmatter.description), domaine: text(frontmatter.domaine), status: text(frontmatter.status), dossier: text(frontmatter.dossier) });
    resources.set(id, text(frontmatter.resource));
  }
  const known = new Set(concepts.map((concept) => concept.id));
  const seen = new Set<string>();
  for (const concept of concepts) {
    for (const target of linksOf(concept.id, bodies.get(concept.id) ?? '')) {
      const key = `${concept.id}→${target}`;
      if (!known.has(target) || target === concept.id || seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: concept.id, to: target });
    }
  }
  const byId = new Map(concepts.map((concept) => [concept.id, concept]));
  const isType = (id: string, type: string) => byId.get(id)?.type === type;
  // Une ligne de tableau d'un domaine qui nomme un template et une guideline les apparie.
  const pairs = concepts.filter((concept) => concept.type === 'Domaine').flatMap((domain) => (bodies.get(domain.id) ?? '').split(/\r?\n/)
    .filter((line) => line.trim().startsWith('|'))
    .map((line) => linksOf(domain.id, line)));
  const templates: LibraryTemplate[] = concepts.filter((concept) => concept.type === 'Template').map((template) => {
    const neighbours = edges.flatMap((edge) => edge.from === template.id ? [edge.to] : edge.to === template.id ? [edge.from] : []);
    const paired = pairs.filter((row) => row.includes(template.id)).flat();
    const projects = concepts.filter((concept) => concept.type === 'Projet' && linksSection(bodies.get(concept.id) ?? '').some((line) => linksOf(concept.id, line).includes(template.id))).map((concept) => concept.id);
    const guidelines = [...new Set([...neighbours, ...paired].filter((id) => isType(id, 'Guideline')))];
    return { ...template, resource: resources.get(template.id) ?? '', projects, guidelines };
  });
  return { concepts, edges, templates };
}

/** Chemin d'un concept modifiable (guidelines, templates, domaines, projets), ou une erreur 400. */
export function editableFile(root: string, id: unknown): string {
  const value = typeof id === 'string' ? path.posix.normalize(id) : '';
  const parts = value.split('/');
  if (!value.startsWith('/') || !value.endsWith('.md') || parts.includes('..') || parts.length !== 3 || !EDITABLE.has(parts[1]) || parts[2] === 'index.md') {
    throw Object.assign(new Error('Seuls les guidelines, templates, domaines et projets de la Library se modifient.'), { code: 400 });
  }
  const file = path.join(root, ...parts.slice(1));
  if (!fs.existsSync(file)) throw Object.assign(new Error('Concept introuvable.'), { code: 404 });
  return file;
}

export function readConcept(root: string, id: unknown) {
  const file = editableFile(root, id);
  return { id, content: fs.readFileSync(file, 'utf8') };
}

export function writeConcept(root: string, id: unknown, content: unknown) {
  const file = editableFile(root, id);
  if (typeof content !== 'string' || !content.startsWith('---')) throw Object.assign(new Error('Le concept garde son frontmatter YAML.'), { code: 400 });
  if (content.split(/\r?\n/).length > MAX_LINES) throw Object.assign(new Error(`Un concept tient en ${MAX_LINES} lignes au plus.`), { code: 400 });
  fs.writeFileSync(file, content.endsWith('\n') ? content : `${content}\n`);
  return { id, content };
}

/** Attache (ou détache) un projet à un concept : une ligne de la section « Liens » de la fiche projet. */
export function linkProject(root: string, project: unknown, target: unknown, attach: boolean) {
  const file = editableFile(root, project);
  if (!String(project).startsWith(`/${PROJECTS}/`)) throw Object.assign(new Error('Seul un projet se relie.'), { code: 400 });
  const targetFile = editableFile(root, target);
  const id = String(target);
  const title = text(splitFrontmatter(fs.readFileSync(targetFile, 'utf8')).frontmatter.title) || path.posix.basename(id, '.md');
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split(/\r?\n/);
  let start = lines.findIndex((line) => line.trim() === LINKS_HEADING);
  if (start < 0) { lines.push('', LINKS_HEADING, ''); start = lines.length - 2; }
  let end = lines.findIndex((line, index) => index > start && /^#{1,2} /.test(line));
  if (end < 0) end = lines.length;
  const items = lines.slice(start + 1, end).filter((line) => line.trim().startsWith('- ') && !linksOf(String(project), line).includes(id));
  if (attach) items.push(`- [${title}](${id})`);
  const section = items.length ? items : ['À relier : template, guideline.'];
  const next = [...lines.slice(0, start + 1), '', ...section, ...(end < lines.length ? ['', ...lines.slice(end)] : [''])].join('\n');
  fs.writeFileSync(file, next.replace(/\n{3,}/g, '\n\n'));
  return { project, target: id, attached: attach };
}
