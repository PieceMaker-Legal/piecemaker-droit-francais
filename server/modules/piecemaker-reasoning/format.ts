import { parseExpressionAt } from 'acorn';

import { readActe } from './acte.js';
import type { Section } from './acte.js';
import { CONTROLS, isControlName, NAME } from './names.js';
import type { ControlSlot } from './names.js';
import { finding } from './rules.js';
import type { Finding } from './rules.js';

export type Ref = { piece: string; citation: string };
export type Target = { piece: string; citation?: string };
export type Basis = { source: string; citation: string; vigueur?: { debut: string; fin: string | null; au?: string }; applicabilite?: string; version?: string; validite?: string; renvoi: Target[] };
export type Duration = { unite: 'jours' | 'jours_ouvres' | 'mois' | 'ans'; nombre: number };
export type Measure = {
  delai?: { de: string; a: string; borne: 'au_plus' | 'au_moins'; duree: Duration };
  montant?: { valeur: string; comparaison: 'plus_de' | 'au_moins' | 'moins_de' | 'au_plus'; seuil: number | string };
};
export const OPERATIONS = ['somme', 'difference', 'produit', 'quotient', 'minimum', 'maximum', 'arrondi'] as const;
export type Operand = number | string | Formula;
export type Formula =
  | { operation: typeof OPERATIONS[number]; termes: Operand[] }
  | { operation: 'bareme'; assiette: Operand; tranches: Array<{ jusqu_a: Operand | null; taux: Operand }> }
  | { operation: 'si'; condition: string; alors: Operand; sinon: Operand };
export type Value = { valeur: string | number | null; preuve: Ref[]; selon: Basis[]; formule?: Formula };
export type Condition = { condition?: string; attendu?: boolean; l_une?: Condition[]; mesure?: Measure; selon: Basis[]; decompte?: string };
export const SIDES = ['true', 'false'] as const;
export type Side = typeof SIDES[number];
export type Foundation = { preuve: Ref[]; selon: Basis[]; si: Condition[] };
export type Term = { si: Condition[]; sauf: Condition[]; fondements?: Record<Side, Foundation[]>; but?: string };
export const VERBS = { obtenir: 'terme', écarter: 'terme', réduire: 'montant', augmenter: 'montant' } as const;
export type Verb = keyof typeof VERBS;
export type Objective = { objectif: string; effet: string; verbe: Verb; validite?: string; prescription?: string };
export type Trial = { nom: string; faits: Record<string, boolean | number | string>; attendu: Record<string, boolean | number> };
export type Reasoning = { qualification?: 'drafting' | 'contentieux' | 'consultation'; objectifs: Objective[]; hypotheses: Trial[]; terms: Map<string, Term>; valeurs: Map<string, Value>; computed: Map<string, Measure>; acte: Section[] };
export type Problem = Finding & { path: string; avocat?: string; cible?: string };
export type Parsed = { value: unknown; lines: Map<string, number> };

const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RESERVED = new Set(['objectifs', 'questions', 'hypotheses', 'essais', 'bilan', 'valeurs', 'qualification', 'acte', 'true', 'false']);
const TERM_KEYS = new Set(['si', 'sauf']);
const CONDITION_KEYS = new Set(['l_une', 'delai', 'montant', 'selon', 'decompte']);
const UNITS = ['jours', 'jours_ouvres', 'mois', 'ans'] as const;
const BOUNDS = ['au_plus', 'au_moins'] as const;
const COMPARISONS = ['plus_de', 'au_moins', 'moins_de', 'au_plus'] as const;
const isDate = (value: unknown): value is string => typeof value === 'string' && DATE.test(value);
export const operands = (formula: Formula): Operand[] => (formula.operation === 'bareme' ? [formula.assiette, ...formula.tranches.flatMap((tranche) => [tranche.jusqu_a, tranche.taux]).filter((item): item is Operand => item !== null)] : formula.operation === 'si' ? [formula.alors, formula.sinon] : formula.termes);
export const formulaNames = (formula: Formula): string[] => operands(formula).flatMap((item) => (typeof item === 'string' ? [item] : typeof item === 'number' ? [] : formulaNames(item)));
export const formulaNumbers = (formula: Formula): number[] => operands(formula).flatMap((item, index) => (typeof item === 'number' ? (formula.operation === 'arrondi' && index === 1 ? [] : [item]) : typeof item === 'string' ? [] : formulaNumbers(item)));
export const formulaConditions = (formula: Formula): string[] => [...(formula.operation === 'si' ? [formula.condition] : []), ...operands(formula).flatMap((item) => (typeof item === 'object' ? formulaConditions(item) : []))];
export { CONTROLS };
export type { ControlSlot };
export const basisControls = (basis: Basis) => [basis.applicabilite, basis.version, basis.validite].filter((name): name is string => Boolean(name));
const CONTROL_PURPOSE: Record<ControlSlot, string> = { applicabilite: 'établit que ce texte s’applique', version: 'établit, par la règle d’application dans le temps, que cette version s’applique au dossier', decompte: 'établit le calcul du délai', validite: 'établit la validité de l’acte ou de la clause', prescription: 'établit que l’action n’est pas prescrite' };

