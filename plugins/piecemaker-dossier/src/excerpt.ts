const ABBREVIATION = /(?:^|[^\p{L}])(?:\p{Lu}|Mmes?|Mlle|Mr|MM|Dr|Pr|Mes?|Ste?|Cie)$/u;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;
const DEFAULT_MAX_LENGTH = 300;

type Folded = { text: string; origin: number[] };

const foldCharacter = (character: string): string => character.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');

function fold(text: string): Folded {
  let folded = '';
  const origin: number[] = [];
  let index = 0;
  for (const character of text) {
    const isSpace = /[^\S\n]/.test(character);
    const piece = isSpace ? ' ' : foldCharacter(character);
    if (!(isSpace && folded.endsWith(' '))) {
      for (const unit of piece) {
        folded += unit;
        origin.push(index);
      }
    }
    index += character.length;
  }
  return { text: folded, origin };
}

function firstOccurrence(text: string, folded: Folded, value: string): { start: number; end: number } | null {
  const needle = fold(value.trim()).text;
  if (!needle) return null;
  let from = 0;
  while (from <= folded.text.length - needle.length) {
    const found = folded.text.indexOf(needle, from);
    if (found < 0) return null;
    const before = folded.text[found - 1];
    const after = folded.text[found + needle.length];
    if (!(before && WORD_CHARACTER.test(before)) && !(after && WORD_CHARACTER.test(after))) {
      const last = folded.origin[found + needle.length - 1];
      return { start: folded.origin[found], end: last + String.fromCodePoint(text.codePointAt(last) as number).length };
    }
    from = found + 1;
  }
  return null;
}

const endsSentence = (text: string, index: number): boolean => {
  if (!'.!?'.includes(text[index])) return false;
  const next = text[index + 1];
  if (next !== undefined && !/\s/.test(next)) return false;
  return text[index] !== '.' || !ABBREVIATION.test(text.slice(Math.max(0, index - 5), index));
};

function sentenceBounds(text: string, start: number, end: number): { start: number; end: number } {
  let left = start;
  while (left > 0 && text[left - 1] !== '\n' && !endsSentence(text, left - 1)) left -= 1;
  let right = end;
  while (right < text.length && text[right] !== '\n') {
    if (endsSentence(text, right)) { right += 1; break; }
    right += 1;
  }
  return { start: left, end: right };
}

const cleaned = (sentence: string): string => sentence.replace(/^[\s#>*+|-]+/, '').replace(/[^\S\n]+/g, ' ').trim();

function truncated(sentence: string, matchStart: number, maxLength: number): string {
  if (sentence.length <= maxLength) return sentence;
  let from = Math.max(0, Math.min(matchStart - Math.floor(maxLength / 3), sentence.length - maxLength));
  if (from > 0) {
    const space = sentence.indexOf(' ', from);
    from = space < 0 ? from : space + 1;
  }
  let to = Math.min(sentence.length, from + maxLength);
  if (to < sentence.length) {
    const space = sentence.lastIndexOf(' ', to);
    to = space > from ? space : to;
  }
  return `${from > 0 ? '…' : ''}${sentence.slice(from, to).trim()}${to < sentence.length ? '…' : ''}`;
}

export function sentenceContaining(markdown: string, values: string[], maxLength = DEFAULT_MAX_LENGTH): string | null {
  const folded = fold(markdown);
  let best: { start: number; end: number } | null = null;
  for (const value of values) {
    const found = firstOccurrence(markdown, folded, value);
    if (found && (!best || found.start < best.start)) best = found;
  }
  if (!best) return null;
  const bounds = sentenceBounds(markdown, best.start, best.end);
  const raw = markdown.slice(bounds.start, bounds.end);
  const leading = raw.length - raw.replace(/^[\s#>*+|-]+/, '').length;
  const sentence = cleaned(raw);
  if (!sentence) return null;
  const offset = Math.max(0, best.start - bounds.start - leading);
  return truncated(sentence, offset, maxLength);
}
