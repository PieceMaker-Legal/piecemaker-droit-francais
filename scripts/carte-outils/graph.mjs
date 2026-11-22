#!/usr/bin/env node
// Carte des outils : lit en direct dans le code chaque instruction interne
// envoyée à l'agent (MCP, hooks, hérisson, injections de contexte, stop turn)
// et la relie aux deux fonctionnalités qu'elle connecte.
//
// Le relevé est dans instructions.json : pour chaque instruction, le fichier,
// le délimiteur du littéral et une ancre (texte copié du littéral). Le texte
// affiché est toujours relu dans le fichier source, jamais copié dans le relevé.
// Une instruction peut tenir sur plusieurs lignes (template literal, chaîne
// concaténée par +, tableau joint par .join) : chaque morceau est une ligne de
// l'éditeur. Les déclencheurs des hooks sont lus dans hooks.json.
//
// Usage :
//   node scripts/carte-outils/graph.mjs           # bilan et ancres cassées
//   node scripts/carte-outils/graph.mjs --embed   # instantané dans docs/carte-outils.html
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PAGE = 'docs/carte-outils.html';
export const MANIFEST = 'scripts/carte-outils/instructions.json';
const HOOKS = 'server/piecemaker/vendor/piecemaker-plugin/hooks/hooks.json';
const QUOTES = ['"""', "'''", '`', '"', "'"];

const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

// --- Repérage d'un littéral dans le code -------------------------------------

function escaped(text, pos) {
  let n = 0;
  while (pos - 1 - n >= 0 && text[pos - 1 - n] === '\\') n++;
  return n % 2 === 1;
}

const multiline = (quote) => quote === '`' || quote.length === 3;