const KEY_HOMES: Record<string, string> = {
  piece: 'une preuve ou un renvoi', citation: 'une preuve ou une source', source: 'une source de selon', vigueur: 'une source de selon', applicabilite: 'une source de selon', version: 'une source de selon', renvoi: 'une source de selon',
  debut: 'vigueur', fin: 'vigueur', au: 'vigueur', preuve: 'un fondement ou une valeur', selon: 'une condition, un fondement ou une valeur', si: 'un terme ou un fondement', sauf: 'un terme',
  l_une: 'une condition', delai: 'une condition', montant: 'une condition', decompte: 'une condition', de: 'un délai', a: 'un délai', au_plus: 'un délai ou un montant', au_moins: 'un délai ou un montant',
  plus_de: 'un montant', moins_de: 'un montant', valeur: 'une valeur ou un montant', formule: 'une valeur', objectif: 'un objectif', obtenir: 'un objectif', écarter: 'un objectif', réduire: 'un objectif', augmenter: 'un objectif',
  validite: 'une source de selon ou un objectif', prescription: 'un objectif', nom: 'une hypothèse', faits: 'une hypothèse', attendu: 'une hypothèse', true: 'une question établie', false: 'une question établie',
};
const ROOT_KEYS = ['qualification', 'objectifs', 'valeurs', 'hypotheses', 'acte'];
const STRUCTURAL = new Set(['piece', 'citation', 'source', 'vigueur', 'applicabilite', 'version', 'renvoi', 'preuve', 'selon', 'si', 'sauf', 'l_une', 'delai', 'montant', 'decompte', 'au_plus', 'au_moins', 'plus_de', 'moins_de', 'valeur', 'formule', 'objectif', 'obtenir', 'écarter', 'réduire', 'augmenter', 'faits', 'attendu']);
const folded = (key: string) => key.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const distance = (left: string, right: string) => {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    previous = current;
  }
  return previous[right.length];
};
const near = (key: string, candidates: string[]) => candidates.find((candidate) => candidate !== key && distance(folded(key), folded(candidate)) <= (candidate.length >= 7 ? 2 : 1));
export const unknownKey = (key: string, admitted: string[]) => {
  const here = `admises ici : ${admitted.join(', ')}`;
  const intended = near(key, admitted);
  if (intended) return `clé inconnue ${key} : écris ${intended} (${here})`;
  if (KEY_HOMES[key]) return `${key} n’a pas sa place ici : c’est une clé d’${KEY_HOMES[key]} ; vérifie son indentation (${here})`;
  const elsewhere = near(key, Object.keys(KEY_HOMES));
  return elsewhere ? `clé inconnue ${key} : ${elsewhere} est une clé d’${KEY_HOMES[elsewhere]} ; corrige le nom et vérifie l’indentation (${here})` : `clé inconnue ${key} (${here})`;
};

const keyFinding = (key: string, admitted: string[]): Finding => {
  const liste = admitted.join(', ');
  const intended = near(key, admitted);
  if (intended) return finding('cle-mal-ecrite', { cle: key, proche: intended });
  if (KEY_HOMES[key]) return finding('cle-mal-placee', { cle: key, bloc: KEY_HOMES[key], liste });
  const elsewhere = near(key, Object.keys(KEY_HOMES));
  return elsewhere ? finding('cle-mal-ecrite-et-placee', { cle: key, proche: elsewhere, bloc: KEY_HOMES[elsewhere] }) : finding('cle-non-reconnue', { cle: key, liste });
};

export class LiteralError extends Error {
  constructor(message: string, readonly line: number, readonly found?: Finding) { super(`ligne ${line} : ${message}`); }
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
  const problem = (path: string, found: Finding, avocat?: string, cible?: string) => { problems.push({ ...found, path, ...(avocat ? { avocat, cible } : {}) }); };
  const reasoning: Reasoning = { objectifs: [], hypotheses: [], terms: new Map(), valeurs: new Map(), computed: new Map(), acte: [] };
  const dated: Array<{ at: string; name: string }> = [];
  const controls: Array<{ slot: ControlSlot; name: string; at: string }> = [];
  const control = (slot: ControlSlot, raw: unknown, at: string): string | undefined => {
    if (typeof raw !== 'string' || !NAME.test(raw)) { problem(at, finding('controle-mal-nomme', { controle: slot, objet: CONTROL_PURPOSE[slot] })); return undefined; }
    if (!isControlName(raw, slot)) { problem(at, finding('prefixe-de-controle-omis', { controle: slot, prefixe: CONTROLS[slot] })); return undefined; }
    controls.push({ slot, name: raw, at });
    return raw;
  };
  if (!isObject(value)) { problem('', finding('raisonnement-mal-forme')); return { reasoning, problems }; }

