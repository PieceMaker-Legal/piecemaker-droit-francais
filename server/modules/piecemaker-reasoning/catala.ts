import type { ReasoningValue } from '../../../shared/piecemaker-reasoning.js';

export type Expression =
  | { t: 'lit'; v: ReasoningValue }
  | { t: 'var'; path: string[] }
  | { t: 'not'; e: Expression }
  | { t: 'neg'; e: Expression }
  | { t: 'bin'; op: BinaryOperator; l: Expression; r: Expression }
  | { t: 'if'; c: Expression; a: Expression; b: Expression };

export type BinaryOperator = 'ou' | 'et' | '=' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-' | '*' | '/';
export type Attributes = Record<string, string[]>;
export type DeclarationItem = { role: 'entrée' | 'interne' | 'résultat'; name: string; type: string } | { role: 'champ'; name: string; scope: string };
export type Declaration = { scope: string; attrs: Attributes; items: DeclarationItem[] };
export type Rule = { kind: 'règle' | 'définition'; target: string[]; condition?: Expression; consequence: boolean | Expression; label?: string; exception?: string; attrs: Attributes };
export type ScopeBody = { scope: string; rules: Rule[] };
export type CatalaProgram = { declarations: Declaration[]; bodies: ScopeBody[] };

export const CATALA_TYPES = ['booléen', 'date', 'entier', 'décimal', 'argent', 'durée', 'condition'];
const KEYWORDS = new Set(['et', 'ou', 'non', 'si', 'alors', 'sinon', 'conséquence', 'règle', 'définition', 'sous', 'condition', 'rempli', 'égal', 'étiquette', 'exception', 'champ', "d'application", 'déclaration', 'entrée', 'interne', 'résultat', 'contenu', 'vrai', 'faux']);
const UNITS: Record<string, 'ans' | 'mois' | 'jours'> = { an: 'ans', ans: 'ans', mois: 'mois', jour: 'jours', jours: 'jours' };
const PRECEDENCE: Record<BinaryOperator, number> = { ou: 1, et: 2, '=': 4, '!=': 4, '<': 4, '<=': 4, '>': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6 };

type Token = { k: 'id' | 'num' | 'date' | 'str' | 'sym' | 'eof'; v: string; line: number };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /(\s+)|(#(?!\[)[^\n]*)|(#\[)|(\|\d{4}-\d{2}-\d{2}\|)|("(?:[^"\\]|\\.)*")|(\d{1,3}(?:[  ]\d{3})+(?:,\d+)?|\d+(?:,\d+)?)|([\p{L}_][\p{L}\p{N}_'’]*)|(<=|>=|!=|[\][=,:().<>+\-*/€])/uy;
  let line = 1;
  while (pattern.lastIndex < source.length) {
    const start = pattern.lastIndex;
    const match = pattern.exec(source);
    if (!match) throw new SyntaxError(`Ligne ${line} : caractère inattendu « ${source[start]} ».`);
    const [text, space, comment, attribute, date, string, number, identifier, symbol] = match;
    if (space || comment) { line += text.split('\n').length - 1; continue; }
    if (attribute) tokens.push({ k: 'sym', v: '#[', line });
    else if (date) tokens.push({ k: 'date', v: date.slice(1, -1), line });
    else if (string) tokens.push({ k: 'str', v: JSON.parse(string), line });
    else if (number) tokens.push({ k: 'num', v: number.replace(/[  ]/g, '').replace(',', '.'), line });
    else if (identifier) tokens.push({ k: 'id', v: identifier.replace(/’/g, "'"), line });
    else tokens.push({ k: 'sym', v: symbol, line });
  }
  tokens.push({ k: 'eof', v: '', line });
  return tokens;
}

export function catalaSource(text: string) {
  const fenced = [...text.matchAll(/```catala[^\n]*\n([\s\S]*?)```/g)].map((match) => match[1]);
  return fenced.length ? fenced.join('\n') : text;
}

