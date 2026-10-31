import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { Document, isAlias, isMap, isScalar, isSeq, LineCounter, parseDocument, visit } from 'yaml';
import type { Node } from 'yaml';

import { LiteralError } from './format.js';
import { NAME as TERM_NAME } from './names.js';
import { finding } from './rules.js';
import type { Finding, RuleName } from './rules.js';

export class ReasoningSyntaxError extends LiteralError {
  constructor(readonly problems: LiteralError[]) { super(problems[0].message.replace(/^ligne \d+ : /, ''), problems[0].line, problems[0].found); }
}

export const REASONING_DIR = path.join('.piecemaker', 'raisonnements');
const NAME = /^[\p{Ll}\p{N}][\p{Ll}\p{N}-]*$/u;
const NAMED_KEY = /^$|(?:^|\.)(?:valeurs|faits|attendu|evenements|echeances)$|\.(?:si|sauf|l_une)\[\d+\]$/u;
const NAME_SHAPE = 'minuscules, chiffres et tirets, d’après le sujet (ex. indemnite-de-depart)';

const exists = (file: string) => stat(file).then(() => true, (error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return false;
  throw error;
});

export async function listReasoningFiles(cwd: string): Promise<string[]> {
  const entries = await readdir(path.join(cwd, REASONING_DIR), { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.yaml')).map((entry) => entry.name.slice(0, -'.yaml'.length)).filter((name) => NAME.test(name)).sort();
}

export async function resolveReasoningFile(cwd: string, name?: string): Promise<{ file: string; name: string } | null> {
  for (const legacy of ['raisonnement.yaml', 'raisonnement.js']) {
    if (await exists(path.join(cwd, '.piecemaker', legacy))) throw new TypeError(`Fichier .piecemaker/${legacy} non lu. ${legacy.endsWith('.js') ? 'Transcrivez' : 'Déplacez'} le fichier vers .piecemaker/raisonnements/<nom>.yaml.`);
  }
  if (name !== undefined) {
    if (!NAME.test(name)) throw new TypeError(`Nom de raisonnement ${name} mal écrit. Respectez le format indiqué : ${NAME_SHAPE}.`);
    return { file: path.join(cwd, REASONING_DIR, `${name}.yaml`), name };
  }
  const names = await listReasoningFiles(cwd);
  if (names.length > 1) throw new TypeError(`Plusieurs raisonnements trouvés : ${names.join(', ')}. Indiquez lequel avec --raisonnement.`);
  return names.length ? { file: path.join(cwd, REASONING_DIR, `${names[0]}.yaml`), name: names[0] } : null;
}

const LINE = /^(\s*(?:- +)?)([^\s"'#:-][^:]*?):(?: +(.*?))?\s*$/u;
const quoteRule = (value: string): RuleName | null => {
  if (/^["']/.test(value)) return value.length > 1 && value.endsWith(value[0]) ? null : 'guillemet-initial-non-protege';
  if (/:(\s|$)/.test(value)) return 'deux-points-non-proteges';
  if (/\s#/.test(value)) return 'diese-non-protege';
  if (/^[`@%&*!|>?,]/.test(value) || /^-(?!\d)/.test(value)) return 'caractere-initial-non-protege';
  if (/^[[{]/.test(value) && !/[\]}]$/.test(value)) return 'crochet-non-ferme';
  return null;
};
const ITEM = /^\s*- +(.*\S)\s*$/u;
const quoting = (source: string): Finding | null => {
  const match = LINE.exec(source);
  const item = match ? null : ITEM.exec(source);
  const value = match?.[3] ?? item?.[1];
  const regle = value ? quoteRule(value) : null;
  return value && regle ? finding(regle, { c: value[0], ecriture: `${match ? `${match[2]}: ` : '- '}${JSON.stringify(value)}` }) : null;
};
const unquotedColon = (source: string) => {
  const value = source.trim().replace(/^- +/u, '');
  return finding('deux-points-non-proteges', { ecriture: `${/^\s*- /u.test(source) ? '- ' : ''}${JSON.stringify(value)}` });
};
const fault = (found: Finding, line: number) => new LiteralError(found.text, line, found);
const indent = (source: string) => source.length - source.trimStart().length;
const blank = (source: string) => !source.trim() || source.trimStart().startsWith('#');
const columns = (rows: string[], line: number) => {
  const open = new Map<number, number>();
  let floor = Infinity;
  for (let index = line - 2; index >= 0 && floor > 0; index -= 1) {
    const source = rows[index];
    if (blank(source)) continue;
    const start = indent(source);
    const item = /^\s*- +/.exec(source);
    if (floor === Infinity) {
      open.set(start, index + 1);
      if (item) open.set(item[0].length, index + 1);
      if (/:\s*$/.test(source)) open.set((item ? item[0].length : start) + 2, index + 1);
    } else if (start < floor) {
      if (!open.has(start)) open.set(start, index + 1);
      if (item && !open.has(item[0].length)) open.set(item[0].length, index + 1);
    } else continue;
    floor = start;
  }
  if (!open.has(0)) open.set(0, 1);
  return open;
};
const misaligned = (rows: string[], line: number) => {
  const source = rows[line - 1];
  if (source === undefined || blank(source)) return null;
  const start = indent(source);
  const open = columns(rows, line);
  if (open.has(start)) return null;
  const [best, from] = [...open].sort(([left], [right]) => Math.abs(left - start) - Math.abs(right - start) || right - left)[0];
  return fault(finding('indentation-decalee', { n: best, m: from }), line);
};

const diagnose = (rows: string[], code: string, line: number, message: string): LiteralError => {
  const source = rows[line - 1] ?? '';
  if (code === 'TAB_AS_INDENT') return fault(finding('tabulation-utilisee'), line);
  if (code === 'DUPLICATE_KEY') return fault(finding('cle-dupliquee', { cle: LINE.exec(source)?.[2] ?? source.trim() }), line);
  if (/Missing closing/.test(message)) {
    for (let index = line; index >= 1; index -= 1) if ((rows[index - 1].match(/"/g) ?? []).length % 2 === 1) return fault(finding('guillemet-non-ferme'), index);
  }
  const quoted = quoting(source);
  if (quoted) return fault(quoted, line);
  const shifted = misaligned(rows, line) ?? misaligned(rows, line + 1);
  if (shifted) return shifted;
  if (['BAD_INDENT', 'BLOCK_AS_IMPLICIT_KEY', 'MULTILINE_IMPLICIT_KEY', 'MISSING_CHAR', 'UNEXPECTED_TOKEN'].includes(code)) return fault(finding('structure-non-reconnue'), line);
  return fault(finding('yaml-non-lu', { detail: message.replace(/ at line \d+, column \d+:?\s*$/u, '') }), line);
};

export function parseReasoningDocument(text: string) {
  const rows = text.split('\n');
  const lineCounter = new LineCounter();
  const document = parseDocument(text, { version: '1.2', schema: 'core', uniqueKeys: true, lineCounter });
  const problems: LiteralError[] = [];
  const report = (problem: LiteralError) => { if (!problems.some((other) => other.line === problem.line)) problems.push(problem); };
  const fail = () => { throw new ReasoningSyntaxError(problems.sort((left, right) => left.line - right.line)); };
  for (const issue of [...document.errors, ...document.warnings]) report(diagnose(rows, issue.code, lineCounter.linePos(issue.pos[0]).line, issue.message.replace(/\n[\s\S]*/, '')));
  if (problems.length) fail();
  const commented = (line: number) => fault(quoting(rows[line - 1] ?? '') ?? finding('commentaire-non-admis'), line);
  const hashLine = (from: number, step: 1 | -1) => { for (let index = from; index >= 1 && index <= rows.length; index += step) if (rows[index - 1].includes('#')) return index; return from; };
  if (document.commentBefore) report(commented(hashLine(1, 1)));
  if (document.comment) report(commented(hashLine(rows.length, -1)));
  const lines = new Map<string, number>();
  const lineOf = (node: unknown, fallback: number) => { const range = (node as { range?: [number, number, number] } | null)?.range; return range ? lineCounter.linePos(range[0]).line : fallback; };
  const convert = (node: Node | null | undefined, at: string): unknown => {
    const line = lineOf(node, lines.get(at) ?? 1);
    lines.set(at, line);
    if (!node) return null;
    if (node.commentBefore) report(commented(hashLine(line, -1)));
    if (node.comment) report(commented(hashLine(line, 1)));
    if (isAlias(node) || node.anchor || node.tag) { report(fault(quoting(rows[line - 1] ?? '') ?? finding('ancre-non-admise'), line)); return null; }
    if (isMap(node)) {
      const entries = node.items.flatMap((pair) => {
        const keyLine = lineOf(pair.key, line);
        const booleanKey = isScalar(pair.key) && typeof pair.key.value === 'boolean';
        if (!isScalar(pair.key) || (typeof pair.key.value !== 'string' && !booleanKey)) { report(fault(finding('cle-non-textuelle'), keyLine)); return []; }
        if (pair.key.commentBefore) report(commented(hashLine(keyLine, -1)));
        if (pair.key.comment) report(commented(hashLine(keyLine, 1)));
        const key = String(pair.key.value);
        if (/\s/u.test(key) && !(NAMED_KEY.test(at) && TERM_NAME.test(key))) { report(fault(unquotedColon(rows[keyLine - 1] ?? key), keyLine)); return []; }
        const route = at ? `${at}.${key}` : key;
        const value = convert(pair.value as Node | null, route);
        lines.set(route, keyLine);
        return [[key, value] as const];
      });
      return Object.fromEntries(entries);
    }
    if (isSeq(node)) return node.items.map((item, index) => convert(item as Node | null, `${at}[${index}]`));
    if (isScalar(node) && (node.value === null || ['string', 'boolean', 'number'].includes(typeof node.value))) {
      if (typeof node.value === 'number' && !Number.isFinite(node.value)) report(fault(finding('nombre-non-fini'), line));
      return node.value;
    }
    report(fault(finding('type-non-admis'), line));
    return null;
  };
  const value = convert(document.contents, '');
  if (problems.length) fail();
  return { value, lines };
}

export function printReasoningDocument(value: unknown): string {
  const document = new Document(value, { schema: 'core', version: '1.2', aliasDuplicateObjects: false });
  visit(document, { Pair(_, pair) { if (isScalar(pair.key) && (pair.key.value === 'true' || pair.key.value === 'false')) pair.key = document.createNode(pair.key.value === 'true'); } });
  return document.toString({ lineWidth: 0, blockQuote: 'literal' }).trimEnd();
}
