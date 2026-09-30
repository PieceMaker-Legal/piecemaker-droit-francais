import { UserError } from './paths.js';

export type Operator = 'ET' | 'OU';

export type Criterion = {
  valeur: string;
  operateur: Operator;
  typeRecherche: 'EXACTE' | 'TOUS_LES_MOTS_DANS_UN_CHAMP';
  proximite?: number;
};

export type ParsedQuery = {
  clauses: Criterion[][];
  explicitOperators: boolean;
};

type Token = { kind: 'ATOM' | 'ET' | 'OU' | 'LPAREN' | 'RPAREN'; value: string; exact: boolean };

type Node = { kind: 'ATOM'; value: string; exact: boolean } | { kind: 'ET' | 'OU'; left: Node; right: Node };

const PROXIMITY = 10;
const MAX_CLAUSES = 64;
const CLOSING_QUOTES: Record<string, string> = { '"': '"', '«': '»', '“': '”' };

export function normalizeArticles(text: string): string {
  return text.replace(/\b([LRDC])\.?\s*(\d+[-\d]+)\b/gi, (_, letter: string, number: string) => `${letter}${number}`.toUpperCase());
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;
  while (position < text.length) {
    const character = text[position];
    if (/\s/.test(character)) {
      position += 1;
      continue;
    }
    if (character in CLOSING_QUOTES) {
      const end = text.indexOf(CLOSING_QUOTES[character], position + 1);
      if (end < 0) throw new UserError('Requête invalide : guillemets non fermés.');
      const value = text.slice(position + 1, end).trim();
      if (!value) throw new UserError('Requête invalide : expression exacte vide.');
      tokens.push({ kind: 'ATOM', value, exact: true });
      position = end + 1;
      continue;
    }
    if (character === '(' || character === ')') {
      tokens.push({ kind: character === '(' ? 'LPAREN' : 'RPAREN', value: character, exact: false });
      position += 1;
      continue;
    }
    const value = /^[^\s()]+/.exec(text.slice(position))![0];
    const upper = value.toUpperCase();
    tokens.push({ kind: upper === 'ET' || upper === 'OU' ? upper : 'ATOM', value, exact: false });
    position += value.length;
  }
  return tokens;
}

function withImplicitAnd(tokens: Token[]): Token[] {
  const result: Token[] = [];
  let previous: Token['kind'] | null = null;
  for (const token of tokens) {
    if ((previous === 'ATOM' || previous === 'RPAREN') && (token.kind === 'ATOM' || token.kind === 'LPAREN')) result.push({ kind: 'ET', value: 'ET', exact: false });
    result.push(token);
    previous = token.kind;
  }
  const last = result[result.length - 1];
  if (!last || last.kind === 'ET' || last.kind === 'OU' || last.kind === 'LPAREN') throw new UserError('Requête invalide : opérateur ou parenthèse ouvrante sans terme à droite.');
  return result;
}

function parseTree(tokens: Token[]): Node {
  let index = 0;
  const factor = (): Node => {
    const token = tokens[index];
    if (!token) throw new UserError('Requête invalide : terme attendu.');
    if (token.kind === 'ATOM') {
      index += 1;
      return { kind: 'ATOM', value: token.value, exact: token.exact };
    }
    if (token.kind === 'LPAREN') {
      index += 1;
      const node = or();
      if (tokens[index]?.kind !== 'RPAREN') throw new UserError('Requête invalide : parenthèse fermante manquante.');
      index += 1;
      return node;
    }
    throw new UserError('Requête invalide : opérateur sans terme à gauche.');
  };
  const and = (): Node => {
    let node = factor();
    while (tokens[index]?.kind === 'ET') {
      index += 1;
      node = { kind: 'ET', left: node, right: factor() };
    }
    return node;
  };
  const or = (): Node => {
    let node = and();
    while (tokens[index]?.kind === 'OU') {
      index += 1;
      node = { kind: 'OU', left: node, right: and() };
    }
    return node;
  };
  const tree = or();
  if (index !== tokens.length) throw new UserError('Requête invalide : parenthèse fermante ou terme inattendu.');
  return tree;
}

type Atom = { value: string; exact: boolean };