  const refs = (raw: unknown, path: string): Ref[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { problem(path, finding('preuve-mal-formee')); return []; }
    return raw.flatMap((entry, index) => {
      const at = `${path}[${index}]`;
      if (isObject(entry)) for (const key of Object.keys(entry)) if (!['piece', 'citation'].includes(key)) problem(`${at}.${key}`, keyFinding(key, ['piece', 'citation']));
      if (!isObject(entry) || !text(entry.piece) || !text(entry.citation)) { problem(at, finding('preuve-mal-formee')); return []; }
      return [{ piece: entry.piece as string, citation: entry.citation as string }];
    });
  };

  const targets = (raw: unknown, path: string): Target[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { problem(path, finding('renvoi-mal-forme')); return []; }
    return raw.flatMap((entry, index) => {
      const at = `${path}[${index}]`;
      if (!isObject(entry) || !text(entry.piece) || (entry.citation !== undefined && !text(entry.citation)) || Object.keys(entry).some((key) => !['piece', 'citation'].includes(key))) { problem(at, finding('renvoi-mal-forme')); return []; }
      return [{ piece: entry.piece as string, ...(entry.citation !== undefined ? { citation: entry.citation as string } : {}) }];
    });
  };

  const operand = (item: unknown, path: string): Operand | null => (typeof item === 'number' ? item : typeof item === 'string' && NAME.test(item) ? item : formula(item, path));
  const formula = (raw: unknown, path: string): Formula | null => {
    if (isObject(raw) && raw.si !== undefined) {
      if (typeof raw.si !== 'string' || !NAME.test(raw.si) || raw.alors === undefined || raw.sinon === undefined || Object.keys(raw).some((key) => !['si', 'alors', 'sinon'].includes(key))) { problem(path, finding('formule-mal-formee')); return null; }
      const alors = operand(raw.alors, `${path}.alors`);
      const sinon = operand(raw.sinon, `${path}.sinon`);
      return alors === null || sinon === null ? null : { operation: 'si', condition: raw.si, alors, sinon };
    }
    const operations = isObject(raw) ? Object.keys(raw) : [];
    if (operations.length === 1 && operations[0] === 'bareme') {
      const scale = (raw as Record<string, unknown>).bareme;
      const tranches = isObject(scale) && Array.isArray(scale.tranches) ? scale.tranches : [];
      const valid = isObject(scale) && scale.assiette !== undefined && tranches.length > 0 && Object.keys(scale).every((key) => ['assiette', 'tranches'].includes(key))
        && tranches.every((tranche, index) => isObject(tranche) && tranche.taux !== undefined && (index === tranches.length - 1 ? tranche.jusqu_a === undefined : tranche.jusqu_a !== undefined) && Object.keys(tranche).every((key) => ['jusqu_a', 'taux'].includes(key)));
      if (!valid) { problem(`${path}.bareme`, finding('bareme-mal-forme')); return null; }
      const assiette = operand((scale as Record<string, unknown>).assiette, `${path}.bareme.assiette`);
      const parsed = tranches.map((tranche, index) => ({ jusqu_a: (tranche as Record<string, unknown>).jusqu_a === undefined ? null : operand((tranche as Record<string, unknown>).jusqu_a, `${path}.bareme.tranches[${index}].jusqu_a`), taux: operand((tranche as Record<string, unknown>).taux, `${path}.bareme.tranches[${index}].taux`) }));
      if (assiette === null || parsed.some((tranche, index) => tranche.taux === null || (tranche.jusqu_a === null && index < parsed.length - 1))) return null;
      return { operation: 'bareme', assiette, tranches: parsed as Array<{ jusqu_a: Operand | null; taux: Operand }> };
    }
    const operation = operations[0] as typeof OPERATIONS[number];
    const list = isObject(raw) ? raw[operation] : undefined;
    if (operations.length !== 1 || !(OPERATIONS as readonly string[]).includes(operation) || !Array.isArray(list) || list.length < 2 || (operation === 'arrondi' && (list.length !== 2 || !Number.isInteger(list[1])))) { problem(path, finding('formule-mal-formee')); return null; }
    const termes = list.map((item, index) => operand(item, `${path}.${operation}[${index}]`));
    if (termes.some((item) => item === null)) return null;
    return { operation, termes: termes as Operand[] };
  };

