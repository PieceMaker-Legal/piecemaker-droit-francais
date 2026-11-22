#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { agentView, languageOf, rewrite } from './lu.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PAGE = 'docs/carte-outils.html';
export const MANIFEST = 'scripts/carte-outils/instructions.json';
const HOOKS = 'server/piecemaker/vendor/piecemaker-plugin/hooks/hooks.json';
const QUOTES = ['"""', "'''", '`', '"', "'"];

const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

function escaped(text, pos) {
  let n = 0;
  while (pos - 1 - n >= 0 && text[pos - 1 - n] === '\\') n++;
  return n % 2 === 1;
}

const multiline = (quote) => quote === '`' || quote.length === 3;

function closingQuote(text, from, quote) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\n' && !multiline(quote)) return -1;
    if (quote === '`' && text.startsWith('${', i) && !escaped(text, i)) {
      i = interpolationEnd(text, i + 2);
      if (i < 0) return -1;
      continue;
    }
    if (text.startsWith(quote, i) && !escaped(text, i)) return i;
  }
  return -1;
}

function interpolationEnd(text, from) {
  let depth = 1;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '`' || ch === '"' || ch === "'") {
      i = closingQuote(text, i + 1, ch);
      if (i < 0) return -1;
    } else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

function openingQuote(text, before, quote) {
  for (let i = before - 1; i >= 0; i--) {
    if (text[i] === '\n' && !multiline(quote)) return -1;
    if (text.startsWith(quote, i) && !escaped(text, i)) return i;
  }
  return -1;
}

function skipSpace(text, i) {
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith('//', i)) i = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i);
    else if (text.startsWith('/*', i)) i = text.indexOf('*/', i) + 2;
    else return i;
  }
}

function literalAt(text, i) {
  const quote = QUOTES.find((q) => text.startsWith(q, i));
  if (!quote) return null;
  const close = closingQuote(text, i + quote.length, quote);
  if (close < 0) return null;
  return { quote, open: i, start: i + quote.length, end: close, after: close + quote.length };
}

function occurrences(text, needle) {
  const found = [];
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) found.push(i);
  return found;
}

