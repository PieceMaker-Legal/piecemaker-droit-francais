import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'herisson.json');

const REGISTRY_DATA = JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));

export const FEATURES = REGISTRY_DATA.features.map((feature) => ({ ...feature, pattern: new RegExp(feature.cible) }));

export const CATALOGUE = REGISTRY_DATA.catalogue;

const invalid = (message) => Object.assign(new Error(message), { code: 'invalid_argument' });

export function commandOf(featureName, commandName) {
  const feature = CATALOGUE.find((entry) => entry.nom === featureName);
  if (!feature) throw invalid(`unknown feature "${featureName}". Features: ${CATALOGUE.map((entry) => entry.nom).join(', ')}.`);
  const command = (feature.commandes ?? []).find((entry) => entry.nom === commandName);
  if (!command) throw invalid(`unknown command "${commandName}" for feature ${featureName}. Commands: ${(feature.commandes ?? []).map((entry) => entry.nom).join(', ') || 'none'}.`);
  return { ...command, parametres: command.parametres ?? feature.parametres ?? {} };
}

const flagValue = (value) => (typeof value === 'object' ? JSON.stringify(value) : String(value));

export function pmArgv(featureName, commandName, args = {}) {
  const command = commandOf(featureName, commandName);
  const unknown = Object.keys(args).filter((key) => !(key in command.parametres));
  if (unknown.length) throw invalid(`${commandName}: unknown parameter(s) ${unknown.join(', ')}. Parameters: ${Object.keys(command.parametres).join(', ') || 'none'}.`);
  const positional = [];
  const flags = [];
  for (const [name, spec] of Object.entries(command.parametres)) {
    const value = args[name];
    if (spec.startsWith('#')) {
      if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
        if (spec === '#') throw invalid(`${commandName} needs "${name}".`);
        continue;
      }
      positional.push(...(Array.isArray(value) ? value : [value]).map(String));
    } else if (value === true) flags.push(spec);
    else if (value !== undefined && value !== null && value !== false) flags.push(spec, flagValue(value));
  }
  return [...command.pm, ...positional, ...flags];
}

export function featureOf(absolute) {
  const parts = String(absolute).replace(/\\/g, '/').split('/.piecemaker/');
  if (parts.length < 2) return null;
  const relative = parts.pop();
  const root = parts.join('/.piecemaker/');
  for (const feature of FEATURES) {
    const match = feature.pattern.exec(relative);
    if (match) return { feature, root, nom: match.groups?.nom ?? '' };
  }
  return null;
}

export function verifierArgs(found) {
  return found.feature.verifier.map((arg) => arg.replace('{nom}', found.nom));
}

const PATCH_SECTION = /^\*\*\* (Add|Update|Delete) File: (.+)$/;
const SUIVI_KEYS = ['matter', 'evenements', 'echeances'];
const lineOf = (content, index) => content.slice(0, Math.max(0, index)).split('\n').length;

function suiviErrors(content) {
  let value;
  try { value = JSON.parse(content); } catch (error) {
    const position = /position (\d+)/.exec(error.message);
    return [{ line: position ? lineOf(content, Number(position[1])) : 1, message: `invalid JSON: ${error.message.replace(/ in JSON at position.*$/, '')}. Write valid JSON: double quotes, no trailing comma, no comment.` }];
  }
  const shape = '{ "matter": {…}, "evenements": { "event name": {…} }, "echeances": { "deadline name": {…} } }';
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [{ line: 1, message: `the tracking file must be an object ${shape}, not ${Array.isArray(value) ? 'a list' : 'a single value'}.` }];
  const errors = [];
  for (const key of Object.keys(value)) {
    const line = lineOf(content, content.indexOf(JSON.stringify(key)));
    if (!SUIVI_KEYS.includes(key)) errors.push({ line, message: `unknown key "${key}" at the root of the tracking file. Permitted keys: ${SUIVI_KEYS.join(', ')}. Move its content under one of them or remove it.` });
    else if (!value[key] || typeof value[key] !== 'object' || Array.isArray(value[key])) errors.push({ line, message: `"${key}" must be an object ${key === 'matter' ? '{ "client": …, "summary": … }' : `{ "name in French": {…} }`}, not ${Array.isArray(value[key]) ? 'a list' : 'a single value'}.` });
  }
  return errors;
}

function memoireErrors(content) {
  return /^---\r?\n/.test(content) ? [{ line: 1, message: 'frontmatter is not permitted: the memory starts with a block between two "---" lines. Remove this block. Deadlines go in .piecemaker/<name>-suivi.json. The lawyer sets the current step and the document to produce on the board of the Suivi des dossiers tab: read them with pm check.' }] : [];
}

function programNameErrors(file, content) {
  const directory = path.dirname(file);
  const nom = path.basename(directory);
  if (!content || (fs.existsSync(directory) && fs.readdirSync(directory).some((entry) => entry.endsWith('.catala_fr') && path.join(directory, entry) !== file))) return [];
  let etapes = {};
  try { etapes = JSON.parse(fs.readFileSync(path.join(directory, '..', '..', 'etapes.json'), 'utf8')); } catch {}
  const expected = Object.entries(etapes.raisonnements ?? {}).filter(([, suite]) => !suite?.remplacePar).map(([name]) => name);
  if (!expected.length || expected.includes(nom)) return [];
  return [{ line: 1, message: `program name "${nom}" is not a reasoning of the case. Use the exact name given by pm check: ${expected.map((name) => `.piecemaker/catala/${name}/`).join(' or ')}.` }];
}