export function parseCatala(text: string): CatalaProgram {
  const tokens = tokenize(catalaSource(text));
  let index = 0;
  const peek = (offset = 0) => tokens[index + offset];
  const fail = (message: string): never => { throw new SyntaxError(`Ligne ${peek().line} : ${message} (trouvé « ${peek().v || 'fin'} »).`); };
  const is = (value: string, offset = 0) => peek(offset).v === value && peek(offset).k !== 'str';
  const accept = (value: string) => (is(value) ? (index++, true) : false);
  const expect = (value: string) => { if (!accept(value)) fail(`« ${value} » attendu`); };
  const name = () => {
    const token = peek();
    if (token.k !== 'id' || KEYWORDS.has(token.v)) fail('nom attendu');
    index++;
    return token.v;
  };
  const path = () => {
    const parts = [name()];
    while (accept('.')) parts.push(name());
    return parts;
  };

  const attributes = (): Attributes => {
    const attrs: Attributes = {};
    while (accept('#[')) {
      const key = name();
      const values: string[] = [];
      if (accept('=')) {
        do {
          const token = peek();
          if (!['id', 'num', 'str', 'date'].includes(token.k)) fail('valeur d’attribut attendue');
          index++;
          values.push(token.v);
        } while (accept(','));
      }
      expect(']');
      attrs[key] = [...(attrs[key] ?? []), ...values];
    }
    return attrs;
  };

  const atom = (): Expression => {
    const token = peek();
    if (accept('(')) { const inner = expression(); expect(')'); return inner; }
    if (accept('vrai')) return { t: 'lit', v: true };
    if (accept('faux')) return { t: 'lit', v: false };
    if (token.k === 'date') { index++; return { t: 'lit', v: token.v }; }
    if (token.k === 'num') {
      index++;
      const amount = Number(token.v);
      const unit = UNITS[peek().v];
      if (peek().k === 'id' && unit) {
        index++;
        if (!Number.isInteger(amount)) fail('durée entière attendue');
        return { t: 'lit', v: { ans: 0, mois: 0, jours: 0, [unit]: amount } };
      }
      accept('€');
      return { t: 'lit', v: amount };
    }
    return { t: 'var', path: path() };
  };
  const unary = (): Expression => (accept('-') ? { t: 'neg', e: unary() } : atom());
  const binary = (level: number): Expression => {
    if (level === 3) return accept('non') ? { t: 'not', e: binary(3) } : binary(4);
    if (level >= 7) return unary();
    let left = binary(level + 1);
    for (;;) {
      const operator = peek().v as BinaryOperator;
      if (peek().k === 'str' || PRECEDENCE[operator] !== level) return left;
      index++;
      left = { t: 'bin', op: operator, l: left, r: binary(level + 1) };
    }
  };
  const expression = (): Expression => {
    if (accept('si')) {
      const c = expression();
      expect('alors');
      const a = expression();
      expect('sinon');
      return { t: 'if', c, a, b: expression() };
    }
    return binary(1);
  };

  const declaration = (attrs: Attributes): Declaration => {
    expect('champ'); expect("d'application");
    const scope = name();
    expect(':');
    const items: DeclarationItem[] = [];
    for (;;) {
      if (is('entrée') || is('interne') || is('résultat')) {
        const role = peek().v as 'entrée' | 'interne' | 'résultat';
        index++;
        const variable = name();
        let type = 'condition';
        if (accept('contenu')) {
          type = peek().v;
          if (!CATALA_TYPES.includes(type) || type === 'condition') fail('type attendu (booléen, date, entier, décimal, argent, durée)');
          index++;
        } else expect('condition');
        items.push({ role, name: variable, type });
      } else if (peek().k === 'id' && !KEYWORDS.has(peek().v) && is('champ', 1)) {
        const variable = name();
        expect('champ');
        items.push({ role: 'champ', name: variable, scope: name() });
      } else return { scope, attrs, items };
    }
  };

  const rule = (attrs: Attributes): Rule => {
    let label: string | undefined;
    let exception: string | undefined;
    if (accept('étiquette')) label = name();
    if (accept('exception')) exception = name();
    if (accept('règle')) {
      const target = path();
      const condition = accept('sous') ? (expect('condition'), expression()) : undefined;
      expect('conséquence');
      const consequence = !accept('non');
      expect('rempli');
      return { kind: 'règle', target, condition, consequence, label, exception, attrs };
    }
    expect('définition');
    const target = path();
    let condition: Expression | undefined;
    if (accept('sous')) { expect('condition'); condition = expression(); expect('conséquence'); }
    else accept('conséquence');
    expect('égal'); expect('à');
    return { kind: 'définition', target, condition, consequence: expression(), label, exception, attrs };
  };

  const program: CatalaProgram = { declarations: [], bodies: [] };
  let pending: Attributes = {};
  while (peek().k !== 'eof') {
    const attrs = { ...pending, ...attributes() };
    pending = {};
    if (accept('déclaration')) { program.declarations.push(declaration(attrs)); continue; }
    expect('champ'); expect("d'application");
    const body: ScopeBody = { scope: name(), rules: [] };
    expect(':');
    let next = attrs;
    for (;;) {
      const ruleAttrs = { ...next, ...attributes() };
      next = {};
      if (is('règle') || is('définition') || is('étiquette') || is('exception')) body.rules.push(rule(ruleAttrs));
      else { pending = ruleAttrs; break; }
    }
    program.bodies.push(body);
  }
  return program;
}