  const bases = (raw: unknown, path: string): Basis[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { problem(path, finding('source-mal-formee')); return []; }
    return raw.flatMap((entry, index) => {
      const at = `${path}[${index}]`;
      if (isObject(entry)) for (const key of Object.keys(entry)) if (!['source', 'citation', 'vigueur', 'applicabilite', 'version', 'validite', 'renvoi'].includes(key)) problem(`${at}.${key}`, key === 'contredit' ? finding('contredit-retire', { nom: 'nom' }) : keyFinding(key, ['source', 'citation', 'vigueur', 'applicabilite', 'version', 'validite', 'renvoi']));
      if (!isObject(entry) || !text(entry.source) || !text(entry.citation)) { problem(at, finding('source-mal-formee')); return []; }
      const basis: Basis = { source: (entry.source as string).trim(), citation: entry.citation as string, renvoi: targets(entry.renvoi, `${at}.renvoi`) };
      if (entry.applicabilite !== undefined) {
        const name = control('applicabilite', entry.applicabilite, `${at}.applicabilite`);
        if (name) basis.applicabilite = name;
      }
      if (entry.version !== undefined) {
        const name = control('version', entry.version, `${at}.version`);
        if (name) basis.version = name;
      }
      if (entry.validite !== undefined) {
        const name = control('validite', entry.validite, `${at}.validite`);
        if (name) basis.validite = name;
      }
      if (entry.vigueur !== undefined) {
        const vigueur = entry.vigueur;
        if (!isObject(vigueur) || typeof vigueur.debut !== 'string' || !DATE.test(vigueur.debut) || !(vigueur.fin === null || vigueur.fin === undefined || (typeof vigueur.fin === 'string' && DATE.test(vigueur.fin))) || Object.keys(vigueur).some((key) => !['debut', 'fin', 'au'].includes(key))) problem(`${at}.vigueur`, finding('vigueur-mal-formee'));
        else {
          basis.vigueur = { debut: vigueur.debut, fin: (vigueur.fin as string | null | undefined) ?? null };
          if (vigueur.au !== undefined) {
            if (typeof vigueur.au === 'string' && NAME.test(vigueur.au)) { basis.vigueur.au = vigueur.au; dated.push({ at: `${at}.vigueur.au`, name: vigueur.au }); }
            else problem(`${at}.vigueur.au`, finding('date-vigueur-mal-nommee'));
          }
        }
      }
      return [basis];
    });
  };

  const measure = (raw: Record<string, unknown>, path: string): Measure | null => {
    if (raw.delai !== undefined && raw.montant !== undefined) { problem(path, finding('delai-et-montant-melanges')); return null; }
    if (raw.delai !== undefined) {
      const delay = raw.delai;
      const bounds = isObject(delay) ? BOUNDS.filter((key) => delay[key] !== undefined) : [];
      const duration = bounds.length === 1 && isObject((delay as Record<string, unknown>)[bounds[0]]) ? Object.entries((delay as Record<string, Record<string, unknown>>)[bounds[0]]) : [];
      const [unit, count] = duration[0] ?? [];
      if (!isObject(delay) || typeof delay.de !== 'string' || !NAME.test(delay.de) || typeof delay.a !== 'string' || !NAME.test(delay.a) || Object.keys(delay).some((key) => !['de', 'a', ...BOUNDS].includes(key))
        || bounds.length !== 1 || duration.length !== 1 || !(UNITS as readonly string[]).includes(unit) || !Number.isInteger(count) || (count as number) < 0) { problem(`${path}.delai`, finding('delai-mal-forme')); return null; }
      return { delai: { de: delay.de, a: delay.a, borne: bounds[0], duree: { unite: unit as Duration['unite'], nombre: count as number } } };
    }
    if (raw.montant !== undefined) {
      const amount = raw.montant;
      const comparisons = isObject(amount) ? COMPARISONS.filter((key) => amount[key] !== undefined) : [];
      const threshold = isObject(amount) && comparisons.length === 1 ? amount[comparisons[0]] : undefined;
      if (!isObject(amount) || typeof amount.valeur !== 'string' || !NAME.test(amount.valeur) || Object.keys(amount).some((key) => !['valeur', ...COMPARISONS].includes(key))
        || comparisons.length !== 1 || !(typeof threshold === 'number' || (typeof threshold === 'string' && NAME.test(threshold)))) { problem(`${path}.montant`, finding('montant-mal-forme')); return null; }
      return { montant: { valeur: amount.valeur, comparaison: comparisons[0], seuil: threshold as number | string } };
    }
    return null;
  };