export function locate(text, entry) {
  const { guillemet: quote, ancre: anchor = '', rang } = entry;
  if (quote === 'fichier') return { kind: 'fichier', segments: [{ start: 0, end: text.length, quote: '' }] };
  if (!anchor) throw new Error('Ancre vide.');
  const hits = occurrences(text, anchor);
  if (!hits.length) throw new Error('Ancre introuvable : le texte a changé dans le code.');
  if (rang === undefined && hits.length > 1) throw new Error(`Ancre ambiguë (${hits.length} occurrences).`);
  const at = hits[rang ?? 0];
  if (at === undefined) throw new Error('Occurrence introuvable.');
  let open = openingQuote(text, at, quote);
  while (open >= 0 && closingQuote(text, open + quote.length, quote) < at + anchor.length) open = openingQuote(text, open, quote);
  const close = open < 0 ? -1 : closingQuote(text, open + quote.length, quote);
  if (open < 0 || close < 0 || close < at + anchor.length) throw new Error(`Littéral ${quote} introuvable autour de l'ancre.`);
  let first = { quote, open, start: open + quote.length, end: close, after: close + quote.length };
  const segments = [first];

  let kind = 'simple';
  for (let prev = literalBefore(text, first.open); prev; prev = literalBefore(text, prev.open)) {
    segments.unshift(prev);
    kind = 'concat';
  }
  first = segments[0];
  let i = skipSpace(text, segments.at(-1).after);
  for (;;) {
    const plus = text[i] === '+';
    const next = literalAt(text, plus ? skipSpace(text, i + 1) : i);
    if (!next || (!plus && !text.slice(segments.at(-1).after, i).includes('\n') && !/\s/.test(text[i - 1]))) break;
    if (!plus && next.quote !== segments.at(-1).quote && next.quote.length !== segments.at(-1).quote.length) break;
    segments.push(next);
    kind = 'concat';
    i = skipSpace(text, next.after);
  }
  if (kind === 'simple' && text[i] === ',') {
    const before = text[backSpace(text, open - 1)];
    if (before === '[' || before === ',') {
      const items = [first];
      let j = i;
      while (text[j] === ',') {
        const next = literalAt(text, skipSpace(text, j + 1));
        if (!next) break;
        items.push(next);
        j = skipSpace(text, next.after);
      }
      if (text[j] === ',') j = skipSpace(text, j + 1);
      if (items.length > 1 && text[j] === ']' && /^\s*\.join\(/.test(text.slice(j + 1, j + 40))) {
        segments.splice(0, 1, ...items);
        kind = 'tableau';
      }
    }
  }
  return { kind, segments };
}

function literalBefore(text, open) {
  let i = backSpace(text, open - 1);
  const plus = text[i] === '+';
  if (plus) i = backSpace(text, i - 1);
  else if (!/\s/.test(text[open - 1] || '')) return null;
  const quote = QUOTES.find((q) => text.startsWith(q, i - q.length + 1) && !escaped(text, i - q.length + 1));
  if (!quote) return null;
  const end = i - quote.length + 1;
  const start = openingQuote(text, end, quote);
  if (start < 0) return null;
  const before = text[backSpace(text, start - 1 - (/[frbuFRBU]/.test(text[start - 1]) ? 1 : 0))];
  if (!plus && !['(', '=', ':', ',', '"', "'", '`', '['].includes(before) && !QUOTES.some((q) => q.endsWith(before))) return null;
  return { quote, open: start, start: start + quote.length, end, after: end + quote.length };
}

function backSpace(text, i) {
  while (i > 0 && /\s/.test(text[i])) i--;
  return i;
}

const lineOf = (text, pos) => text.slice(0, pos).split('\n').length;

export function readInstruction(text, file, entry) {
  const found = locate(text, entry);
  const lang = languageOf(file);
  return { ...found, lang, view: agentView(text, found, lang) };
}

export function loadManifest(root = ROOT) {
  return JSON.parse(read(root, MANIFEST));
}

function hookTriggers(text) {
  const hooks = JSON.parse(text).hooks;
  const seen = {};
  const triggers = [];
  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks || []) {
        const script = /scripts\/([\w-]+)\.mjs/.exec(hook.command || '')?.[1];
        if (!script) continue;
        const node = script === 'herisson' ? (event === 'Stop' ? 'stop:herisson' : 'herisson') : `hook:${script}`;
        const entry = { id: `declencheur:${event}:${script}:${triggers.length}`, de: `evt:${event}`, vers: node, titre: `Déclencheur ${event}`, quand: group.matcher ? `Le hook part sur ${event} quand le nom de l’outil correspond à ce motif. Ce motif n’est pas lu par l’agent.` : `Le hook part sur ${event} à chaque fois.` };
        if (group.matcher !== undefined) {
          const needle = `"matcher": ${JSON.stringify(group.matcher)}`;
          const rang = (seen[needle] = (seen[needle] ?? -1) + 1);
          const at = occurrences(text, needle)[rang];
          const raw = JSON.stringify(group.matcher).slice(1, -1);
          Object.assign(entry, { fichier: HOOKS, guillemet: '"', ancre: raw, rang: occurrences(text, raw).findIndex((i) => i > at), titre: `Déclencheur ${event} (matcher)` });
        }
        triggers.push(entry);
      }
    }
  }
  return triggers;
}

function entries(root, rev) {
  const manifest = rev ? JSON.parse(showFile(root, rev, MANIFEST) || '{"instructions":[]}') : loadManifest(root);
  const hooksText = rev ? showFile(root, rev, HOOKS) : read(root, HOOKS);
  return [...(hooksText ? hookTriggers(hooksText) : []), ...manifest.instructions];
}

