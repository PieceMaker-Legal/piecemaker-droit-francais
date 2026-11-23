import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const ROADMAP = 'Timeline.json';
export const LEGACY_ROADMAP = 'Roadmap.json';
export const ABOUT = 'About.md';
export const GOALS = 'goals';
export const GOAL_FILES = ['Goal.md', 'Memory.md', 'Archive.md', 'Timeline.json'];
export const GOAL_LIMIT = 200;
const MAIN_GOAL = 'principal';
const ACTES = 'actes';
export const SUIVI_NAME = 'suivi.json';
export const SUIVI_FILE = /^(?:[^/\\\0]+-)?suivi\.json$/;
export const MEMOIRE_PREFIX = 'Mémoire : ';
export const ROADMAP_KEYS = ['synthese', 'etapes', 'suivis', 'suivisSupprimes'];
export const CASE_TIMELINE_KEYS = ['etape', 'nonJuridique', 'mappingValide', 'synthese', 'suivisSupprimes'];
export const GOAL_TIMELINE_KEYS = [ACTES, 'matter', 'evenements', 'echeances'];
export const suiviOfGoal = (goal) => (goal === MAIN_GOAL ? SUIVI_NAME : `${goal}-${SUIVI_NAME}`);
export const goalOfSuivi = (fichier) => (fichier === SUIVI_NAME ? MAIN_GOAL : fichier.slice(0, -`-${SUIVI_NAME}`.length));
const baseActe = (acte) => acte.replace(/-v\d+$/, '');
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
  return { brain, name, directory, roadmap: path.join(directory, ROADMAP), about: path.join(directory, ABOUT), goals: path.join(directory, GOALS) };
}

export function parseRoadmap(text) {
  if (text === null || text === undefined || !String(text).trim()) return {};
  const value = JSON.parse(text);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Roadmap.json doit être un objet.');
  return value;
}

export function goalNames(directory) {
  try { return fs.readdirSync(path.join(directory, GOALS), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort(); } catch { return []; }
}

export const goalFile = (directory, goal, file) => path.join(directory, GOALS, goal, file);

const filled = (value) => value !== undefined && !(value && typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);
const compact = (value) => Object.fromEntries(Object.entries(value).filter(([, entry]) => filled(entry)));

export function readRoadmap(file) {
  const directory = path.dirname(file);
  const { synthese, suivisSupprimes, ...etapes } = parseRoadmap(readText(file));
  const raisonnements = {};
  const suivis = {};
  for (const goal of goalNames(directory)) {
    const { [ACTES]: actes, ...suivi } = parseRoadmap(readText(goalFile(directory, goal, ROADMAP)));
    Object.assign(raisonnements, actes ?? {});
    if (Object.keys(suivi).length) suivis[suiviOfGoal(goal)] = suivi;
  }
  return compact({ synthese, etapes: compact({ ...etapes, raisonnements }), suivis, suivisSupprimes });
}

export function goalOwners(directory) {
  const owners = {};
  for (const goal of goalNames(directory)) {
    let actes = {};
    try { actes = parseRoadmap(readText(goalFile(directory, goal, ROADMAP)))[ACTES] ?? {}; } catch {}
    for (const acte of Object.keys(actes)) owners[acte] = goal;
  }
  return owners;
}

export function serializeRoadmap(value, keys = ROADMAP_KEYS) {
  const ordered = {};
  for (const key of keys) if (filled(value[key])) ordered[key] = value[key];
  for (const key of Object.keys(value)) if (!keys.includes(key)) ordered[key] = value[key];
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function writeRoadmap(file, value) {
  const directory = path.dirname(file);
  const { etapes = {}, suivis = {}, synthese, suivisSupprimes, ...rest } = value;
  const { raisonnements = {}, ...level } = etapes;
  writeText(file, serializeRoadmap({ ...level, synthese, suivisSupprimes, ...rest }, CASE_TIMELINE_KEYS));
  const owners = goalOwners(directory);
  const goals = Object.fromEntries(goalNames(directory).map((goal) => [goal, { [ACTES]: {} }]));
  for (const [acte, suite] of Object.entries(raisonnements)) {
    const goal = owners[acte] ?? owners[baseActe(acte)] ?? owners[suite?.precedent] ?? baseActe(acte);
    ((goals[goal] ??= { [ACTES]: {} })[ACTES])[acte] = suite;
  }
  for (const [fichier, suivi] of Object.entries(suivis)) Object.assign(goals[goalOfSuivi(fichier)] ??= { [ACTES]: {} }, suivi);
  for (const [goal, timeline] of Object.entries(goals)) {
    const target = goalFile(directory, goal, ROADMAP);
    if (Object.keys(compact(timeline)).length) writeText(target, serializeRoadmap(timeline, GOAL_TIMELINE_KEYS));
    else if (readText(target) !== null) writeText(target, '{}\n');
  }
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

function moveMemory(directory, name, body) {
  const file = goalFile(directory, name, 'Memory.md');
  if (readText(file) === null) writeText(file, `${String(body).trim()}\n`);
}

function migrateAbout(target) {
  const text = readText(target.about);
  const found = sections(text);
  if (!found.length) return;
  for (const section of found) moveMemory(target.directory, section.name, section.body);
  const lines = text.split('\n');
  const kept = lines.filter((line, index) => !found.some((section) => {
    const next = lines.findIndex((entry, at) => at >= section.line && /^## /.test(entry));
    return index >= section.line - 1 && (next < 0 || index < next);
  }));
  writeText(target.about, `${kept.join('\n').replace(/\s*$/, '')}\n`);
}

function migrateLegacyRoadmap(target) {
  const legacy = path.join(target.directory, LEGACY_ROADMAP);
  const text = readText(legacy);
  if (text === null) return;
  const old = parseRoadmap(text);
  updateRoadmap(target.roadmap, (roadmap) => {
    for (const key of ['synthese', 'suivis', 'suivisSupprimes']) roadmap[key] = { ...(old[key] ?? {}), ...(roadmap[key] ?? {}) };
    const { raisonnements, ...level } = old.etapes ?? {};
    roadmap.etapes = { ...level, ...(roadmap.etapes ?? {}), raisonnements: { ...(raisonnements ?? {}), ...(roadmap.etapes?.raisonnements ?? {}) } };
  });
  fs.renameSync(legacy, `${legacy}.migre`);
}

export function caseOf(folder, options = {}) {
  const target = caseDirectory(folder, options);
  if (!target || options.create === false) return target;
  migrateLegacyRoadmap(target);
  migrateAbout(target);
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
        if (entry === 'etapes.json') roadmap.etapes = { ...value, ...(roadmap.etapes ?? {}), raisonnements: { ...(value.raisonnements ?? {}), ...(roadmap.etapes?.raisonnements ?? {}) } };
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
    const body = readText(path.join(memoires, note));
    if (body !== null) moveMemory(target.directory, note.slice(0, -3), body);
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