function distinct(clauses: Atom[][]): Atom[][] {
  const seen = new Set<string>();
  const unique = clauses.filter((clause) => {
    const key = JSON.stringify(clause.map((atom) => [atom.value, atom.exact]));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length > MAX_CLAUSES) throw new UserError(`Requête trop complexe : ${MAX_CLAUSES} combinaisons au plus.`);
  return unique;
}

function dnf(node: Node): Atom[][] {
  if (node.kind === 'ATOM') return [[{ value: node.value, exact: node.exact }]];
  const left = dnf(node.left);
  const right = dnf(node.right);
  if (node.kind === 'OU') return distinct([...left, ...right]);
  return distinct(left.flatMap((first) => right.map((second) => [...first, ...second])));
}

export function parseQuery(query: string): ParsedQuery {
  const text = normalizeArticles(String(query ?? '').trim());
  if (!text) throw new UserError('Saisissez une requête.');
  const tokens = tokenize(text);
  const clauses = dnf(parseTree(withImplicitAnd(tokens))).map((clause) => clause.map((atom): Criterion => ({
    valeur: atom.value,
    operateur: 'ET',
    typeRecherche: atom.exact ? 'EXACTE' : 'TOUS_LES_MOTS_DANS_UN_CHAMP',
    ...(atom.exact ? {} : { proximite: PROXIMITY }),
  })));
  return { clauses, explicitOperators: tokens.some((token) => token.kind === 'ET' || token.kind === 'OU') };
}

export function searchFields(parsed: ParsedQuery, orWhenImplicit: boolean): { operateur: Operator; champs: { typeChamp: 'ALL'; operateur: Operator; criteres: Criterion[] }[] } {
  if (orWhenImplicit && !parsed.explicitOperators) {
    return { operateur: 'OU', champs: parsed.clauses.map((clause) => ({ typeChamp: 'ALL', operateur: 'OU', criteres: clause.map((criterion) => ({ ...criterion, operateur: 'OU' })) })) };
  }
  if (parsed.clauses.length > 1) return { operateur: 'OU', champs: parsed.clauses.map((clause) => ({ typeChamp: 'ALL', operateur: 'ET', criteres: clause })) };
  return { operateur: 'ET', champs: [{ typeChamp: 'ALL', operateur: 'ET', criteres: parsed.clauses[0] }] };
}

export function localClauses(parsed: ParsedQuery, orWhenImplicit: boolean): Criterion[][] {
  return orWhenImplicit && !parsed.explicitOperators ? parsed.clauses.flat().map((criterion) => [criterion]) : parsed.clauses;
}

function stem(word: string): string {
  return word.length > 3 ? word.replace(/(?:s|x)$/, '') : word;
}

export function matchWords(text: string): string[] {
  return normalizeArticles(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(stem);
}

export type MatchIndex = Map<string, number[]>;

export function matchIndex(text: string): MatchIndex {
  const index: MatchIndex = new Map();
  matchWords(text).forEach((word, position) => {
    const positions = index.get(word);
    if (positions) positions.push(position);
    else index.set(word, [position]);
  });
  return index;
}

function phraseMatches(index: MatchIndex, words: string[]): boolean {
  const [first, ...rest] = words;
  return (index.get(first) ?? []).some((start) => rest.every((word, offset) => index.get(word)?.includes(start + offset + 1)));
}

function nearMatches(index: MatchIndex, words: string[], proximity: number): boolean {
  const [first, ...rest] = words;
  if (!rest.length) return index.has(first);
  return (index.get(first) ?? []).some((start) => rest.every((word) => (index.get(word) ?? []).some((position) => Math.abs(position - start) <= proximity + rest.length)));
}

export function criterionMatches(index: MatchIndex, criterion: Criterion): boolean {
  const words = matchWords(criterion.valeur);
  if (!words.length) return true;
  return criterion.typeRecherche === 'EXACTE' ? phraseMatches(index, words) : nearMatches(index, words, criterion.proximite ?? PROXIMITY);
}

export function clausesMatch(index: MatchIndex, clauses: Criterion[][]): boolean {
  return clauses.some((clause) => clause.every((criterion) => criterionMatches(index, criterion)));
}
