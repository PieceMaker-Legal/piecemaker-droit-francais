const OPEN = '⟦';
const CLOSE = '⟧';

function pythonPrefix(text, open) {
  let i = open - 1;
  let prefix = '';
  while (i >= 0 && /[rRbBfFuU]/.test(text[i]) && prefix.length < 2) prefix = text[i--] + prefix;
  if (i >= 0 && /[\w]/.test(text[i])) return '';
  return prefix.toLowerCase();
}

function matchingBrace(raw, from) {
  let depth = 0;
  for (let i = from; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < raw.length && raw[i] !== ch; i++) if (raw[i] === '\\') i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return i;
  }
  return -1;
}

function decodeEscapes(raw, lang) {
  if (lang === 'json') return JSON.parse(`"${raw}"`);
  return raw.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|N\{[^}]+\}|\r?\n|.)/g, (all, e) => {
    if (e === 'n') return '\n';
    if (e === 't') return '\t';
    if (e === 'r') return '\r';
    if (e === '0') return '\0';
    if (/^\r?\n$/.test(e)) return '';
    if (e[0] === 'u' && e[1] === '{') return String.fromCodePoint(parseInt(e.slice(2, -1), 16));
    if (e[0] === 'u' || e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === 'N') return all;
    return e;
  });
}

export function segmentTokens(source, seg, lang) {
  const raw = source.slice(seg.start, seg.end);
  if (seg.quote === '') return [{ type: 'texte', value: raw }];
  const prefix = lang === 'py' ? pythonPrefix(source, seg.open) : '';
  const fstring = prefix.includes('f');
  const rawString = prefix.includes('r');
  const template = seg.quote === '`';
  const tokens = [];
  let text = '';
  const flush = () => {
    tokens.push({ type: 'texte', value: rawString ? text : decodeEscapes(text, lang) });
    text = '';
  };
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '\\' && !rawString) { text += raw.slice(i, i + 2); i++; continue; }
    if (template && raw.startsWith('${', i)) {
      const end = matchingBrace(raw, i + 1);
      if (end < 0) { text += raw.slice(i); break; }
      flush();
      tokens.push({ type: 'code', raw: raw.slice(i, end + 1), label: raw.slice(i + 2, end).trim() });
      i = end;
      continue;
    }
    if (fstring && raw[i] === '{') {
      if (raw[i + 1] === '{') { text += '{'; i++; continue; }
      const end = matchingBrace(raw, i);
      if (end < 0) { text += raw.slice(i); break; }
      flush();
      tokens.push({ type: 'code', raw: raw.slice(i, end + 1), label: raw.slice(i + 1, end).trim() });
      i = end;
      continue;
    }
    if (fstring && raw[i] === '}' && raw[i + 1] === '}') { text += '}'; i++; continue; }
    text += raw[i];
  }
  flush();
  return tokens.map((t) => (t.type === 'texte' && !rawString && lang !== 'json' ? { ...t } : t));
}

export function joinSeparator(source, found, lang) {
  if (found.kind !== 'tableau') return '';
  const after = source.slice(found.segments.at(-1).after);
  const match = /^\s*,?\s*\]\s*\.join\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)/.exec(after);
  return match ? decodeEscapes(match[2], lang) : '';
}

export function agentView(source, found, lang) {
  const sep = joinSeparator(source, found, lang);
  const segments = found.segments.map((seg) => segmentTokens(source, seg, lang));
  const parts = [];
  segments.forEach((tokens, k) => {
    if (k && sep) parts.push({ type: 'texte', value: sep });
    for (const t of tokens) parts.push(t.type === 'code' ? { type: 'code', label: t.label } : { type: 'texte', value: t.value });
  });
  const merged = [];
  for (const p of parts) {
    const last = merged.at(-1);
    if (p.type === 'texte' && last?.type === 'texte') last.value += p.value;
    else if (p.type === 'texte' && !p.value) continue;
    else merged.push({ ...p });
  }
  const lu = merged.map((p) => (p.type === 'code' ? `${OPEN}${p.label}${CLOSE}` : p.value)).join('');
  return { lu, parts: merged, segments, sep };
}

