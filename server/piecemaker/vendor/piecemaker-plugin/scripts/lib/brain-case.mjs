import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ROADMAP = 'Roadmap.json';
export const ABOUT = 'About.md';
export const SUIVI_NAME = 'suivi.json';
export const SUIVI_FILE = /^(?:[^/\\\0]+-)?suivi\.json$/;
export const MEMOIRE_PREFIX = 'Mémoire : ';
export const ROADMAP_KEYS = ['synthese', 'etapes', 'suivis', 'suivisSupprimes'];
export const SYNTHESE = 'synthese.mjs';
export const SYNTHESE_TEMPLATE = `export default async function synthese({ points, pm }) {
  const point = (nom) => points.find((entry) => !entry.titre && entry.texte.startsWith(\`\${nom} :\`));
  const etat = (entry) => !entry ? 'inconnu' : entry.ok ? 'valide' : \`à exécuter : \${entry.texte.slice(entry.texte.indexOf(':') + 2)}\`;
  const parties = { etat: etat(point('Mapping')) };
  try {
    const table = String(await pm('dossier', 'sql', "SELECT COALESCE(json_extract(data_json, '$.partySide'), 'à qualifier') AS cote, count(*) AS nombre FROM piecemaker_nodes WHERE project_id = dossier() AND kind IN ('person', 'company') GROUP BY cote"));
    const lignes = table.split('\\n').slice(1).filter((ligne) => ligne.includes('\\t'));
    parties.nombre = Object.fromEntries(lignes.map((ligne) => { const [cote, nombre] = ligne.split('\\t'); return [cote, Number(nombre)]; }));
    if (parties.nombre['à qualifier'] && parties.etat === 'valide') parties.etat = \`à exécuter : \${parties.nombre['à qualifier']} partie(s) à qualifier dans l’onglet Dossier\`;
  } catch {}
  return { parties, okf: { etat: etat(point('Index')) } };
}
`;
const INDEX = path.join('.piecemaker', 'dossiers.json');

export const piecemakerHome = () => process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker');

const real = (value) => { try { return fs.realpathSync(value); } catch { return path.resolve(value); } };
const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } };

function writeText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
}

export function brainRoot(home = piecemakerHome()) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(home, 'brain.json'), 'utf8'))?.path;
    return typeof value === 'string' && path.isAbsolute(value) ? path.resolve(value) : null;
  } catch {
    return null;
  }
}

function readIndex(brain) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(brain, INDEX), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function caseName(brain, folder, create = true) {
  const key = real(folder);
  const index = readIndex(brain);
  if (typeof index[key] === 'string') return index[key];
  if (!create) return null;
  const taken = new Set(Object.values(index));
  const base = path.basename(key);
  let name = base;
  for (let count = 2; taken.has(name); count += 1) name = `${base} (${count})`;
  writeText(path.join(brain, INDEX), `${JSON.stringify({ ...index, [key]: name }, null, 2)}\n`);
  return name;
}

export function folderOfCase(brain, name) {
  return Object.entries(readIndex(brain)).find(([, value]) => value === name)?.[0] ?? null;
}

export function caseOfBrainFile(file, home = piecemakerHome()) {
  const brain = brainRoot(home);
  if (!brain) return null;
  const parts = path.relative(brain, path.resolve(file)).split(path.sep);
  if (parts.length < 2 || parts[0] !== 'projects' || parts[1] === '..') return null;
  const folder = folderOfCase(brain, parts[1]);
  return { brain, name: parts[1], folder, directory: path.join(brain, 'projects', parts[1]), rest: parts.slice(2).join('/') };
}

export function caseDirectory(folder, { home = piecemakerHome(), create = true } = {}) {
  const brain = brainRoot(home);
  if (!brain || !folder) return null;
  const name = caseName(brain, folder, create);
  if (!name) return null;
  const directory = path.join(brain, 'projects', name);
  if (create) fs.mkdirSync(directory, { recursive: true });
  return { brain, name, directory, roadmap: path.join(directory, ROADMAP), about: path.join(directory, ABOUT) };
}

export function parseRoadmap(text) {
  if (text === null || text === undefined || !String(text).trim()) return {};
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Roadmap.json doit être un objet.');
  return value;
}