  const condition = (raw: unknown, path: string, nested: boolean): Condition[] => {
    if (!isObject(raw)) { problem(path, finding('condition-mal-formee')); return []; }
    if (raw.condition !== undefined) { problem(`${path}.condition`, finding('condition-retiree', { nom: typeof raw.condition === 'string' && NAME.test(raw.condition) ? raw.condition : 'nom' })); return []; }
    if (raw.contredit !== undefined) problem(`${path}.contredit`, finding('contredit-retire', { nom: 'nom' }));
    if (raw.preuve !== undefined) problem(`${path}.preuve`, finding('preuve-deplacee'));
    const names = Object.keys(raw).filter((key) => !CONDITION_KEYS.has(key) && key !== 'contredit' && key !== 'preuve');
    const hasChoice = raw.l_une !== undefined;
    if (hasChoice === (names.length > 0)) { problem(path, finding(hasChoice ? 'l-une-nommee' : 'condition-mal-formee')); return []; }
    const stray = names.filter((name) => STRUCTURAL.has(name) || near(name, [...CONDITION_KEYS]));
    if (names.length > 1 && stray.length) { for (const name of stray) problem(`${path}.${name}`, keyFinding(name, [...CONDITION_KEYS])); return []; }
    if (names.length > 1) { problem(path, finding('condition-multiple')); return []; }
    const result: Condition = { selon: bases(raw.selon, `${path}.selon`) };
    if (!hasChoice) {
      const name = names[0];
      const expected = raw[name];
      if (!NAME.test(name)) { problem(`${path}.${name}`, finding('condition-mal-nommee')); return []; }
      if (typeof expected !== 'boolean') { problem(`${path}.${name}`, finding('condition-sans-booleen', { nom: name })); return []; }
      result.condition = name;
      result.attendu = expected;
      const mesure = measure(raw, path);
      if (mesure) {
        const known = reasoning.computed.get(name);
        if (known && JSON.stringify(known) !== JSON.stringify(mesure)) problem(path, finding('calcul-duplique', { nom: name }));
        reasoning.computed.set(name, mesure);
        result.mesure = mesure;
      }
      if (raw.decompte !== undefined && !mesure?.delai) problem(`${path}.decompte`, finding('decompte-sans-delai'));
      else if (raw.decompte !== undefined) result.decompte = control('decompte', raw.decompte, `${path}.decompte`);
    } else {
      if (raw.delai !== undefined || raw.montant !== undefined) problem(path, finding('mesure-non-nommee'));
      if (!Array.isArray(raw.l_une) || raw.l_une.length < 2) { problem(`${path}.l_une`, finding('l-une-incomplete')); return []; }
      result.l_une = raw.l_une.flatMap((entry, index) => condition(entry, `${path}.l_une[${index}]`, true));
    }
    if (!nested && !result.selon.length) problem(`${path}.selon`, finding('selon-non-indique'), result.condition ? `${human(result.condition)} : aucun texte ne fonde cette condition.` : 'Une alternative n’est fondée sur aucun texte.', result.condition);
    return [result];
  };

  const foundation = (raw: unknown, path: string): Foundation[] => {
    if (!isObject(raw)) { problem(path, finding('fondement-mal-forme')); return []; }
    for (const key of Object.keys(raw)) if (!['preuve', 'selon', 'si'].includes(key)) problem(`${path}.${key}`, key === 'contredit' ? finding('contredit-retire', { nom: 'nom' }) : keyFinding(key, ['preuve', 'selon', 'si']));
    const result: Foundation = { preuve: refs(raw.preuve, `${path}.preuve`), selon: bases(raw.selon, `${path}.selon`), si: [] };
    if (!result.preuve.length && !result.selon.length) problem(path, finding('fondement-mal-forme'));
    if (raw.si !== undefined) {
      if (!Array.isArray(raw.si)) problem(`${path}.si`, finding('conditions-mal-formees'));
      else result.si = raw.si.flatMap((entry, index) => condition(entry, `${path}.si[${index}]`, true));
    }
    return [result];
  };