function encodeText(value, seg, lang, prefix, keepNewlines) {
  if (lang === 'json') return JSON.stringify(value).slice(1, -1);
  if (seg.quote === '') return value;
  const rawString = prefix.includes('r');
  if (rawString) {
    if (value.includes(seg.quote) || (!keepNewlines && value.includes('\n'))) throw new Error('Chaîne brute Python : ce caractère ne peut pas y être écrit.');
    return value;
  }
  let out = value.replace(/\\/g, '\\\\');
  if (seg.quote.length === 3) out = out.split(seg.quote).join(`\\${seg.quote}`);
  else out = out.split(seg.quote).join(`\\${seg.quote}`);
  if (seg.quote === '`') out = out.replace(/\$\{/g, '\\${');
  if (prefix.includes('f')) out = out.replace(/\{/g, '{{').replace(/\}/g, '}}');
  if (!keepNewlines) out = out.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
  return out;
}

function parseEdited(lu, codes) {
  const tokens = [];
  const pool = codes.map((c, slot) => ({ ...c, slot, used: false }));
  const re = new RegExp(`${OPEN}([^${CLOSE}]*)${CLOSE}`, 'g');
  let last = 0;
  for (const m of lu.matchAll(re)) {
    tokens.push({ type: 'texte', value: lu.slice(last, m.index) });
    const code = pool.find((c) => !c.used && c.label === m[1].trim());
    if (!code) throw new Error(`⟦${m[1]}⟧ n’existe pas dans le code : les éléments ⟦…⟧ sont des valeurs insérées par le programme, ne les modifiez pas.`);
    code.used = true;
    tokens.push({ type: 'code', raw: code.raw, label: code.label, slot: code.slot });
    last = m.index + m[0].length;
  }
  tokens.push({ type: 'texte', value: lu.slice(last) });
  const missing = pool.filter((c) => !c.used);
  if (missing.length) throw new Error(`Élément supprimé : ${missing.map((c) => `⟦${c.label}⟧`).join(', ')}. Ces valeurs sont insérées par le programme : gardez-les.`);
  return tokens;
}

const CODE_BASE = 0xe000;

function flatten(tokens) {
  return tokens.map((t) => (t.type === 'code' ? String.fromCharCode(CODE_BASE + t.slot) : t.value)).join('');
}

function unflatten(flat, slots) {
  const tokens = [];
  let text = '';
  for (const ch of flat) {
    const code = ch.charCodeAt(0) - CODE_BASE;
    if (code >= 0 && code < slots.length) {
      tokens.push({ type: 'texte', value: text }, { type: 'code', raw: slots[code].raw, label: slots[code].label, slot: code });
      text = '';
    } else text += ch;
  }
  tokens.push({ type: 'texte', value: text });
  return tokens;
}

function proportional(flat, n, weights) {
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const cuts = [];
  let acc = 0;
  for (let k = 0; k < n - 1; k++) {
    acc += weights[k];
    const target = Math.round((flat.length * acc) / total);
    const after = flat.indexOf(' ', target);
    const before = flat.lastIndexOf(' ', target);
    let at = after >= 0 && (before < 0 || after - target <= target - before) ? after + 1 : before >= 0 ? before + 1 : target;
    at = Math.max(cuts.at(-1) ?? 0, Math.min(at, flat.length));
    cuts.push(at);
  }
  return cuts;
}

export function distribute(tokens, view, slots) {
  const n = view.segments.length;
  if (n === 1) return [tokens];
  const sep = view.sep;
  const oldPieces = view.segments.map((seg) => flatten(seg));
  const oldFlat = oldPieces.join(sep);
  const newFlat = flatten(tokens);
  const bounds = [];
  let pos = 0;
  for (let k = 0; k < n - 1; k++) {
    pos += oldPieces[k].length;
    bounds.push(pos);
    pos += sep.length;
  }
  let prefix = 0;
  while (prefix < oldFlat.length && prefix < newFlat.length && oldFlat[prefix] === newFlat[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldFlat.length - prefix && suffix < newFlat.length - prefix && oldFlat[oldFlat.length - 1 - suffix] === newFlat[newFlat.length - 1 - suffix]) suffix++;
  const delta = newFlat.length - oldFlat.length;
  const mapped = bounds.map((b) => (b <= prefix ? b : b + sep.length >= oldFlat.length - suffix ? b + delta : null));
  const inChange = mapped.filter((b) => b === null).length;
  if (!sep) {
    const changeEnd = newFlat.length - suffix;
    const cuts = mapped.map((b) => (b === null ? changeEnd : b));
    if (inChange) {
      const first = mapped.findIndex((b) => b === null);
      const start = first > 0 ? cuts[first - 1] : 0;
      const stop = mapped.slice(first).find((b) => b !== null) ?? newFlat.length;
      const local = proportional(newFlat.slice(start, stop), inChange + 1, view.segments.slice(first, first + inChange + 1).map((s) => Math.max(1, flatten(s).length)));
      local.forEach((c, i) => (cuts[first + i] = start + c));
    }
    const pieces = [];
    let from = 0;
    for (const c of [...cuts, newFlat.length]) {
      pieces.push(unflatten(newFlat.slice(from, c), slots));
      from = c;
    }
    return pieces;
  }
  const split = newFlat.split(sep);
  if (!inChange && mapped.every((b) => newFlat.slice(b, b + sep.length) === sep)) {
    const pieces = [];
    let from = 0;
    for (const b of mapped) {
      pieces.push(unflatten(newFlat.slice(from, b), slots));
      from = b + sep.length;
    }
    pieces.push(unflatten(newFlat.slice(from), slots));
    return pieces;
  }
  if (split.length === n || sep.includes('\n')) return split.map((p) => unflatten(p, slots));
  if (split.length < n) return split.map((p) => unflatten(p, slots));
  const head = split.slice(0, n - 1);
  head.push(split.slice(n - 1).join(sep));
  return head.map((p) => unflatten(p, slots));
}

export function rewrite(source, found, lu, lang) {
  const view = agentView(source, found, lang);
  const slots = [];
  for (const seg of view.segments) for (const t of seg) if (t.type === 'code') { t.slot = slots.length; slots.push({ raw: t.raw, label: t.label }); }
  const tokens = parseEdited(lu, slots);
  const pieces = distribute(tokens, view, slots);
  const segs = found.segments;
  const encodeSegment = (seg, tokensOf) => {
    const prefix = lang === 'py' ? pythonPrefix(source, seg.open) : '';
    const original = source.slice(seg.start, seg.end);
    const keepNewlines = seg.quote === '' || ((seg.quote === '`' || seg.quote.length === 3) && original.includes('\n'));
    return tokensOf.map((t) => (t.type === 'code' ? t.raw : encodeText(t.value, seg, lang, prefix, keepNewlines))).join('');
  };
  const sameTokens = (a, b) => JSON.stringify(a.filter((t) => t.type === 'code' || t.value).map((t) => (t.type === 'code' ? t.raw : t.value))) === JSON.stringify(b.filter((t) => t.type === 'code' || t.value).map((t) => (t.type === 'code' ? t.raw : t.value)));
  if (pieces.length === segs.length) {
    let updated = source;
    for (let k = segs.length - 1; k >= 0; k--) {
      if (sameTokens(pieces[k], view.segments[k])) continue;
      updated = updated.slice(0, segs[k].start) + encodeSegment(segs[k], pieces[k]) + updated.slice(segs[k].end);
    }
    return updated;
  }
  const q = segs[0].quote;
  const between = source.slice(segs[0].after, segs[1].open);
  const rebuilt = pieces.map((p) => q + encodeSegment(segs[0], p) + q).join(between);
  return source.slice(0, segs[0].open) + rebuilt + source.slice(segs.at(-1).after);
}

export const languageOf = (file) => (file.endsWith('.json') ? 'json' : file.endsWith('.py') ? 'py' : file.endsWith('.md') ? 'md' : 'js');
