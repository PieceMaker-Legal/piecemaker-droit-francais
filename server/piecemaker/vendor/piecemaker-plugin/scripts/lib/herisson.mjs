import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'herisson.json');

export const FEATURES = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).features.map((feature) => ({ ...feature, pattern: new RegExp(feature.cible) }));

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
const FORMATS = {
  catala: async (file, content) => file.endsWith('.catala_fr')
    ? (await import('../../../skills/Skill-PieceMaker/scripts/catala-documentation.mjs')).catalaDocumentation(content, { test: /^test_/.test(path.basename(file)) }).errors
    : [],
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
  const refused = [];
  for (const { file, after } of writtenTexts(tool, input, cwd)) {
    const found = featureOf(file.normalize('NFC'));
    const check = FORMATS[found?.feature.format];
    if (!check || typeof after !== 'string') continue;
    const known = new Map();
    for (const error of await check(file, current(file))) known.set(error.message, (known.get(error.message) ?? 0) + 1);
    for (const error of await check(file, after)) {
      if (known.get(error.message)) known.set(error.message, known.get(error.message) - 1);
      else refused.push(`${path.basename(file)}:${error.line}: ${error.message}`);
    }
  }
  if (!refused.length) return null;
  return ['Écriture refusée par le Hérisson : le programme ne respecte pas le format Catala.', ...refused.slice(0, 10), ...(refused.length > 10 ? [`… ${refused.length - 10} erreur(s) de plus.`] : []), 'Corrigez puis réécrivez. Voir le skill catala (references/format.md).'].join('\n');
}