const REFUSALS = {
  catala: ['the program does not follow the Catala format or does not compile. Nothing was written.', 'Correct only the lines shown, keep the rest of the file, then write again. Start from the model of references/format.md (catala skill), which compiles; its table "Fautes fréquentes" gives the fix of common errors.'],
  suivi: ['the tracking file does not have the expected structure. Nothing was written.', 'Correct these lines, then write the file again. Full model: piecemaker skill, references/suivi.md.'],
  memoire: ['the project memory does not have the expected structure. Nothing was written.', 'Correct the memory, then write it again: plain Markdown, no frontmatter.'],
};
const FORMATS = {
  suivi: async (file, content) => suiviErrors(content),
  memoire: async (file, content) => memoireErrors(content),
  catala: async (file, content) => [
    ...programNameErrors(file, content),
    ...(file.endsWith('.catala_fr') ? (await import('../../../skills/Skill-PieceMaker/scripts/catala-documentation.mjs')).catalaDocumentation(content, { test: /^test_/.test(path.basename(file)) }).errors : []),
    ...(await (await import('../../../skills/Skill-PieceMaker/scripts/catala.mjs')).typecheckErrors(path.dirname(file), file, content)).map((error) => ({ line: error.line, where: error.file === path.basename(file) ? undefined : `${error.file}:${error.line}`, message: `compilation: ${error.message}` })),
  ],
};

const current = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

function replaced(content, oldText, newText, all) {
  if (typeof content !== 'string' || !oldText || !content.includes(oldText)) return null;
  return all ? content.split(oldText).join(newText) : content.replace(oldText, () => newText);
}

function patched(content, hunks) {
  let lines = content.split('\n');
  for (const hunk of hunks) {
    const before = hunk.filter((line) => !line.startsWith('+')).map((line) => line.slice(1));
    const after = hunk.filter((line) => !line.startsWith('-')).map((line) => line.slice(1));
    const at = lines.findIndex((_, index) => before.every((line, offset) => lines[index + offset] === line));
    if (!before.length || at < 0) return null;
    lines = [...lines.slice(0, at), ...after, ...lines.slice(at + before.length)];
  }
  return lines.join('\n');
}

export function writtenTexts(tool, input = {}, cwd = process.cwd()) {
  const target = input.file_path || input.notebook_path || input.path;
  const file = target ? path.resolve(cwd, String(target)) : '';
  if (tool === 'Write') return file ? [{ file, after: String(input.content ?? input.contents ?? '') }] : [];
  if (tool === 'Edit') return file ? [{ file, after: replaced(current(file), input.old_string, String(input.new_string ?? ''), input.replace_all === true) }] : [];
  if (tool === 'MultiEdit') return file ? [{ file, after: (input.edits ?? []).reduce((content, edit) => replaced(content, edit?.old_string, String(edit?.new_string ?? ''), edit?.replace_all === true), current(file)) }] : [];
  if (tool === 'NotebookEdit') return file ? [{ file, after: null }] : [];
  if (tool !== 'apply_patch') return [];
  const patch = String(Array.isArray(input.command) ? input.command.join(' ') : input.command || input.patch || input.input || '');
  const sections = [];
  for (const line of patch.split(/\r?\n/)) {
    const section = line.match(PATCH_SECTION);
    if (section) sections.push({ kind: section[1], file: path.resolve(cwd, section[2].trim()), hunks: [], added: [] });
    else if (!sections.length || line.startsWith('***')) continue;
    else if (line.startsWith('@@')) sections.at(-1).hunks.push([]);
    else {
      const entry = sections.at(-1);
      if (line.startsWith('+')) entry.added.push(line.slice(1));
      if (!entry.hunks.length) entry.hunks.push([]);
      entry.hunks.at(-1).push(/^[ +-]/.test(line) ? line : ` ${line}`);
    }
  }
  return sections.map(({ kind, file, hunks, added }) => ({
    file,
    after: kind === 'Add' ? added.join('\n') : kind === 'Update' ? patched(current(file), hunks.filter((hunk) => hunk.length)) : null,
  }));
}

export async function formatErrors(tool, input, cwd) {
  const refused = new Map();
  for (const { file, after } of writtenTexts(tool, input, cwd)) {
    const found = featureOf(file.normalize('NFC'));
    const check = FORMATS[found?.feature.format];
    if (!check || typeof after !== 'string') continue;
    const errors = await check(file, after);
    if (!errors.length) continue;
    const known = new Map();
    for (const error of await check(file, current(file))) known.set(error.message, (known.get(error.message) ?? 0) + 1);
    for (const error of errors) {
      if (known.get(error.message)) known.set(error.message, known.get(error.message) - 1);
      else refused.set(found.feature.format, [...(refused.get(found.feature.format) ?? []), `${error.where ?? `${path.basename(file)}:${error.line}`}: ${error.message}${error.where || !after.split('\n')[error.line - 1]?.trim() ? '' : `\n    line ${error.line} is: ${after.split('\n')[error.line - 1].trim().slice(0, 200)}`}`]);
    }
  }
  if (!refused.size) return null;
  return [...refused].map(([format, lines]) => [`Write refused by Le Hérisson: ${REFUSALS[format][0]}`, ...lines.slice(0, 10), ...(lines.length > 10 ? [`… ${lines.length - 10} more error(s).`] : []), REFUSALS[format][1]].join('\n')).join('\n\n');
}
