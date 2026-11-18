const PM_PROGRAMS = new Set(['pm', 'pm.mjs', 'pm.cmd', 'pm.ps1']);
const NODE_PROGRAMS = new Set(['node', 'node.exe']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const HARMLESS_REDIRECTS = [/\d?>&\d/g, /&?\d?>{1,2}\s*\/dev\/null\b/g];

const programName = (word) => String(word ?? '').split(/[\\/]/).pop().toLowerCase();

function isPmOkf(words) {
  const start = words.findIndex((word) => !ASSIGNMENT.test(word));
  if (start < 0) return false;
  const program = NODE_PROGRAMS.has(programName(words[start])) ? words.slice(start + 1) : words.slice(start);
  return PM_PROGRAMS.has(programName(program[0])) && program[1] === 'okf';
}

function split(command) {
  const text = String(command ?? '');
  const segments = [];
  const fresh = () => ({ text: '', words: [], expanded: '', unquoted: '', unsafe: false });
  let segment = fresh();
  let word = null;
  let quote = '';
  let depth = 0;
  const outer = [];
  const endWord = () => {
    if (word !== null) segment.words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (segment.text.trim()) segments.push(segment);
    segment = fresh();
  };
  const endSubstitution = () => {
    endSegment();
    ({ segment, word, quote, depth } = outer.pop());
    segment.text += '$()';
    segment.expanded += '$()';
    if (!quote) segment.unquoted += '$()';
    word = (word ?? '') + '$()';
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (quote === "'") {
      segment.text += char;
      if (char === "'") quote = '';
      else word += char;
      continue;
    }
    if (char === '\\') {
      segment.text += char + (next ?? '');
      index += 1;
      if (next !== '\n' && next !== undefined) word = (word ?? '') + next;
      continue;
    }
    if (char === '$' && next === '(') {
      outer.push({ segment, word, quote, depth });
      segment = fresh();
      word = null;
      quote = '';
      depth = 0;
      index += 1;
      continue;
    }
    if (quote === '"') {
      segment.text += char;
      if (char === '"') quote = '';
      else {
        word += char;
        segment.expanded += char;
      }
      continue;
    }
    if (char === ')' && !depth && outer.length) {
      endSubstitution();
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')' && depth) depth -= 1;
    if (char === '#' && word === null) {
      while (index + 1 < text.length && text[index + 1] !== '\n') index += 1;
      continue;
    }
    if ((char === '&' && next === '&') || (char === '|' && next === '|')) {
      endSegment();
      index += 1;
      continue;
    }
    if (char === '\n' || char === ';' || char === '|' || (char === '&' && text[index - 1] !== '>' && next !== '>')) {
      endSegment();
      continue;
    }
    segment.text += char;
    if (char === '"' || char === "'") {
      if (char === "'" && text[index - 1] === '$') segment.unsafe = true;
      quote = char;
      word = word ?? '';
      continue;
    }
    if (/\s/.test(char)) {
      endWord();
      segment.unquoted += ' ';
      continue;
    }
    segment.expanded += char;
    segment.unquoted += char;
    word = (word ?? '') + char;
  }
  while (outer.length) endSubstitution();
  endSegment();
  return segments;
}

export function shellSegments(command) {
  const segments = split(command);
  const redefinable = segments.some((segment) => /[()]/.test(segment.unquoted) || ['alias', 'function'].includes(segment.words[0]));
  return segments.map((segment) => {
    const redirects = HARMLESS_REDIRECTS.reduce((text, pattern) => text.replace(pattern, ''), segment.unquoted);
    const unsafe = segment.unsafe || /`|\$\(/.test(segment.expanded) || /[<>]/.test(redirects);
    return { text: segment.text, words: segment.words, okf: !redefinable && !unsafe && isPmOkf(segment.words) };
  });
}