export function readRoadmap(file) {
  return parseRoadmap(readText(file));
}

export function serializeRoadmap(value) {
  const ordered = {};
  for (const key of ROADMAP_KEYS) if (value[key] !== undefined && !(typeof value[key] === 'object' && !Array.isArray(value[key]) && !Object.keys(value[key]).length)) ordered[key] = value[key];
  for (const key of Object.keys(value)) if (!ROADMAP_KEYS.includes(key)) ordered[key] = value[key];
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function writeRoadmap(file, value) {
  writeText(file, serializeRoadmap(value));
}

export function updateRoadmap(file, change) {
  const value = readRoadmap(file);
  const result = change(value);
  writeRoadmap(file, value);
  return result;
}

export function sections(text, prefix = MEMOIRE_PREFIX) {
  const lines = String(text ?? '').split('\n');
  const found = [];
  lines.forEach((line, index) => {
    const match = /^## (.+?)\s*$/.exec(line);
    if (match && match[1].startsWith(prefix)) found.push({ name: match[1].slice(prefix.length), line: index + 1 });
  });
  return found.map((section) => {
    const next = lines.findIndex((line, index) => index >= section.line && /^## /.test(line));
    return { ...section, body: lines.slice(section.line, next < 0 ? undefined : next).join('\n').trim() };
  });
}

export function writeSection(file, name, body, title, prefix = MEMOIRE_PREFIX) {
  const text = readText(file) ?? `# ${title}\n`;
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.trim() === `## ${prefix}${name}`);
  const block = [`## ${prefix}${name}`, '', String(body).trim(), ''];
  if (start < 0) return writeText(file, `${text.replace(/\s*$/, '\n')}\n${block.join('\n')}`);
  const next = lines.findIndex((line, index) => index > start && /^## /.test(line));
  writeText(file, [...lines.slice(0, start), ...block, ...(next < 0 ? [] : lines.slice(next))].join('\n'));
}

export function caseOf(folder, options = {}) {
  const target = caseDirectory(folder, options);
  if (!target || options.create === false) return target;
  const technical = path.join(folder, '.piecemaker');
  let entries = [];
  try { entries = fs.readdirSync(technical); } catch { return target; }
  const legacy = entries.filter((entry) => /^(?:.+-)?suivi\.json(?:\.supprime)?$/.test(entry) || entry === 'etapes.json');
  if (legacy.length) {
    updateRoadmap(target.roadmap, (roadmap) => {
      for (const entry of legacy) {
        const text = readText(path.join(technical, entry));
        let value;
        try { value = JSON.parse(text); } catch { continue; }
        if (entry === 'etapes.json') roadmap.etapes ??= value;
        else if (entry.endsWith('.supprime')) (roadmap.suivisSupprimes ??= {})[entry.slice(0, -'.supprime'.length)] ??= value;
        else (roadmap.suivis ??= {})[entry] ??= value;
        fs.renameSync(path.join(technical, entry), path.join(technical, `${entry}.migre`));
      }
    });
  }
  const memoires = path.join(technical, 'memoires');
  let notes = [];
  try { notes = fs.readdirSync(memoires).filter((entry) => entry.endsWith('.md')); } catch { notes = []; }
  for (const note of notes) {
    const name = note.slice(0, -3);
    const body = readText(path.join(memoires, note));
    if (body !== null && !sections(readText(target.about)).some((section) => section.name === name)) writeSection(target.about, name, body, target.name);
    fs.renameSync(path.join(memoires, note), path.join(memoires, `${note}.migre`));
  }
  return target;
}

export function syntheseScript(directory) {
  const file = path.join(directory, SYNTHESE);
  if (readText(file) === null) writeText(file, SYNTHESE_TEMPLATE);
  return file;
}

export async function runSynthese(folder, context, options = {}) {
  const target = caseOf(folder, options);
  if (!target) return null;
  const file = syntheseScript(target.directory);
  const module = await import(`${pathToFileURL(file).href}?v=${fs.statSync(file).mtimeMs}`);
  const value = await module.default(context);
  const synthese = { ...(value && typeof value === 'object' && !Array.isArray(value) ? value : {}), le: new Date().toISOString() };
  updateRoadmap(target.roadmap, (roadmap) => { roadmap.synthese = synthese; });
  return synthese;
}