function showFile(root, rev, file) {
  try {
    return execFileSync('git', ['show', `${rev}:${file}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

function committedTexts(root) {
  const files = new Map();
  const result = new Map();
  const current = new Map(entries(root).map((e) => [e.id, e]));
  const headEntries = new Map(entries(root, 'HEAD').map((e) => [e.id, e]));
  for (const id of new Set([...headEntries.keys(), ...current.keys()])) {
    const candidates = [headEntries.get(id), current.get(id)].filter((e) => e?.fichier);
    for (const entry of candidates) {
      if (!files.has(entry.fichier)) files.set(entry.fichier, showFile(root, 'HEAD', entry.fichier));
      const text = files.get(entry.fichier);
      if (text === null) continue;
      try {
        result.set(id, { entry, lu: readInstruction(text, entry.fichier, entry).view.lu });
        break;
      } catch {}
    }
  }
  return result;
}

function codeExcerpt(text, found) {
  const lines = text.split('\n');
  const first = Math.max(1, lineOf(text, found.segments[0].open) - 1);
  const last = Math.min(lines.length, lineOf(text, found.segments.at(-1).end) + 1);
  const shown = Math.min(last, first + 40);
  return { debut: first, lignes: lines.slice(first - 1, shown), coupe: shown < last };
}

export function buildGraph(root = ROOT, { live = false } = {}) {
  const manifest = loadManifest(root);
  const nodes = new Map(manifest.noeuds.map((n) => [n.id, { ...n }]));
  const files = new Map();
  const source = (file) => {
    if (!files.has(file)) files.set(file, fs.existsSync(path.join(root, file)) ? read(root, file) : null);
    return files.get(file);
  };
  const committed = committedTexts(root);
  const items = {};
  const edges = new Map();
  const edgeOf = (from, to) => {
    for (const id of [from, to]) if (!nodes.has(id)) nodes.set(id, { id, label: id.replace(/^[a-z-]+:/, ''), type: id.split(':')[0] || 'autre' });
    const key = `${from}→${to}`;
    if (!edges.has(key)) edges.set(key, { id: key, from, to, items: [] });
    return edges.get(key);
  };
  for (const entry of entries(root)) {
    const item = { id: entry.id, titre: entry.titre, quand: entry.quand, fichier: entry.fichier };
    if (entry.fichier) {
      const text = source(entry.fichier);
      try {
        if (text === null) throw new Error('Fichier absent.');
        const found = readInstruction(text, entry.fichier, entry);
        const before = committed.get(entry.id)?.lu;
        Object.assign(item, {
          lu: found.view.lu,
          parts: found.view.parts,
          morceaux: found.segments.length,
          ligne: lineOf(text, found.segments[0].start),
          fin: lineOf(text, found.segments.at(-1).end),
          lecture: entry.id.startsWith('declencheur:') ? 'config' : 'agent',
          code: codeExcerpt(text, found),
        });
        if (before !== undefined && before !== found.view.lu) Object.assign(item, { modifie: true, luCommit: before });
      } catch (error) {
        item.erreur = error.message;
      }
    }
    items[item.id] = item;
    edgeOf(entry.de, entry.vers).items.push(item.id);
  }
  for (const link of manifest.liens || []) edgeOf(link.de, link.vers).note = link.note;
  return {
    generatedAt: new Date().toISOString(),
    commit: gitSafe(root, ['rev-parse', '--short', 'HEAD']),
    ...(live ? { status: statusOf(root, items) } : {}),
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    items,
  };
}

function findEntry(root, id) {
  const manifest = loadManifest(root);
  return { entry: entries(root).find((e) => e.id === id), manifest };
}

function validateContent(root, file, content) {
  const ext = path.extname(file);
  if (ext === '.json') return JSON.parse(content);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carte-outils-'));
  const tmp = path.join(dir, `verif${ext}`);
  fs.writeFileSync(tmp, content);
  try {
    if (['.mjs', '.js', '.cjs'].includes(ext)) execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    if (ext === '.py') {
      try {
        execFileSync('python3', ['-c', 'import ast,sys;ast.parse(open(sys.argv[1],encoding="utf-8").read())', tmp], { stdio: 'pipe' });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    if (ext === '.ts' || ext === '.tsx') {
      try {
        execFileSync(process.execPath, ['-e', `const ts=require('typescript');const r=ts.transpileModule(require('fs').readFileSync(process.argv[1],'utf8'),{reportDiagnostics:true,fileName:process.argv[1]});if(r.diagnostics.length){console.error(r.diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\\n')).join('\\n'));process.exit(1)}`, tmp], { cwd: root, stdio: 'pipe' });
      } catch (error) {
        if (!/Cannot find module 'typescript'/.test(String(error.stderr))) throw error;
      }
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return null;
}

export function anchorFor(text, entry, open) {
  const start = open + entry.guillemet.length;
  const content = text.slice(start, closingQuote(text, start, entry.guillemet));
  let len = Math.min(content.length, 50);
  while (len < content.length && (content[len - 1] === '\\' || occurrences(text, content.slice(0, len)).length > 1)) len++;
  if (!len) throw new Error('Texte vide : impossible de le retrouver ensuite.');
  const anchor = content.slice(0, len);
  const hits = occurrences(text, anchor);
  return hits.length > 1 ? { ancre: anchor, rang: hits.indexOf(start) } : { ancre: anchor };
}

export function applyEdit(root, id, lu, expected) {
  const { entry, manifest } = findEntry(root, id);
  if (!entry || !entry.fichier) throw new Error('Instruction introuvable ou non modifiable.');
  const abs = path.join(root, entry.fichier);
  const original = fs.readFileSync(abs, 'utf8');
  const current = readInstruction(original, entry.fichier, entry);
  if (typeof expected === 'string' && expected !== current.view.lu) throw new Error('Le code a changé depuis l’affichage. Rechargez la carte.');
  if (lu === current.view.lu) return { file: entry.fichier, unchanged: true };
  const updated = rewrite(original, current, lu, current.lang);
  try {
    validateContent(root, entry.fichier, updated);
  } catch (error) {
    const detail = String(error.stderr || error.message).split('\n').slice(0, 6).join('\n');
    throw new Error(`Modification refusée, le fichier ne se validerait plus :\n${detail}`);
  }
  let next = entry;
  if (entry.guillemet !== 'fichier' && !id.startsWith('declencheur:')) {
    const { ancre, rang } = anchorFor(updated, entry, current.segments[0].open);
    next = { ...entry, ancre };
    delete next.rang;
    if (rang !== undefined) next.rang = rang;
  }
  const check = readInstruction(updated, entry.fichier, next).view.lu;
  if (check !== lu) throw new Error('Modification refusée : le texte relu après écriture ne correspond pas.');
  fs.writeFileSync(abs, updated);
  if (next !== entry) {
    manifest.instructions[manifest.instructions.findIndex((e) => e.id === id)] = next;
    fs.writeFileSync(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return { file: entry.fichier };
}

function git(root, args, env) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env }).trim();
}

function gitSafe(root, args) {
  try {
    return git(root, args);
  } catch {
    return null;
  }
}

function statusOf(root, items) {
  const modified = Object.values(items).filter((i) => i.modifie).map((i) => i.id);
  return { branch: gitSafe(root, ['rev-parse', '--abbrev-ref', 'HEAD']), modifiees: modified };
}

export function status(root = ROOT) {
  return buildGraph(root, { live: true }).status;
}

export function commitChanges(root, message) {
  const graph = buildGraph(root);
  const modified = Object.values(graph.items).filter((i) => i.modifie);
  if (!modified.length) return { committed: false, reason: 'Aucune instruction modifiée à commiter.' };
  const committed = committedTexts(root);
  const byFile = new Map();
  for (const item of modified) {
    const base = committed.get(item.id);
    if (!byFile.has(item.fichier)) byFile.set(item.fichier, showFile(root, 'HEAD', item.fichier));
    const text = byFile.get(item.fichier);
    const found = readInstruction(text, item.fichier, base.entry);
    byFile.set(item.fichier, rewrite(text, found, item.lu, found.lang));
  }
  const blobs = new Map();
  for (const [file, content] of byFile) {
    validateContent(root, file, content);
    blobs.set(file, hashText(root, file, content));
  }
  const manifestNow = read(root, MANIFEST);
  if (manifestNow !== showFile(root, 'HEAD', MANIFEST)) blobs.set(MANIFEST, hashText(root, MANIFEST, manifestNow));
  const index = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'carte-outils-index-')), 'index');
  const env = { GIT_INDEX_FILE: index };
  try {
    git(root, ['read-tree', 'HEAD'], env);
    for (const [file, blob] of blobs) git(root, ['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], env);
    const tree = git(root, ['write-tree'], env);
    const parent = git(root, ['rev-parse', 'HEAD']);
    const subject = (message || '').trim() || `chore(carte-outils): modifier ${modified.length} instruction(s)`;
    const commit = git(root, ['commit-tree', tree, '-p', parent, '-m', subject]);
    git(root, ['update-ref', '-m', `carte-outils: ${subject}`, 'HEAD', commit, parent]);
    for (const [file, blob] of blobs) {
      const staged = gitSafe(root, ['rev-parse', `:${file}`]);
      const before = gitSafe(root, ['rev-parse', `${parent}:${file}`]);
      if (staged === before) git(root, ['update-index', '--cacheinfo', `100644,${blob},${file}`]);
    }
    return { committed: true, instructions: modified.map((i) => i.titre || i.id), files: [...blobs.keys()], subject, commit: commit.slice(0, 7) };
  } finally {
    fs.rmSync(path.dirname(index), { recursive: true, force: true });
  }
}

function hashText(root, file, content) {
  return execFileSync('git', ['hash-object', '-w', '--stdin', `--path=${file}`], { cwd: root, input: content, encoding: 'utf8' }).trim();
}

export function embedSnapshot(root = ROOT) {
  const page = path.join(root, PAGE);
  const json = JSON.stringify(buildGraph(root)).replace(/</g, '\\u003c');
  const html = fs.readFileSync(page, 'utf8').replace(
    /(<script id="snapshot" type="application\/json">)[\s\S]*?(<\/script>)/,
    (_, open, close) => `${open}${json}${close}`,
  );
  fs.writeFileSync(page, html);
  return page;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--embed')) {
    console.log(`Instantané écrit dans ${embedSnapshot()}`);
  } else {
    const graph = buildGraph();
    const items = Object.values(graph.items);
    const broken = items.filter((i) => i.erreur);
    console.log(`${graph.nodes.length} nœuds, ${graph.edges.length} arêtes, ${items.length} instructions, ${broken.length} en erreur`);
    for (const b of broken) console.log(`  ✗ ${b.id} (${b.fichier}) : ${b.erreur}`);
    process.exitCode = broken.length ? 1 : 0;
  }
}
