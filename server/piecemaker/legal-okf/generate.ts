import fs from 'node:fs';
import path from 'node:path';

import { parse, stringify } from 'yaml';

/**
 * Bundles générés dans la Library par du code statique, sans appel au modèle :
 * - `clients/` : une fiche par partie cliente (`side: client`) des fiches `persons/` de chaque dossier du brain ;
 * - `projects/` : une fiche par artifact docx (`document`) de chaque dossier.
 * Une fiche générée porte `generated.by: library`. Les liens de la section « Liens » d'un projet
 * (vers un template, une guideline) sont posés au fur et à mesure et survivent à la régénération.
 */
export const GENERATOR = 'library';
export const CLIENTS = 'clients';
export const PROJECTS = 'projects';
const LEGACY_EXAMPLES = 'exemples';
export const LINKS_HEADING = '## Liens';

export type Dossier = { name: string; folder: string };
type Fiche = { file: string; frontmatter: Record<string, unknown>; body: string };

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const compare = (left: string, right: string): number => left.localeCompare(right, 'fr', { sensitivity: 'base' });
export const slug = (value: string): string => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sans-nom';

export function splitFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return { frontmatter: {}, body: content };
  try {
    const value = parse(match[1]);
    return { frontmatter: value && typeof value === 'object' && !Array.isArray(value) ? value : {}, body: match[2] };
  } catch {
    return { frontmatter: {}, body: match[2] };
  }
}

const render = (frontmatter: Record<string, unknown>, sections: string[]): string => [`---\n${stringify(frontmatter).trim()}\n---`, ...sections].join('\n\n') + '\n';
const readText = (file: string): string | null => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