  for (const [key, raw] of Object.entries(value)) {
    if (key === 'bilan') continue;
    if (key === 'questions') { problem('questions', finding('questions-renommee')); continue; }
    if (key === 'objectifs') {
      if (!Array.isArray(raw) || !raw.length) { problem('objectifs', finding('objectifs-mal-formes')); continue; }
      raw.forEach((entry, index) => {
        const at = `objectifs[${index}]`;
        if (!isObject(entry) || !text(entry.objectif)) { problem(at, finding('objectifs-mal-formes')); return; }
        const verbs = (Object.keys(VERBS) as Verb[]).filter((verb) => entry[verb] !== undefined);
        if (verbs.length !== 1) { problem(at, finding(verbs.length ? 'verbe-duplique' : 'verbe-non-indique')); return; }
        const effet = entry[verbs[0]];
        if (typeof effet !== 'string' || !NAME.test(effet)) { problem(`${at}.${verbs[0]}`, finding('cible-mal-nommee', { verbe: verbs[0] })); return; }
        for (const field of Object.keys(entry)) if (!['objectif', ...verbs, 'validite', 'prescription'].includes(field)) problem(`${at}.${field}`, field === 'question' ? finding('question-renommee') : field === 'reponse' ? finding('reponse-remplacee') : keyFinding(field, ['objectif', ...Object.keys(VERBS), 'validite', 'prescription']));
        const objective: Objective = { objectif: entry.objectif as string, effet, verbe: verbs[0] };
        for (const slot of ['validite', 'prescription'] as const) {
          if (entry[slot] === undefined) continue;
          if (entry[slot] === effet) { problem(`${at}.${slot}`, finding('controle-duplique', { controle: slot })); continue; }
          objective[slot] = control(slot, entry[slot], `${at}.${slot}`);
        }
        reasoning.objectifs.push(objective);
      });
      continue;
    }
    if (key === 'qualification') {
      if (raw === 'drafting' || raw === 'contentieux' || raw === 'consultation') reasoning.qualification = raw;
      else problem('qualification', finding('qualification-non-admise'));
      continue;
    }
    if (key === 'valeurs') {
      if (!isObject(raw)) { problem('valeurs', finding('valeurs-mal-formees')); continue; }
      for (const [name, entry] of Object.entries(raw)) {
        const at = `valeurs.${name}`;
        const computedOnly = isObject(entry) && entry.valeur === undefined && entry.formule !== undefined;
        if (!NAME.test(name) || !isObject(entry) || !(computedOnly || typeof entry.valeur === 'number' || isDate(entry.valeur) || entry.valeur === null)) { problem(at, finding('valeur-mal-formee')); continue; }
        for (const field of Object.keys(entry)) if (!['valeur', 'preuve', 'selon', 'formule'].includes(field)) problem(`${at}.${field}`, field === 'contredit' ? finding('contredit-retire', { nom: name }) : keyFinding(field, ['valeur', 'preuve', 'selon', 'formule']));
        const value: Value = { valeur: computedOnly ? null : entry.valeur as string | number | null, preuve: refs(entry.preuve, `${at}.preuve`), selon: bases(entry.selon, `${at}.selon`) };
        value.selon.forEach((basis, index) => { if (basis.validite) problem(`${at}.selon[${index}].validite`, finding('validite-mal-placee')); });
        if (entry.formule !== undefined) {
          const parsed = formula(entry.formule, `${at}.formule`);
          if (parsed) value.formule = parsed;
          if (typeof entry.valeur === 'string') problem(`${at}.formule`, finding('formule-sur-date'));
        }
        reasoning.valeurs.set(name, value);
      }
      continue;
    }
    if (key === 'acte') {
      const read = readActe(raw);
      reasoning.acte = read.sections;
      for (const entry of read.problems) problem(entry.path, entry);
      continue;
    }
    if (key === 'essais') { problem('essais', finding('essais-renommee')); continue; }
    if (key === 'hypotheses') {
      if (!Array.isArray(raw)) { problem('hypotheses', finding('hypotheses-mal-formees')); continue; }
      raw.forEach((entry, index) => {
        const at = `hypotheses[${index}]`;
        const booleans = (map: unknown) => isObject(map) && Object.values(map).every((item) => typeof item === 'boolean' || typeof item === 'number');
        const facts = (map: unknown) => isObject(map) && Object.values(map).every((item) => typeof item === 'boolean' || typeof item === 'number' || isDate(item));
        if (!isObject(entry) || !text(entry.nom) || !facts(entry.faits) || !booleans(entry.attendu)) { problem(at, finding('hypothese-mal-formee')); return; }
        reasoning.hypotheses.push({ nom: entry.nom as string, faits: entry.faits as Trial['faits'], attendu: entry.attendu as Trial['attendu'] });
      });
      continue;
    }
    const rootIntended = near(key, ROOT_KEYS);
    if (rootIntended) { problem(key, finding('cle-mal-ecrite', { cle: key, proche: rootIntended })); continue; }
    if (STRUCTURAL.has(key)) { problem(key, finding('cle-mal-placee', { cle: key, bloc: KEY_HOMES[key], liste: ROOT_KEYS.join(', ') })); continue; }
    if (!NAME.test(key) || RESERVED.has(key)) { problem(key, RESERVED.has(key) ? finding('nom-reserve', { nom: key }) : finding('terme-mal-nomme')); continue; }
    if (!isObject(raw)) { problem(key, finding('terme-mal-forme')); continue; }
    const rule = (raw.si !== undefined || raw.sauf !== undefined);
    const sided = raw.true !== undefined || raw.false !== undefined;
    if (rule && sided) { problem(key, finding('terme-et-question-melanges')); continue; }
    const annotations = ['statut', 'decisif', 'erreurs', 'manques', 'en_jeu'];
    if (sided) {
      for (const name of Object.keys(raw)) if (!SIDES.includes(name as Side) && !annotations.includes(name)) problem(`${key}.${name}`, keyFinding(name, [...SIDES]));
      const fondements: Record<Side, Foundation[]> = { true: [], false: [] };
      for (const side of SIDES) {
        const entries = raw[side];
        if (entries === undefined) continue;
        if (!Array.isArray(entries) || !entries.length) { problem(`${key}.${side}`, finding('fondements-mal-formes')); continue; }
        fondements[side] = entries.flatMap((entry, index) => foundation(entry, `${key}.${side}[${index}]`));
      }
      if (!fondements.true.length && !fondements.false.length) problem(key, finding('question-sans-fondement'));
      reasoning.terms.set(key, { si: [], sauf: [], fondements });
      continue;
    }
    for (const name of Object.keys(raw)) if (!TERM_KEYS.has(name) && name !== 'but' && !annotations.includes(name)) problem(`${key}.${name}`, keyFinding(name, [...TERM_KEYS, 'but']));
    if (raw.but !== undefined && !text(raw.but)) problem(`${key}.but`, finding('but-mal-ecrit'));
    const list = (field: 'si' | 'sauf') => {
      const entries = raw[field];
      if (entries === undefined) return [];
      if (!Array.isArray(entries)) { problem(`${key}.${field}`, finding('conditions-mal-formees')); return []; }
      return entries.flatMap((entry, index) => condition(entry, `${key}.${field}[${index}]`, false));
    };
    const term = { si: list('si'), sauf: list('sauf'), ...(text(raw.but) ? { but: (raw.but as string).trim() } : {}) };
    if (!term.si.length && !term.sauf.length) problem(key, finding('terme-sans-condition'));
    reasoning.terms.set(key, term);
  }
  for (const [name, mesure] of reasoning.computed) {
    if (reasoning.terms.has(name)) problem(name, finding('nom-duplique', { nom: name }));
    const typed = (names: Array<string | null | number>, check: (value: string | number) => boolean, kind: string) => {
      for (const entry of names) if (typeof entry === 'string' && reasoning.valeurs.has(entry) && reasoning.valeurs.get(entry)!.valeur !== null && !check(reasoning.valeurs.get(entry)!.valeur!)) problem(`valeurs.${entry}`, finding('type-de-valeur-errone', { nom: entry, calcul: name, type: kind }));
    };
    if (mesure.delai) typed([mesure.delai.de, mesure.delai.a], isDate, 'une date AAAA-MM-JJ');
    if (mesure.montant) typed([mesure.montant.valeur, mesure.montant.seuil], (value) => typeof value === 'number', 'un nombre');
  }
  for (const { at, name } of dated) if (reasoning.valeurs.has(name) && reasoning.valeurs.get(name)!.valeur !== null && !isDate(reasoning.valeurs.get(name)!.valeur)) problem(`valeurs.${name}`, finding('date-erronee', { nom: name, emploi: at }));
  for (const name of reasoning.terms.keys()) {
    const slot = (Object.keys(CONTROLS) as ControlSlot[]).find((key) => isControlName(name, key));
    if (slot && !controls.some((entry) => entry.slot === slot && entry.name === name)) problem(name, finding('controle-mal-rattache', { nom: name, controle: slot, bloc: slot === 'applicabilite' || slot === 'version' ? 'la source' : slot === 'decompte' ? 'le délai' : slot === 'validite' ? 'l’objectif ou la clause' : 'l’objectif' }));
  }
  for (const { name, at } of controls) if (!reasoning.terms.has(name)) problem(at, finding('controle-non-defini', { nom: name }));
  const reaches = (origin: string, current: string, seen: Set<string>): boolean => {
    const next = reasoning.valeurs.get(current)?.formule ? formulaNames(reasoning.valeurs.get(current)!.formule!) : [];
    return next.some((name) => name === origin || (!seen.has(name) && reaches(origin, name, seen.add(name))));
  };
  for (const [name, entry] of reasoning.valeurs) {
    if (!entry.formule) continue;
    if (reaches(name, name, new Set())) problem(`valeurs.${name}.formule`, finding('formule-circulaire', { nom: name }));
    for (const condition of formulaConditions(entry.formule)) if (reasoning.valeurs.has(condition)) problem(`valeurs.${name}.formule`, finding('condition-de-formule-erronee', { nom: condition }));
    for (const operand of formulaNames(entry.formule)) if (reasoning.valeurs.has(operand) && typeof reasoning.valeurs.get(operand)!.valeur === 'string') problem(`valeurs.${operand}`, finding('formule-sur-texte', { nom: operand, calcul: name }));
  }
  if (!reasoning.objectifs.length && !problems.some((entry) => entry.path === 'objectifs' || entry.path === 'questions')) problem('objectifs', finding('objectifs-mal-formes'));
  return { reasoning, problems };
}

