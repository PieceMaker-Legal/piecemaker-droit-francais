import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { caseOf, parseRoadmap, sections } from '../../piecemaker-plugin/scripts/lib/brain-case.mjs';

export const VIEW_FEATURE = 'case';
const COLLECTIONS = ['okf', 'deadlines', 'memories'];

const SAFE_ID = /^[A-Za-z0-9_\-.~:@+]{1,200}$/;
const idOf = (name) => (SAFE_ID.test(name) && name !== '.' && name !== '..' ? name : Buffer.from(name).toString('base64url'));

const versionOf = (file) => Math.floor(fs.statSync(file).mtimeMs);
const updatedOf = (file) => fs.statSync(file).mtime.toISOString();

function walk(folder, base = folder) {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return walk(full, base);
    return entry.isFile() ? [path.relative(base, full).split(path.sep).join('/')] : [];
  });
}

function okfData(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) return { body: content };
  return { ...(parse(match[1]) ?? {}), body: match[2] };
}

function brainCase(root) {
  try { return caseOf(root); } catch { return null; }
}

function brainSources(target) {
  const roadmap = () => { try { return parseRoadmap(fs.readFileSync(target.roadmap, 'utf8')); } catch { return {}; } };
  const about = () => { try { return fs.readFileSync(target.about, 'utf8'); } catch { return ''; } };
  return {
    deadlines: () => (fs.existsSync(target.roadmap) ? Object.keys(roadmap().suivis ?? {}) : []).filter((name) => name.endsWith('-suivi.json'))
      .map((name) => ({ id: idOf(name.slice(0, -'-suivi.json'.length)), file: target.roadmap, read: (text) => parseRoadmap(text).suivis?.[name] ?? {} })),
    memories: () => (fs.existsSync(target.about) ? sections(about()) : [])
      .map((section) => ({ id: idOf(section.name), file: target.about, read: (text) => ({ text: sections(text).find((entry) => entry.name === section.name)?.body ?? '' }) })),
  };
}

function sources(root) {
  const target = brainCase(root);
  if (target) return { okf: legacySources(root).okf, ...brainSources(target) };
  return legacySources(root);
}

function legacySources(root) {
  const folder = path.join(root, '.piecemaker');
  return {
    okf: () => walk(path.join(folder, 'okf')).filter((file) => file.endsWith('.md') && file !== 'index.md')
      .map((file) => ({ id: idOf(file), file: path.join(folder, 'okf', file), read: (text) => okfData(text) })),
    deadlines: () => (fs.existsSync(folder) ? fs.readdirSync(folder) : []).filter((file) => file.endsWith('-suivi.json'))
      .map((file) => ({ id: idOf(file.slice(0, -'-suivi.json'.length)), file: path.join(folder, file), read: (text) => JSON.parse(text) })),
    memories: () => walk(path.join(folder, 'memoires')).filter((file) => file.endsWith('.md') && !file.includes('/'))
      .map((file) => ({ id: idOf(file.slice(0, -3)), file: path.join(folder, 'memoires', file), read: (text) => ({ text }) })),
  };
}

export function isView(feature, segments) {
  return feature === VIEW_FEATURE && COLLECTIONS.includes(segments[0]);
}

function toDoc(collection, entry) {
  return { id: entry.id, path: `${collection}/${entry.id}`, data: entry.read(fs.readFileSync(entry.file, 'utf8')), version: versionOf(entry.file), updatedAt: updatedOf(entry.file) };
}

export function viewList(root, segments) {
  if (segments.length !== 1) return [];
  return sources(root)[segments[0]]().map((entry) => toDoc(segments[0], entry));
}

export function viewGet(root, segments) {
  if (segments.length !== 2) return null;
  const entry = sources(root)[segments[0]]().find((candidate) => candidate.id === segments[1]);
  return entry ? toDoc(segments[0], entry) : null;
}

export const VIEW_WRITE_HINT = {
  okf: 'The index is written through its checked commands: Feature run index link, unlink or mark_examined.',
  deadlines: 'Write the tracking file under "suivis" in the case Roadmap.json of the brain (pm check gives its path), or .piecemaker/<name>-suivi.json without a brain, with Edit or Write; Le Hérisson verifies it after each write.',
  memories: 'Write the "## Mémoire : <name>" section of the case About.md in the brain (pm check gives its path), or .piecemaker/memoires/<name>.md without a brain, with Edit or Write; Le Hérisson verifies it after each write.',
};
