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

const PATCH_SECTION = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/;

export function writtenTexts(tool, input = {}, cwd = process.cwd()) {
  const target = input.file_path || input.notebook_path || input.path;
  if (tool === 'Write') return target ? [{ file: path.resolve(cwd, String(target)), text: String(input.content ?? input.contents ?? '') }] : [];
  if (tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const parts = [input.new_string, input.content, input.new_source, ...(Array.isArray(input.edits) ? input.edits.map((edit) => edit?.new_string) : [])];
    return target ? [{ file: path.resolve(cwd, String(target)), text: parts.filter((part) => typeof part === 'string').join('\n') }] : [];
  }
  if (tool !== 'apply_patch') return [];
  const patch = String(Array.isArray(input.command) ? input.command.join(' ') : input.command || input.patch || input.input || '');
  const files = [];
  for (const line of patch.split(/\r?\n/)) {
    const section = line.match(PATCH_SECTION);
    if (section) files.push({ file: path.resolve(cwd, section[1].trim()), text: '' });
    else if (files.length && line.startsWith('+')) files.at(-1).text += `${line.slice(1)}\n`;
  }
  return files;
}

export function forbiddenWrite(found, text) {
  for (const rule of found.feature.interdit ?? []) {
    const pattern = new RegExp(rule.motif, 'mu');
    const lines = String(text).split(/\r?\n/);
    const line = lines.find((candidate) => pattern.test(candidate));
    if (line !== undefined) return `${rule.message}\nLigne refusée : ${line.trim()}`;
  }
  return null;
}