// Fin (position du délimiteur fermant) d'un littéral qui commence après `from`.
function closingQuote(text, from, quote) {
  for (let i = from; i < text.length; i++) {
    if (text[i] === '\n' && !multiline(quote)) return -1;
    if (text.startsWith(quote, i) && !escaped(text, i)) return i;
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

// Littéral qui commence exactement en i, s'il y en a un.
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

// Renvoie les morceaux (segments) d'une instruction, dans l'ordre du code.
export function locate(text, entry) {
  const { guillemet: quote, ancre: anchor = '', rang } = entry;
  if (quote === 'fichier') return { kind: 'fichier', segments: [{ start: 0, end: text.length, quote: '' }] };
  if (!anchor) throw new Error('Ancre vide.');
  const hits = occurrences(text, anchor);
  if (!hits.length) throw new Error('Ancre introuvable : le texte a changé dans le code.');
  if (rang === undefined && hits.length > 1) throw new Error(`Ancre ambiguë (${hits.length} occurrences).`);
  const at = hits[rang ?? 0];
  if (at === undefined) throw new Error('Occurrence introuvable.');
  const open = openingQuote(text, at, quote);
  const close = closingQuote(text, at, quote);
  if (open < 0 || close < 0 || close < at + anchor.length) throw new Error(`Littéral ${quote} introuvable autour de l'ancre.`);
  let first = { quote, open, start: open + quote.length, end: close, after: close + quote.length };
  const segments = [first];

  // Concaténation : 'a' + 'b' + … (JS) ou "a" "b" adjacents (Python), dans les deux sens.
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
  // Tableau joint : ['a', 'b'].join(' ')
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

// Littéral qui précède `open` dans une concaténation (+ ou adjacence), s'il y en a un.
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
  // Préfixe Python (f, r, b) ou appel/opérateur : on n'accepte qu'un littéral précédé d'un séparateur.
  const before = text[backSpace(text, start - 1 - (/[frbuFRBU]/.test(text[start - 1]) ? 1 : 0))];
  if (!plus && !['(', '=', ':', ',', '"', "'", '`', '['].includes(before) && !QUOTES.some((q) => q.endsWith(before))) return null;
  return { quote, open: start, start: start + quote.length, end, after: end + quote.length };
}

function backSpace(text, i) {
  while (i > 0 && /\s/.test(text[i])) i--;
  return i;
}

const segmentText = (text, s) => text.slice(s.start, s.end);

export function readInstruction(text, entry) {
  const found = locate(text, entry);
  const parts = found.segments.map((s) => segmentText(text, s));
  return { ...found, parts, text: parts.join('\n') };
}

// Ligne (1-based) d'une position.
const lineOf = (text, pos) => text.slice(0, pos).split('\n').length;

// --- Relevé + hooks.json => graphe --------------------------------------------

export function loadManifest(root = ROOT) {
  return JSON.parse(read(root, MANIFEST));
}

const EVENT_LABELS = {
  PreToolUse: 'Avant un outil (PreToolUse)',
  PostToolUse: 'Après un outil (PostToolUse)',
  SubagentStart: 'Début de sous-agent',
  SubagentStop: 'Fin de sous-agent',
  Stop: 'Fin du tour (Stop)',
  UserPromptSubmit: 'Message de l’avocat',
};

// Déclencheurs : un matcher de hooks.json = une instruction de l'arête événement → script.
function hookTriggers(root) {
  const text = read(root, HOOKS);
  const hooks = JSON.parse(text).hooks;
  const seen = {};
  const triggers = [];
  for (const [event, groups] of Object.entries(hooks)) {
    for (const group of groups) {
      for (const hook of group.hooks || []) {
        const script = /scripts\/([\w-]+)\.mjs/.exec(hook.command || '')?.[1];
        if (!script) continue;
        const node = script === 'herisson' ? (event === 'Stop' ? 'stop:herisson' : 'herisson') : `hook:${script}`;
        const entry = { id: `declencheur:${event}:${script}:${triggers.length}`, from: `evt:${event}`, to: node, titre: `Déclencheur ${event}`, quand: `Le hook part sur ${event}${group.matcher ? ` quand l’outil correspond à ce motif` : ' à chaque fois'}.` };
        if (group.matcher !== undefined) {
          const needle = `"matcher": ${JSON.stringify(group.matcher)}`;
          const rang = (seen[needle] = (seen[needle] ?? -1) + 1);
          Object.assign(entry, { fichier: HOOKS, guillemet: '"', ancre: JSON.stringify(group.matcher).slice(1, -1), rang: occurrencesOfMatcher(text, needle, rang) });
          entry.titre = `Déclencheur ${event} (matcher)`;
        }
        triggers.push(entry);
      }
    }
  }
  return triggers;
}

// Rang de l'ancre (valeur du matcher) correspondant à la n-ième clé "matcher" identique.
function occurrencesOfMatcher(text, needle, n) {
  const at = occurrences(text, needle)[n];
  const value = JSON.parse(needle.slice(needle.indexOf(':') + 1));
  const raw = JSON.stringify(value).slice(1, -1);
  return occurrences(text, raw).findIndex((i) => i > at);
}

export function buildGraph(root = ROOT) {
  const manifest = loadManifest(root);
  const nodes = new Map(manifest.noeuds.map((n) => [n.id, { ...n }]));
  const files = new Map();
  const source = (file) => {
    if (!files.has(file)) files.set(file, fs.existsSync(path.join(root, file)) ? read(root, file) : null);
    return files.get(file);
  };
  const items = {};
  const edges = new Map();
  const ensureNode = (id) => {
    if (!nodes.has(id)) nodes.set(id, { id, label: id.replace(/^[a-z-]+:/, ''), type: id.split(':')[0] || 'autre' });
  };
  const add = (entry, from, to) => {
    ensureNode(from);
    ensureNode(to);
    const key = `${from}→${to}`;
    if (!edges.has(key)) edges.set(key, { id: key, from, to, items: [] });
    const item = { id: entry.id, titre: entry.titre, quand: entry.quand, fichier: entry.fichier, guillemet: entry.guillemet };
    if (entry.fichier) {
      const text = source(entry.fichier);
      try {
        if (text === null) throw new Error('Fichier absent.');
        const found = readInstruction(text, entry);
        Object.assign(item, {
          texte: found.text,
          forme: found.kind,
          morceaux: found.parts.length,
          ligne: lineOf(text, found.segments[0].start),
          fin: lineOf(text, found.segments.at(-1).end),
        });
      } catch (error) {
        item.erreur = error.message;
      }
    }
    items[item.id] = item;
    edges.get(key).items.push(item.id);
  };

  for (const t of hookTriggers(root)) add(t, t.from, t.to);
  for (const entry of manifest.instructions) add(entry, entry.de, entry.vers);
  for (const link of manifest.liens || []) {
    ensureNode(link.de);
    ensureNode(link.vers);
    const key = `${link.de}→${link.vers}`;
    if (!edges.has(key)) edges.set(key, { id: key, from: link.de, to: link.vers, items: [] });
    edges.get(key).note = link.note;
  }

  return {
    generatedAt: new Date().toISOString(),
    commit: gitSafe(root, ['rev-parse', '--short', 'HEAD']),
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    items,
  };
}

// --- Écriture ------------------------------------------------------------------

function escapeFor(quote, value, lang) {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote.length === 3) {
      if (value.startsWith(quote, i)) { out += `\\${ch}`; continue; }
    } else if (ch === quote && !escaped(value, i)) { out += `\\${ch}`; continue; }
    if (ch === '\n' && !multiline(quote)) { out += '\\n'; continue; }
    out += ch;
  }
  if (lang === 'json') out = out.replace(/\t/g, '\\t');
  return out;
}