const ANNOTATIONS = new Set(['bilan', 'montant_calcule', 'statut', 'decisif', 'erreurs', 'manques', 'en_jeu', 'atteint', 'obstacles', 'titre', 'corrigee', 'citation_d_origine', 'en_vigueur', 'personnes', 'fiable', 'nature', 'obtenu', 'conforme', 'decisifs', 'vigueur_legifrance', 'calcul', 'correspondance']);

const KEY_ORDER = ['qualification', 'objectifs', 'objectif', 'obtenir', 'écarter', 'réduire', 'augmenter', 'true', 'false', 'l_une', 'delai', 'montant', 'de', 'a', 'valeur', 'formule', 'but', 'si', 'alors', 'sinon', 'assiette', 'tranches', 'jusqu_a', 'taux', 'source', 'piece', 'citation', 'vigueur', 'debut', 'fin', 'au', 'selon', 'applicabilite', 'version', 'validite', 'renvoi', 'decompte', 'validite', 'prescription', 'preuve', 'sauf', 'nom', 'faits', 'attendu', 'id', 'intitule', 'traite', 'conflit', 'sur', 'modele', 'avocat', 'texte', 'sections'];
const rank = (key: string) => { const at = KEY_ORDER.indexOf(key); return at < 0 ? KEY_ORDER.length : at; };
const ordered = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(ordered);
  if (!isObject(value)) return value;
  const conditionLike = Object.keys(value).some((key) => CONDITION_KEYS.has(key));
  const place = (key: string, item: unknown) => (conditionLike && typeof item === 'boolean' && !KEY_ORDER.includes(key) ? -1 : rank(key));
  return Object.fromEntries(Object.entries(value).map(([key, item], index) => ({ key, item, index })).sort((x, y) => place(x.key, x.item) - place(y.key, y.item) || x.index - y.index).map(({ key, item }) => [key, ordered(item)]));
};