const quote = (value: string) => (/^[\p{L}\p{N}_]+$/u.test(value) ? value : JSON.stringify(value));

export function printValue(value: ReasoningValue): string {
  if (value === null) return 'inconnu';
  if (typeof value === 'boolean') return value ? 'vrai' : 'faux';
  if (typeof value === 'number') return String(value).replace('.', ',');
  if (typeof value === 'string') return `|${value}|`;
  const parts = [value.ans && `${value.ans} an`, value.mois && `${value.mois} mois`, value.jours && `${value.jours} jour`].filter(Boolean);
  return parts.length ? parts.join(' + ') : '0 jour';
}

export function printExpression(expression: Expression, parent = 0): string {
  switch (expression.t) {
    case 'lit': return printValue(expression.v);
    case 'var': return expression.path.join('.');
    case 'not': { const text = `non ${printExpression(expression.e, 4)}`; return parent > 3 ? `(${text})` : text; }
    case 'neg': return `-${printExpression(expression.e, 7)}`;
    case 'if': { const text = `si ${printExpression(expression.c)} alors ${printExpression(expression.a)} sinon ${printExpression(expression.b)}`; return parent ? `(${text})` : text; }
    case 'bin': {
      const level = PRECEDENCE[expression.op];
      const text = `${printExpression(expression.l, level)} ${expression.op} ${printExpression(expression.r, level + 1)}`;
      return level < parent ? `(${text})` : text;
    }
  }
}

export function printAttributes(attrs: Attributes, indent: string) {
  return Object.entries(attrs).map(([key, values]) => `${indent}#[${key}${values.length ? ` = ${values.map(quote).join(', ')}` : ''}]\n`).join('');
}

export function printRule(rule: Rule, indent = '  ') {
  const head = `${rule.label ? `étiquette ${rule.label} ` : ''}${rule.exception ? `exception ${rule.exception} ` : ''}`;
  const condition = rule.condition ? ` sous condition ${printExpression(rule.condition)}` : '';
  const body = rule.kind === 'règle'
    ? `règle ${rule.target.join('.')}${condition} conséquence ${rule.consequence ? '' : 'non '}rempli`
    : `définition ${rule.target.join('.')}${condition ? `${condition} conséquence` : ''} égal à ${printExpression(rule.consequence as Expression)}`;
  return `${printAttributes(rule.attrs, indent)}${indent}${head}${body}\n`;
}

export function printCatala(program: CatalaProgram) {
  const declarations = program.declarations.map((declaration) => `${printAttributes(declaration.attrs, '')}déclaration champ d'application ${declaration.scope}:\n${declaration.items.map((item) => `  ${item.role === 'champ' ? `${item.name} champ ${item.scope}` : `${item.role} ${item.name}${item.type === 'condition' ? ' condition' : ` contenu ${item.type}`}`}\n`).join('')}`);
  const bodies = program.bodies.map((body) => `champ d'application ${body.scope}:\n${body.rules.map((rule) => printRule(rule)).join('')}`);
  return [...declarations, ...bodies].join('\n');
}