function findEntry(root, id) {
  if (id.startsWith('declencheur:')) return { entry: hookTriggers(root).find((t) => t.id === id), manifest: null };
  const manifest = loadManifest(root);
  return { entry: manifest.instructions.find((e) => e.id === id), manifest };
}

function validate(root, file) {
  const abs = path.join(root, file);
  const ext = path.extname(file);
  if (ext === '.json') return JSON.parse(fs.readFileSync(abs, 'utf8'));
  if (['.mjs', '.js', '.cjs'].includes(ext)) return execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
  if (ext === '.py') {
    try {
      return execFileSync('python3', ['-c', 'import ast,sys;ast.parse(open(sys.argv[1],encoding="utf-8").read())', abs], { stdio: 'pipe' });
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  if (ext === '.ts' || ext === '.tsx') {
    let ts;
    try {
      ts = execFileSync(process.execPath, ['-e', `const ts=require('typescript');const r=ts.transpileModule(require('fs').readFileSync(process.argv[1],'utf8'),{reportDiagnostics:true,fileName:process.argv[1]});if(r.diagnostics.length){console.error(r.diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\\n')).join('\\n'));process.exit(1)}`, abs], { cwd: root, stdio: 'pipe' });
    } catch (error) {
      if (/Cannot find module 'typescript'/.test(String(error.stderr))) return null;
      throw error;
    }
    return ts;
  }
  return null;
}

export function applyEdit(root, id, newText, expected) {
  const { entry, manifest } = findEntry(root, id);
  if (!entry || !entry.fichier) throw new Error('Instruction introuvable ou non modifiable.');
  const abs = path.join(root, entry.fichier);
  const original = fs.readFileSync(abs, 'utf8');
  const current = readInstruction(original, entry);
  if (typeof expected === 'string' && expected !== current.text) throw new Error('Le code a changé depuis l’affichage. Rechargez la carte.');
  if (newText === current.text) return { file: entry.fichier, unchanged: true };
  const lang = path.extname(entry.fichier) === '.json' ? 'json' : 'code';

  let updated;
  const segs = current.segments;
  if (current.kind === 'fichier') {
    updated = newText;
  } else if (current.kind === 'simple') {
    const s = segs[0];
    updated = original.slice(0, s.start) + escapeFor(s.quote, newText, lang) + original.slice(s.end);
  } else {
    // Un morceau par ligne. Même nombre : on remplace chaque morceau en place.
    const lines = newText.split('\n');
    if (lines.length === segs.length) {
      updated = original;
      for (let k = segs.length - 1; k >= 0; k--) {
        const s = segs[k];
        updated = updated.slice(0, s.start) + escapeFor(s.quote, lines[k], lang) + updated.slice(s.end);
      }
    } else {
      const sep = original.slice(segs[0].after, segs[1].open);
      const q = segs[0].quote;
      const rebuilt = lines.map((l) => q + escapeFor(q, l, lang) + q).join(sep);
      updated = original.slice(0, segs[0].open) + rebuilt + original.slice(segs.at(-1).after);
    }
  }

  fs.writeFileSync(abs, updated);
  let newAnchor = null;
  try {
    validate(root, entry.fichier);
    if (entry.guillemet !== 'fichier' && manifest) {
      newAnchor = pickAnchor(updated, entry, current.segments[0].open);
      if (newAnchor !== entry.ancre) {
        const index = manifest.instructions.findIndex((e) => e.id === id);
        manifest.instructions[index] = { ...entry, ancre: newAnchor };
        if (manifest.instructions[index].rang !== undefined) delete manifest.instructions[index].rang;
        if (occurrences(updated, newAnchor).length > 1) manifest.instructions[index].rang = occurrences(updated, newAnchor).indexOf(occurrences(updated, newAnchor).find((p) => p > current.segments[0].open));
      }
      const check = readInstruction(updated, newAnchor ? { ...entry, ancre: newAnchor, rang: manifest.instructions.find((e) => e.id === id).rang } : entry);
      if (!check) throw new Error('Relecture impossible.');
      fs.writeFileSync(path.join(root, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    }
  } catch (error) {
    fs.writeFileSync(abs, original);
    const detail = String(error.stderr || error.message).split('\n').slice(0, 6).join('\n');
    throw new Error(`Modification annulée, le fichier ne se valide plus :\n${detail}`);
  }
  return { file: entry.fichier, ancre: newAnchor };
}

function pickAnchor(text, entry, open) {
  const quote = entry.guillemet;
  const start = open + quote.length;
  const close = closingQuote(text, start, quote);
  const content = text.slice(start, close);
  let len = Math.min(content.length, 50);
  // Pas de coupure au milieu d'un échappement.
  while (len < content.length && (content[len - 1] === '\\' || occurrences(text, content.slice(0, len)).length > 1)) len++;
  if (len === 0) throw new Error('Texte vide : impossible de le retrouver ensuite.');
  return content.slice(0, len);
}

// --- Git -----------------------------------------------------------------------

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitSafe(root, args) {
  try {
    return git(root, args);
  } catch {
    return null;
  }
}

function trackedFiles(root) {
  const manifest = loadManifest(root);
  return [...new Set([MANIFEST, HOOKS, ...manifest.instructions.map((e) => e.fichier).filter(Boolean)])];
}

export function status(root = ROOT) {
  const files = trackedFiles(root);
  let raw = '';
  try {
    raw = execFileSync('git', ['status', '--porcelain', '-z', '--', ...files], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {}
  const changed = raw.split('\0').filter(Boolean).map((l) => l.slice(3));
  return { branch: gitSafe(root, ['rev-parse', '--abbrev-ref', 'HEAD']), changed };
}

export function diff(root = ROOT) {
  return gitSafe(root, ['diff', '--', ...trackedFiles(root)]) || '';
}

// Commit des seuls fichiers d'instructions modifiés.
export function commitChanges(root, message) {
  const { changed } = status(root);
  if (!changed.length) return { committed: false, reason: 'Aucun changement à commiter.' };
  git(root, ['add', '--', ...changed]);
  const subject = (message || '').trim() || `chore(carte-outils): modifier ${changed.length} fichier(s) d'instructions`;
  git(root, ['commit', '-m', subject, '--', ...changed]);
  return { committed: true, files: changed, subject, commit: git(root, ['rev-parse', '--short', 'HEAD']) };
}

// --- Instantané dans la page publiée -----------------------------------------------

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