export function canonical(annotated: Record<string, unknown>, reasoning: Reasoning): Record<string, unknown> {
  const order: string[] = [];
  const pending: Array<{ slot: ControlSlot; name: string }> = [];
  const slots = Object.keys(CONTROLS) as ControlSlot[];
  const visit = (name: string) => {
    const term = reasoning.terms.get(name);
    if (!term || order.includes(name)) return;
    order.push(name);
    const bases = (list: Basis[]) => {
      for (const basis of list) {
        if (basis.applicabilite) pending.push({ slot: 'applicabilite', name: basis.applicabilite });
        if (basis.version) pending.push({ slot: 'version', name: basis.version });
        if (basis.validite) pending.push({ slot: 'validite', name: basis.validite });
      }
    };
    const walk = (condition: Condition) => {
      bases(condition.selon);
      if (condition.decompte) pending.push({ slot: 'decompte', name: condition.decompte });
      if (condition.l_une) condition.l_une.forEach(walk); else visit(condition.condition!);
    };
    [...term.si, ...term.sauf].forEach(walk);
    for (const side of SIDES) for (const entry of term.fondements?.[side] ?? []) { bases(entry.selon); entry.si.forEach(walk); }
  };
  for (const objective of reasoning.objectifs) visit(objective.effet);
  for (const objective of reasoning.objectifs) for (const slot of ['validite', 'prescription'] as const) if (objective[slot]) pending.push({ slot, name: objective[slot]! });
  while (pending.length) {
    pending.sort((x, y) => slots.indexOf(x.slot) - slots.indexOf(y.slot));
    visit(pending.shift()!.name);
  }
  const keys = ['qualification', 'objectifs', ...order, ...Object.keys(annotated).filter((key) => !order.includes(key) && !['qualification', 'objectifs', 'valeurs', 'hypotheses', 'acte'].includes(key)), 'valeurs', 'hypotheses', 'acte'];
  return Object.fromEntries(keys.filter((key) => key in annotated).map((key) => [key, ordered(annotated[key])]));
}

export function stripAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripAnnotations);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !ANNOTATIONS.has(key)).map(([key, item]) => [key, stripAnnotations(item)]));
}

const inline = (value: unknown): boolean => (Array.isArray(value) ? value.every((item) => !isObject(item) && !Array.isArray(item) && !(typeof item === 'string' && item.length > 60)) : isObject(value) ? Object.values(value).every(inline) : true);
const quote = (value: string) => (/['\\\n]/.test(value) ? (value.includes('`') ? JSON.stringify(value) : `\`${value.replace(/\\/g, '\\\\').replace(/\$\{/g, '$\\{')}\``) : `'${value}'`);
const keyOf = (key: string) => (IDENTIFIER.test(key) ? key : `'${key}'`);

export function printLiteral(value: unknown, indent = ''): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    if (inline(value)) return `[${value.map((item) => printLiteral(item)).join(', ')}]`;
    return `[\n${value.map((item) => `${inner}${printLiteral(item, inner)},`).join('\n')}\n${indent}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined);
    if (!entries.length) return '{}';
    if (inline(value)) return `{ ${entries.map(([key, item]) => `${keyOf(key)}: ${printLiteral(item)}`).join(', ')} }`;
    return `{\n${entries.map(([key, item]) => `${inner}${keyOf(key)}: ${printLiteral(item, inner)},`).join('\n')}\n${indent}}`;
  }
  if (typeof value === 'string') return quote(value);
  return value === true ? 'vrai' : value === false ? 'faux' : String(value);
}