/** Dossiers du brain (`.piecemaker/dossiers.json` : chemin réel → nom), seulement ceux qui existent encore. */
export function brainDossiers(brain: string): Dossier[] {
  try {
    const index = JSON.parse(fs.readFileSync(path.join(brain, '.piecemaker', 'dossiers.json'), 'utf8'));
    return Object.entries(index && typeof index === 'object' ? index : {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && fs.existsSync(entry[0]))
      .map(([folder, name]) => ({ folder, name }))
      .sort((left, right) => compare(left.name, right.name));
  } catch {
    return [];
  }
}

/** Les lignes de liste sous « ## Liens » : seule partie d'une fiche projet écrite à la main ou par l'agent. */
export function linksSection(body: string): string[] {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === LINKS_HEADING);
  if (start < 0) return [];
  const end = lines.findIndex((line, index) => index > start && /^#{1,2} /.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).filter((line) => line.trim().startsWith('- '));
}

function clientsOf(dossier: Dossier): Fiche[] {
  const folder = path.join(dossier.folder, '.piecemaker', 'okf', 'persons');
  let names: string[] = [];
  try { names = fs.readdirSync(folder).filter((name) => name.endsWith('.md') && name !== 'index.md'); } catch { return []; }
  return names.flatMap((name) => {
    const { frontmatter, body } = splitFrontmatter(readText(path.join(folder, name)) ?? '');
    if (text(frontmatter.side) !== 'client') return [];
    const designation = /## Désignation\n\n([\s\S]*?)(?=\n## |\s*$)/.exec(body)?.[1]?.trim() ?? '';
    return [{ file: `${slug(dossier.name)}--${name}`, frontmatter: { type: 'Client', title: text(frontmatter.title) || name, description: `Client du dossier ${dossier.name}.`, dossier: dossier.name, code: text(frontmatter.code), cco: text(frontmatter.cco) }, body: designation }];
  });
}

function projectsOf(dossier: Dossier): Fiche[] {
  const items = path.join(dossier.folder, '.piecemaker', 'artifacts', 'items');
  let ids: string[] = [];
  try { ids = fs.readdirSync(items); } catch { return []; }
  return ids.flatMap((id) => {
    let meta: Record<string, unknown>;
    try { meta = JSON.parse(fs.readFileSync(path.join(items, id, 'artifact.json'), 'utf8')); } catch { return []; }
    const document = text(meta.document);
    if (!/\.docx$/i.test(document)) return [];
    return [{ file: `${slug(dossier.name)}--${id}.md`, frontmatter: { type: 'Projet', title: text(meta.title) || path.basename(document, '.docx'), description: text(meta.description) || `Acte du dossier ${dossier.name}.`, dossier: dossier.name, document, artifact: `piecemaker://artifact/${id}`, date: text(meta.updated_at).slice(0, 10) }, body: '' }];
  });
}

/** Écrit un dossier généré : retire les fiches générées disparues, garde les fiches faites à la main. */
function writeFolder(root: string, folder: string, fiches: Map<string, string>) {
  const directory = path.join(root, folder);
  fs.mkdirSync(directory, { recursive: true });
  for (const name of fs.readdirSync(directory)) {
    if (!name.endsWith('.md') || fiches.has(name) || name === 'index.md') continue;
    const generated = splitFrontmatter(readText(path.join(directory, name)) ?? '').frontmatter.generated as { by?: unknown } | undefined;
    if (generated?.by === GENERATOR) fs.rmSync(path.join(directory, name), { force: true });
  }
  for (const [name, content] of fiches) {
    const file = path.join(directory, name);
    if (readText(file) !== content) fs.writeFileSync(file, content);
  }
}

/** Les anciens exemples (`exemples/`, `type: Exemple`) deviennent des projets ; les liens du bundle suivent. */
function migrateExamples(root: string) {
  const legacy = path.join(root, LEGACY_EXAMPLES);
  if (!fs.existsSync(legacy)) return;
  const target = path.join(root, PROJECTS);
  fs.mkdirSync(target, { recursive: true });
  for (const name of fs.readdirSync(legacy).filter((entry) => entry.endsWith('.md') && entry !== 'index.md')) {
    if (fs.existsSync(path.join(target, name))) continue;
    fs.writeFileSync(path.join(target, name), (readText(path.join(legacy, name)) ?? '').replace(/^type:\s*Exemple\s*$/m, 'type: Projet'));
  }
  fs.rmSync(legacy, { recursive: true, force: true });
  for (const file of fs.readdirSync(root, { recursive: true }) as string[]) {
    if (!file.endsWith('.md') || file.split(path.sep)[0] === 'assets') continue;
    const content = readText(path.join(root, file)) ?? '';
    const updated = content.replace(/\]\((\/?)exemples\//g, '](/projects/');
    if (updated !== content) fs.writeFileSync(path.join(root, file), updated);
  }
}

function ensureRootLinks(root: string) {
  const file = path.join(root, 'index.md');
  const content = readText(file);
  if (content === null) return;
  const missing = [[CLIENTS, 'Les [clients](/clients/index.md) de chaque dossier (généré).'], [PROJECTS, 'Les [projets](/projects/index.md) : actes docx des dossiers, reliés aux templates (généré).']]
    .filter(([folder]) => !content.includes(`/${folder}/index.md`)).map(([, line]) => `- ${line}`);
  if (missing.length) fs.writeFileSync(file, `${content.trimEnd()}\n\n${missing.join('\n')}\n`);
}

export function generateLibrary(root: string, dossiers: Dossier[], at = new Date().toISOString()) {
  if (!fs.existsSync(path.join(root, 'index.md'))) return { clients: 0, projects: 0 };
  migrateExamples(root);
  const generated = { by: GENERATOR, at };
  const clients = dossiers.flatMap(clientsOf);
  const projects = dossiers.flatMap(projectsOf);
  const clientLinks = (dossier: unknown) => clients.filter((client) => client.frontmatter.dossier === dossier).map((client) => `- [${client.frontmatter.title}](/${CLIENTS}/${client.file})`);
  const projectLinks = (dossier: unknown) => projects.filter((project) => project.frontmatter.dossier === dossier).map((project) => `- [${project.frontmatter.title}](/${PROJECTS}/${project.file})`);
  const previous = (file: string) => splitFrontmatter(readText(path.join(root, PROJECTS, file)) ?? '');
  const stamp = (fiche: Fiche, file: string) => {
    const old = previous(file).frontmatter.generated as { at?: unknown } | undefined;
    return { ...fiche.frontmatter, generated: { ...generated, at: text(old?.at) || at } };
  };

  const clientFiles = new Map(clients.map((client): [string, string] => [client.file, render({ ...client.frontmatter, generated }, [
    `# ${client.frontmatter.title}`, client.body || 'Désignation à compléter dans la base du dossier.', `## Projets\n\n${projectLinks(client.frontmatter.dossier).join('\n') || 'Aucun.'}`])]));
  const projectFiles = new Map(projects.map((project): [string, string] => {
    const links = linksSection(previous(project.file).body);
    return [project.file, render(stamp(project, project.file), [
      `# ${project.frontmatter.title}`,
      `Acte \`${project.frontmatter.document}\` du dossier ${project.frontmatter.dossier}.`,
      `## Clients\n\n${clientLinks(project.frontmatter.dossier).join('\n') || 'Aucun.'}`,
      `${LINKS_HEADING}\n\n${links.join('\n') || 'À relier : template, guideline.'}`])];
  }));
  // Les fiches gardent leur date de génération tant que leur contenu ne change pas.
  for (const [name, content] of clientFiles) {
    const old = readText(path.join(root, CLIENTS, name));
    if (old && old.replace(/\n  at: .*\n/, '\n') === content.replace(/\n  at: .*\n/, '\n')) clientFiles.set(name, old);
  }
  const index = (title: string, folder: string, fiches: Fiche[]) => `---\n${stringify({ type: 'Index', title, generated }).trim()}\n---\n\n# ${title}\n\nFiches générées par PieceMaker : ne les modifiez pas ici${folder === PROJECTS ? ', sauf la section « Liens »' : ''}.\n\n${
    [...new Set(fiches.map((fiche) => text(fiche.frontmatter.dossier)))].sort(compare).map((dossier) => `## ${dossier}\n\n${fiches.filter((fiche) => fiche.frontmatter.dossier === dossier).map((fiche) => `- [${fiche.frontmatter.title}](/${folder}/${fiche.file})`).sort(compare).join('\n')}`).join('\n\n') || 'Aucune fiche.'}\n`;
  writeFolder(root, CLIENTS, clientFiles);
  writeFolder(root, PROJECTS, projectFiles);
  for (const [folder, title, fiches] of [[CLIENTS, 'Clients', clients], [PROJECTS, 'Projets', projects]] as const) {
    const file = path.join(root, folder, 'index.md');
    const content = index(title, folder, fiches);
    const old = readText(file);
    if (!old || old.replace(/\n  at: .*\n/, '\n') !== content.replace(/\n  at: .*\n/, '\n')) fs.writeFileSync(file, content);
  }
  ensureRootLinks(root);
  return { clients: clients.length, projects: projects.length };
}
