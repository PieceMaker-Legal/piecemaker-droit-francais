import type { ReasoningValue } from '../../../shared/piecemaker-reasoning.js';

export type Sens = 'maximum' | 'minimum';
export type BinaryOperator = 'ou' | 'ou bien' | 'et' | '=' | '!=' | '<' | '<=' | '>' | '>=' | 'contient' | '+' | '-' | '++' | '*' | '/';
export type Expression =
  | { t: 'lit'; v: ReasoningValue }
  | { t: 'var'; path: string[] }
  | { t: 'not'; e: Expression }
  | { t: 'neg'; e: Expression }
  | { t: 'bin'; op: BinaryOperator; l: Expression; r: Expression }
  | { t: 'if'; c: Expression; a: Expression; b: Expression }
  | { t: 'impossible' }
  | { t: 'soit'; name: string; e: Expression; body: Expression }
  | { t: 'selon'; e: Expression; cas: Array<{ cas: string | null; variable?: string; body: Expression }> }
  | { t: 'forme'; e: Expression; cas: string; variable?: string; garde?: Expression }
  | { t: 'champ'; e: Expression; name: string }
  | { t: 'structure'; name: string; champs: Array<{ name: string; e: Expression }> }
  | { t: 'cas'; cas: string; e?: Expression }
  | { t: 'liste'; items: Expression[] }
  | { t: 'nombre'; l: Expression }
  | { t: 'somme'; type: string; l: Expression }
  | { t: 'extremum'; sens: Sens; l: Expression; vide?: Expression }
  | { t: 'existe'; name: string; l: Expression; e: Expression }
  | { t: 'pour_tout'; name: string; l: Expression; e: Expression }
  | { t: 'transforme'; name: string; l: Expression; e: Expression }
  | { t: 'filtre'; name: string; l: Expression; e: Expression }
  | { t: 'contenu_de'; name: string; l: Expression; e: Expression; sens: Sens; vide?: Expression }
  | { t: 'combine'; name: string; l: Expression; acc: string; init: Expression; e: Expression }
  | { t: 'appel'; name: string; args: Expression[] }
  | { t: 'intégrée'; nom: string; e: Expression }
  | { t: 'résultat_de'; scope: string; avec: Array<{ name: string; e: Expression }> };

export type Attributes = Record<string, string[]>;
export type ItemRole = 'entrée' | 'interne' | 'résultat' | 'contexte' | 'entrée résultat' | 'contexte résultat';
export type Argument = { name: string; type: string };
export type DeclarationItem = { role: ItemRole; name: string; type: string; args?: Argument[]; states?: string[] } | { role: 'champ'; name: string; scope: string };
export type Declaration = { scope: string; attrs: Attributes; items: DeclarationItem[] };
export type Rule = { kind: 'règle' | 'définition' | 'assertion'; target: string[]; args?: string[]; state?: string; condition?: Expression; consequence: boolean | Expression; label?: string; exception?: string; attrs: Attributes };
export type ScopeBody = { scope: string; rules: Rule[]; arrondi?: 'inférieur' | 'supérieur' };
export type StructureDeclaration = { name: string; fields: Argument[] };
export type EnumerationDeclaration = { name: string; cases: Array<{ name: string; type?: string }> };
export type GlobalDeclaration = { name: string; type: string; args: Argument[]; body: Expression };
export type CatalaProgram = { declarations: Declaration[]; bodies: ScopeBody[]; structures: StructureDeclaration[]; enumerations: EnumerationDeclaration[]; globals: GlobalDeclaration[] };

export const CATALA_TYPES = ['booléen', 'date', 'entier', 'décimal', 'argent', 'durée', 'condition'];
const PRIMITIVES = ['booléen', 'date', 'entier', 'décimal', 'argent', 'durée'];
const NUMERIC_TYPES = ['entier', 'décimal', 'argent'];
const KEYWORDS = new Set(['et', 'ou', 'non', 'si', 'alors', 'sinon', 'conséquence', 'règle', 'définition', 'sous', 'condition', 'rempli', 'égal', 'étiquette', 'exception', 'champ', "d'application", 'déclaration', 'entrée', 'interne', 'résultat', 'contenu', 'vrai', 'faux', 'contexte', 'structure', 'énumération', 'donnée', 'état', 'dépendant', 'soit', 'dans', 'selon', 'forme', 'pour', 'tout', 'parmi', 'tel', 'que', 'transforme', 'chaque', 'combine', 'initialement', 'avec', 'liste', 'de', 'en', 'contient', 'nombre', 'somme', 'maximum', 'minimum', 'existe', 'assertion', 'impossible']);
const UNITS = new Map<string, 'ans' | 'mois' | 'jours'>([['an', 'ans'], ['ans', 'ans'], ['mois', 'mois'], ['jour', 'jours'], ['jours', 'jours']]);
const PRECEDENCE = new Map<string, number>([['ou', 1], ['ou bien', 1], ['et', 2], ['=', 4], ['!=', 4], ['<', 4], ['<=', 4], ['>', 4], ['>=', 4], ['contient', 4], ['+', 5], ['-', 5], ['++', 5], ['*', 6], ['/', 6]]);
const BUILTINS = new Set(['arrondi', 'décimal', 'argent', 'accès_jour', 'accès_mois', 'accès_année', 'premier_jour_du_mois', 'dernier_jour_du_mois']);
const ITEM_ROLES = ['entrée', 'interne', 'résultat', 'contexte'];

