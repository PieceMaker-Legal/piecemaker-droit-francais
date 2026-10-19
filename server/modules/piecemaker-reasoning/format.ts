import { parseExpressionAt } from 'acorn';

export type Ref = { piece: string; citation: string };
export type Basis = { source: string; citation: string; vigueur?: { debut: string; fin: string | null }; applicabilite?: string };
export type Duration = { unite: 'jours' | 'jours_ouvres' | 'mois' | 'ans'; nombre: number };
export type Measure = {
  delai?: { de: string; a: string | null; borne: 'au_plus' | 'au_moins'; duree: Duration };
  montant?: { valeur: string; comparaison: 'plus_de' | 'au_moins' | 'moins_de' | 'au_plus'; seuil: number | string };
};
export type Value = { valeur: string | number; preuve: Ref[] };
export type Condition = { condition?: string; l_une?: Condition[]; mesure?: Measure; selon: Basis[]; decompte: Basis[]; preuve: Ref[]; contredit: Ref[] };
export type Term = { si: Condition[]; sauf: Condition[] };
export type Question = { question: string; reponse: string; date?: { valeur: string; preuve: Ref[] } };
export type Trial = { nom: string; faits: Record<string, boolean | number | string>; attendu: Record<string, boolean> };
export type Reasoning = { questions: Question[]; essais: Trial[]; terms: Map<string, Term>; valeurs: Map<string, Value>; computed: Map<string, Measure> };
export type Problem = { path: string; text: string; avocat?: string; cible?: string };
export type Parsed = { value: unknown; lines: Map<string, number> };

const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RESERVED = new Set(['questions', 'essais', 'bilan', 'valeurs']);
const TERM_KEYS = new Set(['si', 'sauf']);
const CONDITION_KEYS = new Set(['condition', 'l_une', 'delai', 'montant', 'selon', 'decompte', 'preuve', 'contredit']);
const UNITS = ['jours', 'jours_ouvres', 'mois', 'ans'] as const;
const BOUNDS = ['au_plus', 'au_moins'] as const;
const COMPARISONS = ['plus_de', 'au_moins', 'moins_de', 'au_plus'] as const;
const DELAY_SHAPE = 'delai : { de: date_de_départ, a: date_retenue (sinon la date de la question), au_plus ou au_moins: { jours | jours_ouvres | mois | ans: nombre } }';
const AMOUNT_SHAPE = 'montant : { valeur: montant_du_dossier, plus_de | au_moins | moins_de | au_plus: nombre ou autre montant }';
const isDate = (value: unknown): value is string => typeof value === 'string' && DATE.test(value);

export class LiteralError extends Error {
  constructor(message: string, readonly line: number) { super(`ligne ${line} : ${message}`); }
}

type AstNode = { type: string; loc?: { start: { line: number } }; [key: string]: any };