type Token = { k: 'id' | 'num' | 'date' | 'str' | 'sym' | 'eof'; v: string; line: number };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /(\s+)|(#(?!\[)[^\n]*)|(#\[)|(\|\d{4}-\d{2}-\d{2}\|)|("(?:[^"\\]|\\.)*")|(\d{1,3}(?:[  ]\d{3})+(?:,\d+)?|\d+(?:,\d+)?)|([\p{L}_][\p{L}\p{N}_'’]*)|(<=|>=|!=|\+\+|--|[\][=,:().<>+\-*/€%;{}])/uy;
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
  const peek = (offset = 0) => tokens[Math.min(index + offset, tokens.length - 1)];
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
  const sequence = <T>(close: string, separator: string, parse: () => T): T[] => {
    const found: T[] = [];
    if (accept(close)) return found;
    do found.push(parse()); while (accept(separator));
    expect(close);
    return found;
  };

  const attributes = (): Attributes => {
    const attrs: Attributes = {};
    while (accept('#[')) {
      const keyToken = peek();
      if (keyToken.k !== 'id') fail('nom attendu');
      index++;
      const key = keyToken.v;
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

  const typeName = (): string => {
    if (accept('liste')) { expect('de'); return `liste de ${typeName()}`; }
    const token = peek();
    if (token.k !== 'id' || KEYWORDS.has(token.v)) fail('type attendu');
    index++;
    return token.v;
  };
  const argument = (): Argument => {
    const argName = name();
    expect('contenu');
    return { name: argName, type: typeName() };
  };
  const argumentList = (): Argument[] => {
    const list = [argument()];
    while (accept(',')) list.push(argument());
    return list;
  };
  const nameList = (): string[] => {
    const list = [name()];
    while (accept(',')) list.push(name());
    return list;
  };

  const emptyFallback = (): Expression | undefined => {
    if (is('ou') && is('si', 1) && is('liste', 2) && is('vide', 3)) { index += 4; expect('alors'); return expression(); }
    return undefined;
  };
  const assignments = () => {
    expect('{');
    const fields: Array<{ name: string; e: Expression }> = [];
    while (accept('--')) {
      const fieldName = name();
      expect(':');
      fields.push({ name: fieldName, e: expression() });
    }
    expect('}');
    return fields;
  };
  const bound = (): string => name();
  const parmi = (): Expression => { const list = (expect('parmi'), postfix()); return list; };

  const operatorAt = (): { op: BinaryOperator; width: number } | undefined => {
    const token = peek();
    if (token.k === 'str') return undefined;
    if (token.v === 'ou' && peek(1).v === 'bien') return { op: 'ou bien', width: 2 };
    return PRECEDENCE.has(token.v) ? { op: token.v as BinaryOperator, width: 1 } : undefined;
  };

  const atom = (): Expression => {
    const token = peek();
    if (accept('(')) { const inner = expression(); expect(')'); return inner; }
    if (accept('[')) return { t: 'liste', items: sequence(']', ';', expression) };
    if (accept('vrai')) return { t: 'lit', v: true };
    if (accept('faux')) return { t: 'lit', v: false };
    if (accept('impossible')) return { t: 'impossible' };
    if (token.k === 'date') { index++; return { t: 'lit', v: token.v }; }
    if (token.k === 'num') {
      index++;
      const amount = Number(token.v);
      const unit = UNITS.get(peek().v);
      if (peek().k === 'id' && unit) {
        index++;
        if (!Number.isInteger(amount)) fail('durée entière attendue');
        return { t: 'lit', v: { ans: 0, mois: 0, jours: 0, [unit]: amount } };
      }
      if (accept('%')) return { t: 'lit', v: amount / 100 };
      accept('€');
      return { t: 'lit', v: amount };
    }
    if (accept('nombre')) { expect('de'); return { t: 'nombre', l: postfix() }; }
    if (accept('somme')) {
      const type = peek().v;
      if (!['argent', 'entier', 'décimal', 'durée'].includes(type)) fail('type de somme attendu (argent, entier, décimal, durée)');
      index++;
      expect('de');
      return { t: 'somme', type, l: postfix() };
    }
    if (is('maximum') || is('minimum')) {
      const sens = peek().v as Sens;
      index++;
      expect('de');
      const l = postfix();
      const vide = emptyFallback();
      return { t: 'extremum', sens, l, ...(vide ? { vide } : {}) };
    }
    if (accept('existe')) {
      const variable = bound();
      const l = parmi();
      expect('tel'); expect('que');
      return { t: 'existe', name: variable, l, e: expression() };
    }
    if (accept('pour')) {
      expect('tout');
      const variable = bound();
      const l = parmi();
      expect('on'); expect('a');
      return { t: 'pour_tout', name: variable, l, e: expression() };
    }
    if (accept('transforme')) {
      expect('chaque');
      const variable = bound();
      const l = parmi();
      expect('en');
      return { t: 'transforme', name: variable, l, e: expression() };
    }
    if (accept('liste')) {
      expect('de');
      const variable = bound();
      const l = parmi();
      expect('tel'); expect('que');
      return { t: 'filtre', name: variable, l, e: expression() };
    }
    if (accept('contenu')) {
      expect('de');
      const variable = bound();
      const l = parmi();
      expect('tel'); expect('que');
      const e = expression();
      expect('est');
      const sens = peek().v === 'maximum' || peek().v === 'minimum' ? peek().v as Sens : fail('maximum ou minimum attendu');
      index++;
      const vide = emptyFallback();
      return { t: 'contenu_de', name: variable, l, e, sens, ...(vide ? { vide } : {}) };
    }
    if (accept('combine')) {
      expect('tout');
      const variable = bound();
      const l = parmi();
      expect('dans');
      const acc = name();
      expect('initialement');
      const init = expression();
      expect('avec');
      return { t: 'combine', name: variable, l, acc, init, e: expression() };
    }
    if (is('résultat') && is('de', 1)) {
      index += 2;
      const scope = name();
      expect('avec');
      return { t: 'résultat_de', scope, avec: assignments() };
    }
    if (token.k === 'id' && !KEYWORDS.has(token.v)) {
      if (BUILTINS.has(token.v) && is('de', 1)) { index += 2; return { t: 'intégrée', nom: token.v, e: postfix() }; }
      if (is('de', 1)) {
        const callee = name();
        index++;
        const args = accept('(') ? sequence(')', ',', expression) : [postfix()];
        return { t: 'appel', name: callee, args };
      }
      if (is('{', 1)) { const structName = name(); return { t: 'structure', name: structName, champs: assignments() }; }
      if (is('contenu', 1)) { const caseName = name(); index++; return { t: 'cas', cas: caseName, e: unary() }; }
    }
    return { t: 'var', path: path() };
  };

  const postfix = (): Expression => {
    let e = atom();
    for (;;) {
      if (accept('.')) e = { t: 'champ', e, name: name() };
      else if (is('sous') && is('forme', 1) && peek(2).k === 'id') {
        index += 2;
        const cas = name();
        let variable: string | undefined;
        let garde: Expression | undefined;
        if (accept('de')) {
          variable = name();
          if (accept('et')) garde = expression();
        }
        e = { t: 'forme', e, cas, ...(variable ? { variable } : {}), ...(garde ? { garde } : {}) };
      } else return e;
    }
  };
  const unary = (): Expression => (accept('-') ? { t: 'neg', e: unary() } : postfix());
  const binary = (level: number): Expression => {
    if (level === 3) return accept('non') ? { t: 'not', e: binary(3) } : binary(4);
    if (level >= 7) return unary();
    let left = binary(level + 1);
    for (;;) {
      const operator = operatorAt();
      if (!operator || PRECEDENCE.get(operator.op) !== level) return left;
      index += operator.width;
      left = { t: 'bin', op: operator.op, l: left, r: binary(level + 1) };
    }
  };
  function expression(): Expression {
    if (accept('si')) {
      const c = expression();
      expect('alors');
      const a = expression();
      expect('sinon');
      return { t: 'if', c, a, b: expression() };
    }
    if (accept('soit')) {
      const variable = name();
      expect('égal'); expect('à');
      const e = expression();
      expect('dans');
      return { t: 'soit', name: variable, e, body: expression() };
    }
    if (accept('selon')) {
      const e = expression();
      expect('sous'); expect('forme');
      const cas: Array<{ cas: string | null; variable?: string; body: Expression }> = [];
      while (accept('--')) {
        let caseName: string | null = null;
        if (is("n'importe")) { index++; expect('quel'); } else caseName = name();
        const variable = accept('de') ? name() : undefined;
        expect(':');
        cas.push({ cas: caseName, ...(variable ? { variable } : {}), body: expression() });
      }
      return { t: 'selon', e, cas };
    }
    return binary(1);
  }

  const itemTail = () => {
    let type: string | undefined;
    let args: Argument[] | undefined;
    let states: string[] | undefined;
    for (;;) {
      if (accept('condition')) type = 'condition';
      else if (accept('contenu')) type = typeName();
      else if (accept('dépendant')) { expect('de'); args = argumentList(); }
      else if (accept('état')) {
        states = [name()];
        while (accept('état')) states.push(name());
      } else break;
    }
    return { type: type ?? 'condition', args, states };
  };

  const declaration = (attrs: Attributes): Declaration => {
    expect('champ'); expect("d'application");
    const scope = name();
    expect(':');
    const items: DeclarationItem[] = [];
    for (;;) {
      const word = peek().k === 'id' ? peek().v : '';
      if (ITEM_ROLES.includes(word)) {
        index++;
        let role = word as ItemRole;
        if ((word === 'entrée' || word === 'contexte') && accept('résultat')) role = `${word} résultat` as ItemRole;
        const variable = name();
        items.push({ role, name: variable, ...itemTail() });
      } else if (peek().k === 'id' && !KEYWORDS.has(peek().v) && is('champ', 1)) {
        const variable = name();
        expect('champ');
        accept("d'application");
        items.push({ role: 'champ', name: variable, scope: name() });
      } else return { scope, attrs, items };
    }
  };

  const structure = (): StructureDeclaration => {
    const structName = name();
    expect(':');
    const fields: Argument[] = [];
    while (accept('donnée')) {
      const fieldName = name();
      expect('contenu');
      fields.push({ name: fieldName, type: typeName() });
    }
    return { name: structName, fields };
  };

  const enumeration = (): EnumerationDeclaration => {
    const enumName = name();
    expect(':');
    const cases: Array<{ name: string; type?: string }> = [];
    while (accept('--')) {
      const caseName = name();
      cases.push(accept('contenu') ? { name: caseName, type: typeName() } : { name: caseName });
    }
    return { name: enumName, cases };
  };

  const globalDeclaration = (): GlobalDeclaration => {
    const globalName = name();
    expect('contenu');
    const type = typeName();
    const args = accept('dépendant') ? (expect('de'), argumentList()) : [];
    expect('égal'); expect('à');
    return { name: globalName, type, args, body: expression() };
  };

  const rule = (attrs: Attributes): Rule => {
    let label: string | undefined;
    let exception: string | undefined;
    if (accept('étiquette')) label = name();
    if (accept('exception')) exception = is('règle') || is('définition') ? '' : name();
    const isRule = accept('règle');
    if (!isRule) expect('définition');
    const target = path();
    const args = accept('de') ? nameList() : undefined;
    const state = accept('état') ? name() : undefined;
    const base = { target, ...(args ? { args } : {}), ...(state !== undefined ? { state } : {}), label, exception, attrs };
    if (isRule) {
      const condition = accept('sous') ? (expect('condition'), expression()) : undefined;
      expect('conséquence');
      const consequence = !accept('non');
      expect('rempli');
      return { kind: 'règle', ...base, condition, consequence };
    }
    let condition: Expression | undefined;
    if (accept('sous')) {
      expect('condition');
      condition = expression();
      expect('conséquence');
    } else accept('conséquence');
    expect('égal'); expect('à');
    return { kind: 'définition', ...base, condition, consequence: expression() };
  };

  const program: CatalaProgram = { declarations: [], bodies: [], structures: [], enumerations: [], globals: [] };
  let pending: Attributes = {};
  while (peek().k !== 'eof') {
    const attrs = { ...pending, ...attributes() };
    pending = {};
    if (accept('déclaration')) {
      if (accept('structure')) program.structures.push(structure());
      else if (accept('énumération')) program.enumerations.push(enumeration());
      else if (is('champ')) program.declarations.push(declaration(attrs));
      else program.globals.push(globalDeclaration());
      continue;
    }
    expect('champ'); expect("d'application");
    const body: ScopeBody = { scope: name(), rules: [] };
    expect(':');
    let next = attrs;
    for (;;) {
      const ruleAttrs = { ...next, ...attributes() };
      next = {};
      if (is('règle') || is('définition') || is('étiquette') || is('exception')) body.rules.push(rule(ruleAttrs));
      else if (accept('assertion')) body.rules.push({ kind: 'assertion', target: [], consequence: expression(), attrs: ruleAttrs });
      else if (is('date') && is('arrondi', 1)) {
        index += 2;
        const direction = ({ inférieur: 'inférieur', décroissant: 'inférieur', supérieur: 'supérieur', croissant: 'supérieur' } as const)[peek().v as 'inférieur'] ?? fail('croissant ou décroissant attendu');
        index++;
        body.arrondi = direction;
        next = ruleAttrs;
      } else { pending = ruleAttrs; break; }
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
  if (Array.isArray(value)) return `[${value.map(printValue).join('; ')}]`;
  if ('structure' in value) return `${value.structure} { ${Object.entries(value.champs).map(([field, entry]) => `-- ${field}: ${printValue(entry)}`).join(' ')} }`;
  if ('énumération' in value) return value.contenu === undefined ? value.cas : `${value.cas} contenu ${printValue(value.contenu)}`;
  const parts = [value.ans && `${value.ans} an`, value.mois && `${value.mois} mois`, value.jours && `${value.jours} jour`].filter(Boolean);
  return parts.length ? parts.join(' + ') : '0 jour';
}

export function printExpression(expression: Expression, parent = 0): string {
  const wrap = (text: string, needed: boolean) => (needed ? `(${text})` : text);
  switch (expression.t) {
    case 'lit': return printValue(expression.v);
    case 'var': return expression.path.join('.');
    case 'impossible': return 'impossible';
    case 'not': return wrap(`non ${printExpression(expression.e, 4)}`, parent > 3);
    case 'neg': return `-${printExpression(expression.e, 7)}`;
    case 'if': return wrap(`si ${printExpression(expression.c)} alors ${printExpression(expression.a)} sinon ${printExpression(expression.b)}`, parent > 0);
    case 'bin': {
      const level = PRECEDENCE.get(expression.op)!;
      const text = `${printExpression(expression.l, level)} ${expression.op} ${printExpression(expression.r, level + 1)}`;
      return level < parent ? `(${text})` : text;
    }
    case 'soit': return wrap(`soit ${expression.name} égal à ${printExpression(expression.e)} dans ${printExpression(expression.body)}`, parent > 0);
    case 'selon': {
      const arms = expression.cas.map((arm) => `-- ${arm.cas ?? "n'importe quel"}${arm.variable ? ` de ${arm.variable}` : ''} : ${printExpression(arm.body)}`).join(' ');
      return wrap(`selon ${printExpression(expression.e, 1)} sous forme ${arms}`, parent > 0);
    }
    case 'forme': return wrap(`${printExpression(expression.e, 8)} sous forme ${expression.cas}${expression.variable ? ` de ${expression.variable}` : ''}${expression.garde ? ` et ${printExpression(expression.garde)}` : ''}`, parent > 0);
    case 'champ': return expression.e.t === 'var' ? `${expression.e.path.join('.')}.${expression.name}` : `(${printExpression(expression.e)}).${expression.name}`;
    case 'structure': return `${expression.name} { ${expression.champs.map((field) => `-- ${field.name}: ${printExpression(field.e)}`).join(' ')} }`;
    case 'cas': return `${expression.cas}${expression.e ? ` contenu ${printExpression(expression.e, 8)}` : ''}`;
    case 'liste': return `[${expression.items.map((item) => printExpression(item)).join('; ')}]`;
    case 'nombre': return `nombre de ${printExpression(expression.l, 8)}`;
    case 'somme': return `somme ${expression.type} de ${printExpression(expression.l, 8)}`;
    case 'extremum': return wrap(`${expression.sens} de ${printExpression(expression.l, 8)}${expression.vide ? ` ou si liste vide alors ${printExpression(expression.vide)}` : ''}`, parent > 0 && Boolean(expression.vide));
    case 'existe': return wrap(`existe ${expression.name} parmi ${printExpression(expression.l, 8)} tel que ${printExpression(expression.e)}`, parent > 0);
    case 'pour_tout': return wrap(`pour tout ${expression.name} parmi ${printExpression(expression.l, 8)} on a ${printExpression(expression.e)}`, parent > 0);
    case 'transforme': return wrap(`transforme chaque ${expression.name} parmi ${printExpression(expression.l, 8)} en ${printExpression(expression.e)}`, parent > 0);
    case 'filtre': return wrap(`liste de ${expression.name} parmi ${printExpression(expression.l, 8)} tel que ${printExpression(expression.e)}`, parent > 0);
    case 'contenu_de': return wrap(`contenu de ${expression.name} parmi ${printExpression(expression.l, 8)} tel que ${printExpression(expression.e)} est ${expression.sens}${expression.vide ? ` ou si liste vide alors ${printExpression(expression.vide)}` : ''}`, parent > 0);
    case 'combine': return wrap(`combine tout ${expression.name} parmi ${printExpression(expression.l, 8)} dans ${expression.acc} initialement ${printExpression(expression.init)} avec ${printExpression(expression.e)}`, parent > 0);
    case 'appel': return expression.args.length === 1 ? `${expression.name} de ${printExpression(expression.args[0], 8)}` : `${expression.name} de (${expression.args.map((arg) => printExpression(arg)).join(', ')})`;
    case 'intégrée': return `${expression.nom} de ${printExpression(expression.e, 8)}`;
    case 'résultat_de': return `résultat de ${expression.scope} avec { ${expression.avec.map((field) => `-- ${field.name}: ${printExpression(field.e)}`).join(' ')} }`;
  }
}

export function freeVariables(expression: Expression, bound: Iterable<string> = []): Set<string> {
  const found = new Set<string>();
  const visit = (node: Expression, scope: Set<string>): void => {
    const extend = (...names: Array<string | undefined>) => new Set([...scope, ...names.filter((entry): entry is string => entry !== undefined)]);
    switch (node.t) {
      case 'var': if (!scope.has(node.path[0])) found.add(node.path.join('.')); return;
      case 'lit': case 'impossible': return;
      case 'not': case 'neg': case 'champ': case 'nombre': case 'somme': case 'intégrée':
        visit(node.t === 'somme' || node.t === 'nombre' ? node.l : node.e, scope); return;
      case 'bin': visit(node.l, scope); visit(node.r, scope); return;
      case 'if': visit(node.c, scope); visit(node.a, scope); visit(node.b, scope); return;
      case 'soit': visit(node.e, scope); visit(node.body, extend(node.name)); return;
      case 'selon':
        visit(node.e, scope);
        for (const arm of node.cas) visit(arm.body, extend(arm.variable));
        return;
      case 'forme':
        visit(node.e, scope);
        if (node.garde) visit(node.garde, extend(node.variable));
        return;
      case 'structure': for (const field of node.champs) visit(field.e, scope); return;
      case 'cas': if (node.e) visit(node.e, scope); return;
      case 'liste': for (const item of node.items) visit(item, scope); return;
      case 'extremum': visit(node.l, scope); if (node.vide) visit(node.vide, scope); return;
      case 'existe': case 'pour_tout': case 'transforme': case 'filtre':
        visit(node.l, scope); visit(node.e, extend(node.name)); return;
      case 'contenu_de':
        visit(node.l, scope); visit(node.e, extend(node.name)); if (node.vide) visit(node.vide, scope); return;
      case 'combine':
        visit(node.l, scope); visit(node.init, scope); visit(node.e, extend(node.name, node.acc)); return;
      case 'appel':
        if (!scope.has(node.name)) found.add(node.name);
        for (const arg of node.args) visit(arg, scope);
        return;
      case 'résultat_de': for (const field of node.avec) visit(field.e, scope); return;
    }
  };
  visit(expression, new Set(bound));
  return found;
}

export function printAttributes(attrs: Attributes, indent: string) {
  return Object.entries(attrs).map(([key, values]) => `${indent}#[${key}${values.length ? ` = ${values.map(quote).join(', ')}` : ''}]\n`).join('');
}

export function printRule(rule: Rule, indent = '  ') {
  if (rule.kind === 'assertion') return `${printAttributes(rule.attrs, indent)}${indent}assertion ${printExpression(rule.consequence as Expression)}\n`;
  const head = `${rule.label ? `étiquette ${rule.label} ` : ''}${rule.exception !== undefined ? `exception${rule.exception ? ` ${rule.exception}` : ''} ` : ''}`;
  const args = `${rule.args?.length ? ` de ${rule.args.join(', ')}` : ''}${rule.state !== undefined ? ` état ${rule.state}` : ''}`;
  const condition = rule.condition ? ` sous condition ${printExpression(rule.condition)}` : '';
  const body = rule.kind === 'règle'
    ? `règle ${rule.target.join('.')}${args}${condition} conséquence ${rule.consequence ? '' : 'non '}rempli`
    : `définition ${rule.target.join('.')}${args}${condition ? `${condition} conséquence` : ''} égal à ${printExpression(rule.consequence as Expression)}`;
  return `${printAttributes(rule.attrs, indent)}${indent}${head}${body}\n`;
}

const printItem = (item: DeclarationItem) => {
  if (item.role === 'champ') return `  ${item.name} champ ${item.scope}\n`;
  const parts: string[] = [item.role, item.name, item.type === 'condition' ? 'condition' : `contenu ${item.type}`];
  if (item.args?.length) parts.push(`dépendant de ${item.args.map((arg) => `${arg.name} contenu ${arg.type}`).join(', ')}`);
  for (const state of item.states ?? []) parts.push(`état ${state}`);
  return `  ${parts.join(' ')}\n`;
};

const printDeclaration = (declaration: Declaration) => `${printAttributes(declaration.attrs, '')}déclaration champ d'application ${declaration.scope}:\n${declaration.items.map(printItem).join('')}`;

const printBody = (body: ScopeBody) => `champ d'application ${body.scope}:\n${body.arrondi ? `  date arrondi ${body.arrondi === 'inférieur' ? 'décroissant' : 'croissant'}\n` : ''}${body.rules.map((rule) => printRule(rule)).join('')}`;

export function printCatala(program: CatalaProgram) {
  const structures = program.structures.map((entry) => `déclaration structure ${entry.name}:\n${entry.fields.map((field) => `  donnée ${field.name} contenu ${field.type}\n`).join('')}`);
  const enumerations = program.enumerations.map((entry) => `déclaration énumération ${entry.name}:\n${entry.cases.map((item) => `  -- ${item.name}${item.type ? ` contenu ${item.type}` : ''}\n`).join('')}`);
  const globals = program.globals.map((entry) => `déclaration ${entry.name} contenu ${entry.type}${entry.args.length ? ` dépendant de ${entry.args.map((arg) => `${arg.name} contenu ${arg.type}`).join(', ')}` : ''} égal à ${printExpression(entry.body)}\n`);
  return [...structures, ...enumerations, ...globals, ...program.declarations.map(printDeclaration), ...program.bodies.map(printBody)].join('\n');
}

export function checkTypes(program: CatalaProgram): string[] {
  const messages: string[] = [];
  const structures = new Map(program.structures.map((entry) => [entry.name, entry] as const));
  const enumerations = new Map(program.enumerations.map((entry) => [entry.name, entry] as const));
  const globals = new Map(program.globals.map((entry) => [entry.name, entry] as const));
  const scopes = new Map(program.declarations.map((entry) => [entry.scope, entry] as const));
  const owners = new Map<string, string>();
  for (const entry of program.enumerations) for (const item of entry.cases) if (!owners.has(item.name)) owners.set(item.name, entry.name);
  const normal = (type: string) => (type === 'condition' ? 'booléen' : type);
  const isList = (type: string) => type.startsWith('liste de ');
  const elementOf = (type: string) => type.slice('liste de '.length);
  const known = (type: string): boolean => {
    const plain = normal(type);
    return isList(plain) ? known(elementOf(plain)) : PRIMITIVES.includes(plain) || structures.has(plain) || enumerations.has(plain);
  };
  const compatible = (left: string | null, right: string | null): boolean => {
    if (left === null || right === null || left === right) return true;
    if (left === 'nombre') return NUMERIC_TYPES.includes(right);
    if (right === 'nombre') return NUMERIC_TYPES.includes(left);
    if (isList(left) && isList(right)) return compatible(elementOf(left), elementOf(right));
    return false;
  };
  const numericOf = (left: string, right: string) => (left === 'nombre' ? right : left);
  const orderable = (type: string | null) => type === null || type === 'nombre' || NUMERIC_TYPES.includes(type) || type === 'date' || type === 'durée';

  type Context = { where: string; scope?: Declaration; locals: Map<string, string | null> };
  const report = (where: string, text: string) => { messages.push(`${where} : ${text}.`); };
  const expectType = (where: string, type: string | null, expected: string, operator: string) => {
    if (type !== null && !compatible(type, expected)) report(where, `« ${operator} » attend ${expected === 'booléen' ? 'des booléens' : `un ${expected}`}, reçu ${type}`);
  };

  const itemOf = (scope: Declaration | undefined, name: string) => scope?.items.find((item) => item.role !== 'champ' && item.name === name) as Extract<DeclarationItem, { type: string }> | undefined;
  const resultTypeOf = (scopeName: string, field: string, where: string): string | null => {
    const scope = scopes.get(scopeName);
    const item = scope && !scope.items.every((entry) => entry.role === 'champ') ? itemOf(scope, field) : undefined;
    if (!item) { report(where, `« ${field} » n'est pas une variable de ${scopeName}`); return null; }
    return normal(item.type);
  };
  const fieldType = (type: string | null, field: string, where: string): string | null => {
    if (type === null) return null;
    if (type.startsWith('résultat de ')) return resultTypeOf(type.slice('résultat de '.length), field, where);
    const structure = structures.get(type);
    if (!structure) { report(where, `« ${field} » est lu sur une valeur de type ${type}, qui n'est pas une structure`); return null; }
    const found = structure.fields.find((entry) => entry.name === field);
    if (!found) { report(where, `Champ « ${field} » absent de la structure ${type}`); return null; }
    return normal(found.type);
  };
  const functionOf = (context: Context, name: string) => {
    const item = itemOf(context.scope, name);
    if (item?.args?.length) return { args: item.args, type: normal(item.type) };
    const global = globals.get(name);
    if (global?.args.length) return { args: global.args, type: normal(global.type) };
    return undefined;
  };

  const typeOf = (expression: Expression, context: Context): string | null => {
    const where = context.where;
    const sub = (node: Expression, locals = context.locals) => typeOf(node, { ...context, locals });
    const bind = (names: Array<[string, string | null]>) => new Map([...context.locals, ...names]);
    const element = (list: Expression, operator: string): string | null => {
      const type = sub(list);
      if (type === null) return null;
      if (!isList(type)) { report(where, `« ${operator} » attend une liste, reçu ${type}`); return null; }
      return elementOf(type);
    };
    switch (expression.t) {
      case 'lit': {
        const value = expression.v;
        if (value === null) return null;
        if (typeof value === 'boolean') return 'booléen';
        if (typeof value === 'number') return 'nombre';
        if (typeof value === 'string') return 'date';
        if (Array.isArray(value)) { const first = value.map((entry) => literalType(entry)).find((entry) => entry !== null) ?? null; return first ? `liste de ${first}` : null; }
        if ('structure' in value) return value.structure;
        if ('énumération' in value) return value.énumération;
        return 'durée';
      }
      case 'var': {
        const [head, ...rest] = expression.path;
        let type: string | null;
        let remaining = rest;
        if (context.locals.has(head)) type = context.locals.get(head) ?? null;
        else if (rest.length && context.scope?.items.some((item) => item.role === 'champ' && item.name === head)) {
          const scoped = context.scope.items.find((item) => item.role === 'champ' && item.name === head);
          type = scoped?.role === 'champ' ? resultTypeOf(scoped.scope, rest[0], where) : null;
          remaining = rest.slice(1);
        } else {
          const item = itemOf(context.scope, head);
          const global = globals.get(head);
          if (item) {
            if (item.args?.length) { report(where, `« ${head} » est une fonction : appel attendu`); type = null; } else type = normal(item.type);
          } else if (global) type = normal(global.type);
          else if (owners.has(head)) type = owners.get(head)!;
          else { report(where, `« ${head} » n'est pas déclaré`); type = null; }
        }
        for (const field of remaining) type = fieldType(type, field, where);
        return type;
      }
      case 'not': { const type = sub(expression.e); expectType(where, type, 'booléen', 'non'); return 'booléen'; }
      case 'neg': {
        const type = sub(expression.e);
        if (type !== null && type !== 'nombre' && !NUMERIC_TYPES.includes(type)) report(where, `« - » attend un nombre, reçu ${type}`);
        return type;
      }
      case 'bin': {
        const left = sub(expression.l);
        const right = sub(expression.r);
        const op = expression.op;
        if (op === 'et' || op === 'ou' || op === 'ou bien') { expectType(where, left, 'booléen', op); expectType(where, right, 'booléen', op); return 'booléen'; }
        if (op === '=' || op === '!=') {
          if (!compatible(left, right)) report(where, `« ${op} » compare deux types différents : ${left} et ${right}`);
          return 'booléen';
        }
        if (op === '<' || op === '<=' || op === '>' || op === '>=') {
          if (!orderable(left) || !orderable(right) || !compatible(left, right)) report(where, `« ${op} » attend deux nombres, deux dates ou deux durées, reçu ${left} et ${right}`);
          return 'booléen';
        }
        if (op === 'contient') {
          if (left !== null && !isList(left)) report(where, `« contient » attend une liste, reçu ${left}`);
          else if (left !== null && right !== null && !compatible(elementOf(left), right)) report(where, `« contient » : élément ${right} absent du type de liste ${left}`);
          return 'booléen';
        }
        if (op === '++') {
          if (left !== null && right !== null && !(isList(left) && compatible(left, right))) report(where, `« ++ » attend deux listes de même type, reçu ${left} et ${right}`);
          return left ?? right;
        }
        if (left === null || right === null) return null;
        if (op === '+' || op === '-' || op === '*' || op === '/') {
          if ((left === 'nombre' || NUMERIC_TYPES.includes(left)) && (right === 'nombre' || NUMERIC_TYPES.includes(right)) && compatible(left, right)) return numericOf(left, right);
          if (left === 'durée' && right === 'durée' && (op === '+' || op === '-')) return 'durée';
          if (left === 'date' && right === 'durée' && (op === '+' || op === '-')) return 'date';
          if (left === 'date' && right === 'date' && op === '-') return 'durée';
          report(where, `« ${op} » impossible entre ${left} et ${right}`);
          return null;
        }
        return null;
      }
      case 'if': {
        expectType(where, sub(expression.c), 'booléen', 'si');
        const first = sub(expression.a);
        const second = sub(expression.b);
        if (!compatible(first, second)) report(where, `« si » : les deux branches ont des types différents, ${first} et ${second}`);
        return first ?? second;
      }
      case 'impossible': return null;
      case 'soit': {
        const type = sub(expression.e);
        return typeOf(expression.body, { ...context, locals: bind([[expression.name, type]]) });
      }
      case 'selon': {
        const subject = sub(expression.e);
        const declared = subject !== null ? enumerations.get(subject) : undefined;
        if (subject !== null && !declared) report(where, `« selon » attend une énumération, reçu ${subject}`);
        let result: string | null = null;
        for (const arm of expression.cas) {
          const found = declared?.cases.find((entry) => entry.name === arm.cas);
          if (declared && arm.cas !== null && !found) report(where, `Cas « ${arm.cas} » absent de l'énumération ${declared.name}`);
          const armType = typeOf(arm.body, { ...context, locals: bind(arm.variable ? [[arm.variable, found?.type ? normal(found.type) : null]] : []) });
          if (result === null) result = armType;
          else if (!compatible(result, armType)) report(where, `« selon » : cas de types différents, ${result} et ${armType}`);
        }
        if (declared && !expression.cas.some((arm) => arm.cas === null)) {
          const missing = declared.cases.filter((entry) => !expression.cas.some((arm) => arm.cas === entry.name)).map((entry) => entry.name);
          if (missing.length) report(where, `« selon » : cas non couverts ${missing.join(', ')}`);
        }
        return result;
      }
      case 'forme': {
        const subject = sub(expression.e);
        const declared = subject !== null ? enumerations.get(subject) : undefined;
        if (subject !== null && !declared) report(where, `« sous forme » attend une énumération, reçu ${subject}`);
        const found = declared?.cases.find((entry) => entry.name === expression.cas);
        if (declared && !found) report(where, `Cas « ${expression.cas} » absent de l'énumération ${declared.name}`);
        if (expression.variable || expression.garde) {
          const guarded = typeOf(expression.garde ?? { t: 'lit', v: true }, { ...context, locals: bind(expression.variable ? [[expression.variable, found?.type ? normal(found.type) : null]] : []) });
          expectType(where, guarded, 'booléen', 'et');
        }
        return 'booléen';
      }
      case 'champ': return fieldType(sub(expression.e), expression.name, where);
      case 'structure': {
        const structure = structures.get(expression.name);
        if (!structure) { report(where, `Structure inconnue : ${expression.name}`); for (const field of expression.champs) sub(field.e); return null; }
        for (const field of expression.champs) {
          const declaredField = structure.fields.find((entry) => entry.name === field.name);
          const type = sub(field.e);
          if (!declaredField) report(where, `Champ « ${field.name} » absent de la structure ${structure.name}`);
          else if (!compatible(normal(declaredField.type), type)) report(where, `Champ « ${field.name} » de ${structure.name} attend ${normal(declaredField.type)}, reçu ${type}`);
        }
        const missing = structure.fields.filter((field) => !expression.champs.some((entry) => entry.name === field.name)).map((field) => field.name);
        if (missing.length) report(where, `Champs manquants dans ${structure.name} : ${missing.join(', ')}`);
        return structure.name;
      }
      case 'cas': {
        const owner = owners.get(expression.cas);
        if (!owner) { report(where, `Cas inconnu : ${expression.cas}`); if (expression.e) sub(expression.e); return null; }
        const declared = enumerations.get(owner)!.cases.find((entry) => entry.name === expression.cas)!;
        if (expression.e) {
          if (!declared.type) report(where, `Le cas ${expression.cas} ne porte pas de contenu`);
          else if (!compatible(normal(declared.type), sub(expression.e))) report(where, `Le cas ${expression.cas} attend ${normal(declared.type)}`);
        } else if (declared.type) report(where, `Le cas ${expression.cas} attend un contenu ${normal(declared.type)}`);
        return owner;
      }
      case 'liste': {
        let found: string | null = null;
        for (const item of expression.items) {
          const type = sub(item);
          if (type !== null && !compatible(found, type)) report(where, `Éléments de liste de types différents : ${found} et ${type}`);
          else if (found === null || found === 'nombre') found = type ?? found;
        }
        return found ? `liste de ${found}` : null;
      }
      case 'nombre': element(expression.l, 'nombre de'); return 'entier';
      case 'somme': {
        const type = element(expression.l, `somme ${expression.type}`);
        if (type !== null && !compatible(type, expression.type)) report(where, `« somme ${expression.type} » attend une liste de ${expression.type}, reçu liste de ${type}`);
        return expression.type;
      }
      case 'extremum': {
        const type = element(expression.l, expression.sens);
        if (type !== null && !orderable(type)) report(where, `« ${expression.sens} » attend des nombres, dates ou durées, reçu ${type}`);
        if (expression.vide) { const fallback = sub(expression.vide); if (!compatible(type, fallback)) report(where, `« ou si liste vide » : ${fallback} au lieu de ${type}`); }
        return type;
      }
      case 'existe': case 'pour_tout': {
        const type = element(expression.l, expression.t === 'existe' ? 'existe' : 'pour tout');
        expectType(where, typeOf(expression.e, { ...context, locals: bind([[expression.name, type]]) }), 'booléen', expression.t === 'existe' ? 'tel que' : 'on a');
        return 'booléen';
      }
      case 'transforme': {
        const type = element(expression.l, 'transforme');
        const result = typeOf(expression.e, { ...context, locals: bind([[expression.name, type]]) });
        return result ? `liste de ${result}` : null;
      }
      case 'filtre': {
        const type = element(expression.l, 'liste de');
        expectType(where, typeOf(expression.e, { ...context, locals: bind([[expression.name, type]]) }), 'booléen', 'tel que');
        return type ? `liste de ${type}` : null;
      }
      case 'contenu_de': {
        const type = element(expression.l, 'contenu de');
        typeOf(expression.e, { ...context, locals: bind([[expression.name, type]]) });
        if (expression.vide) { const fallback = sub(expression.vide); if (!compatible(type, fallback)) report(where, `« ou si liste vide » : ${fallback} au lieu de ${type}`); }
        return type;
      }
      case 'combine': {
        const type = element(expression.l, 'combine');
        const init = sub(expression.init);
        const step = typeOf(expression.e, { ...context, locals: bind([[expression.name, type], [expression.acc, init]]) });
        if (!compatible(init, step)) report(where, `« combine » : l'étape produit ${step}, l'initialisation ${init}`);
        return init;
      }
      case 'appel': {
        const found = functionOf(context, expression.name);
        const args = expression.args.map((arg) => sub(arg));
        if (!found) { report(where, `« ${expression.name} » n'est pas une fonction déclarée`); return null; }
        if (found.args.length !== args.length) report(where, `« ${expression.name} » attend ${found.args.length} argument(s), reçu ${args.length}`);
        found.args.forEach((arg, index) => {
          if (args[index] !== undefined && !compatible(normal(arg.type), args[index])) report(where, `Argument ${index + 1} de « ${expression.name} » : attendu ${normal(arg.type)}, reçu ${args[index]}`);
        });
        return found.type;
      }
      case 'intégrée': {
        const type = sub(expression.e);
        const dates = ['accès_jour', 'accès_mois', 'accès_année', 'premier_jour_du_mois', 'dernier_jour_du_mois'].includes(expression.nom);
        if (type !== null && (dates ? type !== 'date' : !(type === 'nombre' || NUMERIC_TYPES.includes(type)))) report(where, `« ${expression.nom} » attend ${dates ? 'une date' : 'un nombre'}, reçu ${type}`);
        const results: Record<string, string> = { arrondi: 'entier', décimal: 'décimal', argent: 'argent', accès_jour: 'entier', accès_mois: 'entier', accès_année: 'entier', premier_jour_du_mois: 'date', dernier_jour_du_mois: 'date' };
        return results[expression.nom] ?? null;
      }
      case 'résultat_de': {
        const scope = scopes.get(expression.scope);
        if (!scope || scope.items.every((item) => item.role === 'champ')) { report(where, `Champ d'application appelable inconnu : ${expression.scope}`); return null; }
        for (const field of expression.avec) {
          const type = sub(field.e);
          const item = itemOf(scope, field.name);
          if (!item) report(where, `« ${field.name} » n'est pas une entrée de ${scope.scope}`);
          else expectType(where, type, normal(item.type), field.name);
        }
        return `résultat de ${expression.scope}`;
      }
    }
  };
  const literalType = (value: ReasoningValue): string | null => (value === null ? null : typeof value === 'boolean' ? 'booléen' : typeof value === 'number' ? 'nombre' : typeof value === 'string' ? 'date' : Array.isArray(value) ? null : 'structure' in value ? value.structure : 'énumération' in value ? value.énumération : 'durée');

  const argumentsOf = (args: Argument[]) => new Map(args.map((arg) => [arg.name, normal(arg.type)] as const));
  for (const structure of program.structures) for (const field of structure.fields) if (!known(field.type)) messages.push(`Type inconnu : ${field.type} (donnée ${structure.name}.${field.name}).`);
  for (const entry of program.enumerations) for (const item of entry.cases) if (item.type && !known(item.type)) messages.push(`Type inconnu : ${item.type} (cas ${entry.name}.${item.name}).`);
  for (const global of program.globals) {
    const where = `déclaration ${global.name}`;
    if (!known(global.type)) messages.push(`${where} : type inconnu ${global.type}.`);
    const type = typeOf(global.body, { where, locals: argumentsOf(global.args) });
    if (!compatible(normal(global.type), type)) report(where, `le corps est de type ${type}, ${normal(global.type)} attendu`);
  }
  for (const declaration of program.declarations) {
    for (const item of declaration.items) {
      if (item.role === 'champ') {
        if (!scopes.has(item.scope)) messages.push(`${declaration.scope} : champ d'application « ${item.scope} » non déclaré.`);
      } else if (!known(item.type)) messages.push(`${declaration.scope}.${item.name} : type inconnu ${item.type}.`);
    }
  }
  for (const body of program.bodies) {
    const scope = scopes.get(body.scope);
    if (!scope) continue;
    for (const rule of body.rules) {
      const target = rule.target.join('.') || 'assertion';
      const where = `${body.scope}.${target}`;
      const item = rule.target.length === 1 ? itemOf(scope, rule.target[0]) : undefined;
      const locals = new Map<string, string | null>();
      if (rule.args && item && rule.args.length !== (item.args?.length ?? 0)) report(where, `${rule.args.length} argument(s) donné(s), ${item.args?.length ?? 0} attendu(s)`);
      rule.args?.forEach((arg, index) => { const declared = item?.args?.[index]; locals.set(arg, declared ? normal(declared.type) : null); });
      const context: Context = { where, scope, locals };
      if (rule.condition) expectType(where, typeOf(rule.condition, context), 'booléen', 'sous condition');
      if (rule.kind === 'assertion') { expectType(where, typeOf(rule.consequence as Expression, context), 'booléen', 'assertion'); continue; }
      if (rule.target.length === 1) {
        if (!item) { report(where, `« ${rule.target[0]} » n'est pas une variable de ${body.scope}`); continue; }
        if (rule.kind === 'règle') {
          if (normal(item.type) !== 'booléen') report(where, `une règle ne pose qu'un booléen, « ${item.name} » est de type ${normal(item.type)}`);
          continue;
        }
        const actual = typeOf(rule.consequence as Expression, context);
        if (!compatible(normal(item.type), actual)) report(where, `valeur de type ${actual} donnée à « ${item.name} » (${normal(item.type)} attendu)`);
        if (item.states?.length) {
          if (rule.state !== undefined && !item.states.includes(rule.state)) report(where, `« ${rule.state} » n'est pas un état de ${item.name}`);
          if (rule.state === undefined) report(where, `définition de « ${item.name} » hors d'un état (écrire « définition ${item.name} état … »)`);
        }
      } else {
        const sub = scope.items.find((entry) => entry.role === 'champ' && entry.name === rule.target[0]);
        if (!sub || sub.role !== 'champ') { report(where, `« ${rule.target[0]} » n'est pas un sous-champ de ${body.scope}`); continue; }
        const subScope = scopes.get(sub.scope);
        const subItem = subScope && itemOf(subScope, rule.target[1]);
        if (!subItem) { report(where, `« ${rule.target[1]} » n'est pas une variable de ${sub.scope}`); continue; }
        if (rule.kind === 'définition') {
          const actual = typeOf(rule.consequence as Expression, context);
          if (!compatible(normal(subItem.type), actual)) report(where, `valeur de type ${actual} donnée à « ${subItem.name} » (${normal(subItem.type)} attendu)`);
        }
      }
    }
    for (const item of scope.items) {
      if (item.role === 'champ' || !item.states?.length) continue;
      for (const state of item.states) {
        if (!body.rules.some((rule) => rule.target.length === 1 && rule.target[0] === item.name && rule.state === state)) messages.push(`${body.scope}.${item.name} : aucune définition dans l'état ${state}.`);
      }
    }
  }
  return messages;
}