export function parseLiteral(text: string): Parsed {
  const lines = new Map<string, number>();
  const prefix = /^\s*(export\s+default|module\.exports\s*=)\s*/.exec(text);
  const offset = prefix ? prefix[0].length : 0;
  const comments: number[] = [];
  let root: AstNode;
  try {
    root = parseExpressionAt(text, offset, { ecmaVersion: 'latest', locations: true, onComment: (_block, _text, start) => { comments.push(start); } }) as unknown as AstNode;
    const rest = text.slice((root as unknown as { end: number }).end).replace(/^\s*;?\s*/, '');
    if (rest) throw new LiteralError('rien ne doit suivre l’objet', text.slice(0, text.length - rest.length).split('\n').length);
  } catch (error) {
    if (error instanceof LiteralError) throw error;
    const located = error as { message?: string; loc?: { line: number } };
    throw new LiteralError((located.message ?? 'syntaxe invalide').replace(/\s*\(\d+:\d+\)$/, ''), located.loc?.line ?? 1);
  }
  if (comments.length) throw new LiteralError('pas de commentaire : le raisonnement s’écrit uniquement en valeurs', text.slice(0, comments[0]).split('\n').length);
  const fail = (node: AstNode, message: string): never => { throw new LiteralError(message, node.loc?.start.line ?? 1); };
  const convert = (node: AstNode, at: string): unknown => {
    lines.set(at, node.loc?.start.line ?? 1);
    switch (node.type) {
      case 'ObjectExpression': {
        const result: Record<string, unknown> = {};
        for (const property of node.properties as AstNode[]) {
          if (property.type !== 'Property' || property.computed || property.method || property.shorthand || property.kind !== 'init') fail(property, 'propriété attendue sous la forme clé: valeur');
          const key = property.key.type === 'Identifier' ? property.key.name : typeof property.key.value === 'string' ? property.key.value : fail(property, 'clé attendue');
          if (Object.hasOwn(result, key)) fail(property, `clé ${key} écrite deux fois`);
          result[key] = convert(property.value, at ? `${at}.${key}` : key);
        }
        return result;
      }
      case 'ArrayExpression':
        return (node.elements as Array<AstNode | null>).map((element, index) => (element && element.type !== 'SpreadElement' ? convert(element, `${at}[${index}]`) : fail(node, 'élément de liste vide ou étendu')));
      case 'Literal':
        if (node.regex || typeof node.value === 'bigint') fail(node, 'valeur non admise');
        return node.value;
      case 'TemplateLiteral':
        if (node.expressions.length) fail(node, 'pas d’expression ${…} dans une citation');
        return node.quasis[0].value.cooked;
      case 'UnaryExpression':
        if (node.operator === '-' && node.argument.type === 'Literal' && typeof node.argument.value === 'number') return -node.argument.value;
        break;
      case 'Identifier':
        if (node.name === 'vrai') return true;
        if (node.name === 'faux') return false;
        break;
    }
    return fail(node, 'seuls les objets, listes, textes, nombres et vrai/faux sont admis (pas de fonction, d’appel ni de variable)');
  };
  return { value: convert(root, ''), lines };
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const human = (name: string) => { const value = name.replace(/_/g, ' ').replace(/(^|\s)([cdjlmnst]) (?=[aeiouyhàâéèêëîïôûù])/giu, '$1$2’'); return value.charAt(0).toUpperCase() + value.slice(1); };
const text = (value: unknown) => typeof value === 'string' && value.trim() !== '';

export function readReasoning(value: unknown): { reasoning: Reasoning; problems: Problem[] } {
  const problems: Problem[] = [];
  const problem = (path: string, message: string, avocat?: string, cible?: string) => { problems.push({ path, text: message, ...(avocat ? { avocat, cible } : {}) }); };
  const reasoning: Reasoning = { questions: [], essais: [], terms: new Map(), valeurs: new Map(), computed: new Map() };
  if (!isObject(value)) { problem('', 'le raisonnement est un objet { questions: [...], terme: {...} }'); return { reasoning, problems }; }

  const refs = (raw: unknown, path: string): Ref[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { problem(path, 'liste attendue : [{ piece, citation }]'); return []; }
    return raw.flatMap((entry, index) => {
      const at = `${path}[${index}]`;
      if (!isObject(entry) || !text(entry.piece) || !text(entry.citation)) { problem(at, '{ piece: chemin de la pièce, citation: passage exact } attendu'); return []; }
      for (const key of Object.keys(entry)) if (!['piece', 'citation'].includes(key)) problem(`${at}.${key}`, `clé inconnue ${key}`);
      return [{ piece: entry.piece as string, citation: entry.citation as string }];
    });
  };

  const bases = (raw: unknown, path: string): Basis[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { problem(path, 'liste attendue : [{ source, citation, vigueur }]'); return []; }
    return raw.flatMap((entry, index) => {
      const at = `${path}[${index}]`;
      if (!isObject(entry) || !text(entry.source) || !text(entry.citation)) { problem(at, '{ source: identifiant du texte, de la décision ou chemin de la pièce, citation: passage exact } attendu'); return []; }
      for (const key of Object.keys(entry)) if (!['source', 'citation', 'vigueur', 'applicabilite'].includes(key)) problem(`${at}.${key}`, `clé inconnue ${key}`);
      const basis: Basis = { source: (entry.source as string).trim(), citation: entry.citation as string };
      if (entry.applicabilite !== undefined) {
        if (text(entry.applicabilite)) basis.applicabilite = entry.applicabilite as string;
        else problem(`${at}.applicabilite`, 'applicabilite : une phrase disant pourquoi ce texte s’applique au dossier');
      }
      if (entry.vigueur !== undefined) {
        const vigueur = entry.vigueur;
        if (!isObject(vigueur) || typeof vigueur.debut !== 'string' || !DATE.test(vigueur.debut) || !(vigueur.fin === null || vigueur.fin === undefined || (typeof vigueur.fin === 'string' && DATE.test(vigueur.fin)))) problem(`${at}.vigueur`, 'vigueur : { debut: \'AAAA-MM-JJ\', fin: \'AAAA-MM-JJ\' ou null }');
        else basis.vigueur = { debut: vigueur.debut, fin: (vigueur.fin as string | null | undefined) ?? null };
      }
      return [basis];
    });
  };

  const measure = (raw: Record<string, unknown>, path: string): Measure | null => {
    if (raw.delai !== undefined && raw.montant !== undefined) { problem(path, 'une condition porte soit un délai, soit un montant'); return null; }
    if (raw.delai !== undefined) {
      const delay = raw.delai;
      const bounds = isObject(delay) ? BOUNDS.filter((key) => delay[key] !== undefined) : [];
      const duration = bounds.length === 1 && isObject((delay as Record<string, unknown>)[bounds[0]]) ? Object.entries((delay as Record<string, Record<string, unknown>>)[bounds[0]]) : [];
      const [unit, count] = duration[0] ?? [];
      if (!isObject(delay) || typeof delay.de !== 'string' || !IDENTIFIER.test(delay.de) || (delay.a !== undefined && (typeof delay.a !== 'string' || !IDENTIFIER.test(delay.a))) || Object.keys(delay).some((key) => !['de', 'a', ...BOUNDS].includes(key))
        || bounds.length !== 1 || duration.length !== 1 || !(UNITS as readonly string[]).includes(unit) || !Number.isInteger(count) || (count as number) < 0) { problem(`${path}.delai`, DELAY_SHAPE); return null; }
      return { delai: { de: delay.de, a: (delay.a as string | undefined) ?? null, borne: bounds[0], duree: { unite: unit as Duration['unite'], nombre: count as number } } };
    }
    if (raw.montant !== undefined) {
      const amount = raw.montant;
      const comparisons = isObject(amount) ? COMPARISONS.filter((key) => amount[key] !== undefined) : [];
      const threshold = isObject(amount) && comparisons.length === 1 ? amount[comparisons[0]] : undefined;
      if (!isObject(amount) || typeof amount.valeur !== 'string' || !IDENTIFIER.test(amount.valeur) || Object.keys(amount).some((key) => !['valeur', ...COMPARISONS].includes(key))
        || comparisons.length !== 1 || !(typeof threshold === 'number' || (typeof threshold === 'string' && IDENTIFIER.test(threshold)))) { problem(`${path}.montant`, AMOUNT_SHAPE); return null; }
      return { montant: { valeur: amount.valeur, comparaison: comparisons[0], seuil: threshold as number | string } };
    }
    return null;
  };

  const condition = (raw: unknown, path: string, nested: boolean): Condition[] => {
    if (!isObject(raw)) { problem(path, '{ condition: terme, selon: [...] } attendu'); return []; }
    for (const key of Object.keys(raw)) if (!CONDITION_KEYS.has(key)) problem(`${path}.${key}`, `clé inconnue ${key} (admises : ${[...CONDITION_KEYS].join(', ')})`);
    const hasName = raw.condition !== undefined;
    const hasChoice = raw.l_une !== undefined;
    if (hasName === hasChoice) { problem(path, 'une condition porte soit condition: terme, soit l_une: [conditions]'); return []; }
    const result: Condition = { selon: bases(raw.selon, `${path}.selon`), decompte: bases(raw.decompte, `${path}.decompte`), preuve: refs(raw.preuve, `${path}.preuve`), contredit: refs(raw.contredit, `${path}.contredit`) };
    if (hasName) {
      if (typeof raw.condition !== 'string' || !IDENTIFIER.test(raw.condition)) { problem(`${path}.condition`, 'terme en minuscules, lettres, chiffres et _ (ex. retard_de_livraison)'); return []; }
      result.condition = raw.condition;
      const mesure = measure(raw, path);
      if (mesure) {
        if (result.preuve.length || result.contredit.length) problem(path, 'un délai ou un montant se calcule : sa preuve se place dans valeurs, pas sur la condition');
        const known = reasoning.computed.get(raw.condition);
        if (known && JSON.stringify(known) !== JSON.stringify(mesure)) problem(path, `${raw.condition} est calculé de deux façons différentes : garde un seul calcul ou renomme l’un des deux`);
        reasoning.computed.set(raw.condition, mesure);
        result.mesure = mesure;
      }
      if (raw.decompte !== undefined && !mesure?.delai) problem(`${path}.decompte`, 'decompte ne s’emploie qu’avec un délai');
    } else {
      if (raw.delai !== undefined || raw.montant !== undefined) problem(path, 'un délai ou un montant porte un nom : condition: terme');
      if (!Array.isArray(raw.l_une) || raw.l_une.length < 2) { problem(`${path}.l_une`, 'l_une : au moins deux conditions'); return []; }
      if (result.preuve.length || result.contredit.length) problem(path, 'preuve et contredit se placent sur chaque condition de l_une');
      result.l_une = raw.l_une.flatMap((entry, index) => condition(entry, `${path}.l_une[${index}]`, true));
    }
    if (!nested && !result.selon.length) problem(`${path}.selon`, 'condition sans source : ajoute selon: [{ source, citation }]', result.condition ? `${human(result.condition)} : aucun texte ne fonde cette condition.` : 'Une alternative n’est fondée sur aucun texte.', result.condition);
    return [result];
  };

  for (const [key, raw] of Object.entries(value)) {
    if (key === 'bilan') continue;
    if (key === 'questions') {
      if (!Array.isArray(raw) || !raw.length) { problem('questions', 'questions: [{ question, reponse }] attendu'); continue; }
      raw.forEach((entry, index) => {
        const at = `questions[${index}]`;
        if (!isObject(entry) || !text(entry.question) || typeof entry.reponse !== 'string' || !IDENTIFIER.test(entry.reponse)) { problem(at, '{ question: la question posée, reponse: terme qui y répond } attendu'); return; }
        const question: Question = { question: entry.question as string, reponse: entry.reponse };
        if (entry.date !== undefined) {
          const date = entry.date;
          if (!isObject(date) || typeof date.valeur !== 'string' || !DATE.test(date.valeur)) problem(`${at}.date`, 'date : { valeur: \'AAAA-MM-JJ\', preuve: [{ piece, citation }] }');
          else question.date = { valeur: date.valeur, preuve: refs(date.preuve, `${at}.date.preuve`) };
        }
        reasoning.questions.push(question);
      });
      continue;
    }
    if (key === 'valeurs') {
      if (!isObject(raw)) { problem('valeurs', 'valeurs: { nom: { valeur, preuve } } attendu'); continue; }
      for (const [name, entry] of Object.entries(raw)) {
        const at = `valeurs.${name}`;
        if (!IDENTIFIER.test(name) || !isObject(entry) || !(typeof entry.valeur === 'number' || isDate(entry.valeur))) { problem(at, '{ valeur: \'AAAA-MM-JJ\' ou nombre, preuve: [{ piece, citation }] } attendu'); continue; }
        for (const field of Object.keys(entry)) if (!['valeur', 'preuve'].includes(field)) problem(`${at}.${field}`, `clé inconnue ${field} (admises : valeur, preuve)`);
        reasoning.valeurs.set(name, { valeur: entry.valeur as string | number, preuve: refs(entry.preuve, `${at}.preuve`) });
      }
      continue;
    }
    if (key === 'essais') {
      if (!Array.isArray(raw)) { problem('essais', 'essais: [{ nom, faits, attendu }] attendu'); continue; }
      raw.forEach((entry, index) => {
        const at = `essais[${index}]`;
        const booleans = (map: unknown) => isObject(map) && Object.values(map).every((item) => typeof item === 'boolean');
        const facts = (map: unknown) => isObject(map) && Object.values(map).every((item) => typeof item === 'boolean' || typeof item === 'number' || isDate(item));
        if (!isObject(entry) || !text(entry.nom) || !facts(entry.faits) || !booleans(entry.attendu)) { problem(at, '{ nom, faits: { terme: vrai|faux, valeur: \'AAAA-MM-JJ\' ou nombre }, attendu: { terme: vrai|faux } } attendu'); return; }
        reasoning.essais.push({ nom: entry.nom as string, faits: entry.faits as Trial['faits'], attendu: entry.attendu as Record<string, boolean> });
      });
      continue;
    }
    if (!IDENTIFIER.test(key) || RESERVED.has(key)) { problem(key, 'nom de terme invalide'); continue; }
    if (!isObject(raw)) { problem(key, 'un terme est { si: [...], sauf: [...] }'); continue; }
    for (const name of Object.keys(raw)) if (!TERM_KEYS.has(name) && !['statut', 'decisif', 'erreurs', 'manques', 'en_jeu'].includes(name)) problem(`${key}.${name}`, `clé inconnue ${name} (admises : si, sauf)`);
    const list = (field: 'si' | 'sauf') => {
      const entries = raw[field];
      if (entries === undefined) return [];
      if (!Array.isArray(entries)) { problem(`${key}.${field}`, 'liste de conditions attendue'); return []; }
      return entries.flatMap((entry, index) => condition(entry, `${key}.${field}[${index}]`, false));
    };
    const term = { si: list('si'), sauf: list('sauf') };
    if (!term.si.length && !term.sauf.length) problem(key, 'terme sans condition : ajoute si: [...]');
    reasoning.terms.set(key, term);
  }
  for (const [name, mesure] of reasoning.computed) {
    if (reasoning.terms.has(name)) problem(name, `${name} est à la fois un terme et un calcul : renomme l’un des deux`);
    const typed = (names: Array<string | null | number>, check: (value: string | number) => boolean, kind: string) => {
      for (const entry of names) if (typeof entry === 'string' && reasoning.valeurs.has(entry) && !check(reasoning.valeurs.get(entry)!.valeur)) problem(`valeurs.${entry}`, `${entry} sert à ${name} : ${kind} attendu`);
    };
    if (mesure.delai) typed([mesure.delai.de, mesure.delai.a], isDate, 'une date \'AAAA-MM-JJ\'');
    if (mesure.montant) typed([mesure.montant.valeur, mesure.montant.seuil], (value) => typeof value === 'number', 'un nombre');
  }
  if (!reasoning.questions.length && !problems.some((entry) => entry.path === 'questions')) problem('questions', 'ajoute questions: [{ question, reponse }]');
  return { reasoning, problems };
}

const ANNOTATIONS = new Set(['bilan', 'statut', 'decisif', 'erreurs', 'manques', 'en_jeu', 'titre', 'corrigee', 'citation_d_origine', 'en_vigueur', 'personnes', 'fiable', 'nature', 'obtenu', 'conforme', 'decisifs', 'vigueur_legifrance', 'calcul']);

export function stripAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAnnotations);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !ANNOTATIONS.has(key)).map(([key, item]) => [key, stripAnnotations(item)]));
}

export function printLiteral(value: unknown, indent = ''): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (value.every((item) => typeof item !== 'object' || item === null)) return `[${value.map((item) => printLiteral(item)).join(', ')}]`;
    return `[\n${value.map((item) => `${inner}${printLiteral(item, inner)},`).join('\n')}\n${indent}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (!entries.length) return '{}';
    const flat = entries.every(([, item]) => typeof item !== 'object' || item === null || (Array.isArray(item) && item.every((entry) => typeof entry !== 'object')));
    const line = `{ ${entries.map(([key, item]) => `${IDENTIFIER.test(key) ? key : `'${key}'`}: ${printLiteral(item)}`).join(', ')} }`;
    if (flat && line.length + indent.length <= 110) return line;
    return `{\n${entries.map(([key, item]) => `${inner}${IDENTIFIER.test(key) ? key : `'${key}'`}: ${printLiteral(item, inner)},`).join('\n')}\n${indent}}`;
  }
  if (typeof value === 'string') return value.includes('`') ? JSON.stringify(value) : `\`${value.replace(/\\/g, '\\\\').replace(/\$\{/g, '$\\{')}\``;
  return value === true ? 'vrai' : value === false ? 'faux' : String(value);
}
