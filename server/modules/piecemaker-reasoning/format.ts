import { parseExpressionAt } from 'acorn';

import { readActe } from './acte.js';
import type { Section } from './acte.js';

export type Ref = { piece: string; citation: string };
export type Target = { piece: string; citation?: string };
export type Basis = { source: string; citation: string; vigueur?: { debut: string; fin: string | null; au?: string }; applicabilite?: string; validite?: string; renvoi: Target[] };
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
export type Term = { si: Condition[]; sauf: Condition[]; fondements?: Record<Side, Foundation[]> };
export const VERBS = { obtenir: 'terme', écarter: 'terme', réduire: 'montant', augmenter: 'montant' } as const;
export type Verb = keyof typeof VERBS;
export type Objective = { objectif: string; effet: string; verbe: Verb; validite?: string; prescription?: string };
export type Trial = { nom: string; faits: Record<string, boolean | number | string>; attendu: Record<string, boolean | number> };
export type Reasoning = { qualification?: 'drafting' | 'contentieux' | 'consultation'; objectifs: Objective[]; hypotheses: Trial[]; terms: Map<string, Term>; valeurs: Map<string, Value>; computed: Map<string, Measure>; acte: Section[] };
export type Problem = { path: string; text: string; avocat?: string; cible?: string };
export type Parsed = { value: unknown; lines: Map<string, number> };

const IDENTIFIER = /^[\p{L}_][\p{L}\p{N}_]*$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const RESERVED = new Set(['objectifs', 'questions', 'hypotheses', 'essais', 'bilan', 'valeurs', 'qualification', 'acte', 'true', 'false']);
const TERM_KEYS = new Set(['si', 'sauf']);
const CONDITION_KEYS = new Set(['l_une', 'delai', 'montant', 'selon', 'decompte']);
const CONDITION_SHAPE = 'condition : - nom_de_la_condition: true (ou false), avec au besoin selon, delai, montant, decompte ; ou - l_une: [conditions]';
const FOUNDATION_SHAPE = 'fondement : { preuve: [{ piece, citation }], selon: [{ source, citation }], si: [- nom: true] } avec au moins preuve ou selon';
const CONTREDIT_REMOVED = 'contredit n’existe plus : écris la pièce en preuve sous nom: { false: [{ preuve: [{ piece, citation }] }] } ; pour une clause contraire, deux fondements de valeurs opposées (true et false) sur la même question';
const UNITS = ['jours', 'jours_ouvres', 'mois', 'ans'] as const;
const BOUNDS = ['au_plus', 'au_moins'] as const;
const COMPARISONS = ['plus_de', 'au_moins', 'moins_de', 'au_plus'] as const;
const DELAY_SHAPE = 'delai : { de: date_de_départ, a: date_retenue, au_plus ou au_moins: { jours | jours_ouvres | mois | ans: nombre } }';
const AMOUNT_SHAPE = 'montant : { valeur: montant_du_dossier, plus_de | au_moins | moins_de | au_plus: nombre ou autre montant }';
const isDate = (value: unknown): value is string => typeof value === 'string' && DATE.test(value);
const OBJECTIVE_SHAPE = 'objectifs: [{ objectif: le but du client, obtenir | écarter: terme (vrai/faux) ou réduire | augmenter: montant de valeurs }] attendu';
const FORMULA_SHAPE = `formule : { ${OPERATIONS.join(' | ')}: [termes] } (arrondi: [montant, décimales]), { bareme: { assiette, tranches: [{ jusqu_a, taux }, …, { taux }] } } ou { si: terme, alors, sinon } ; un terme est un nombre, un nom de valeur ou une formule`;
export const operands = (formula: Formula): Operand[] => (formula.operation === 'bareme' ? [formula.assiette, ...formula.tranches.flatMap((tranche) => [tranche.jusqu_a, tranche.taux]).filter((item): item is Operand => item !== null)] : formula.operation === 'si' ? [formula.alors, formula.sinon] : formula.termes);
export const formulaNames = (formula: Formula): string[] => operands(formula).flatMap((item) => (typeof item === 'string' ? [item] : typeof item === 'number' ? [] : formulaNames(item)));
export const formulaNumbers = (formula: Formula): number[] => operands(formula).flatMap((item, index) => (typeof item === 'number' ? (formula.operation === 'arrondi' && index === 1 ? [] : [item]) : typeof item === 'string' ? [] : formulaNumbers(item)));
export const formulaConditions = (formula: Formula): string[] => [...(formula.operation === 'si' ? [formula.condition] : []), ...operands(formula).flatMap((item) => (typeof item === 'object' ? formulaConditions(item) : []))];
export const CONTROLS = { applicabilite: 'applicabilité_', decompte: 'décompte_', validite: 'validité_', prescription: 'prescription_' } as const;
export type ControlSlot = keyof typeof CONTROLS;
export const basisControls = (basis: Basis) => [basis.applicabilite, basis.validite].filter((name): name is string => Boolean(name));
const CONTROL_PURPOSE: Record<ControlSlot, string> = { applicabilite: 'établit que ce texte s’applique', decompte: 'établit le calcul du délai', validite: 'établit la validité de l’acte ou de la clause', prescription: 'établit que l’action n’est pas prescrite' };

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
  const reasoning: Reasoning = { objectifs: [], hypotheses: [], terms: new Map(), valeurs: new Map(), computed: new Map(), acte: [] };
  const dated: Array<{ at: string; name: string }> = [];
  const controls: Array<{ slot: ControlSlot; name: string; at: string }> = [];
  const control = (slot: ControlSlot, raw: unknown, at: string): string | undefined => {
    if (typeof raw !== 'string' || !IDENTIFIER.test(raw)) { problem(at, `${slot} : nom du terme qui ${CONTROL_PURPOSE[slot]}, commençant par ${CONTROLS[slot]}`); return undefined; }
    if (!raw.startsWith(CONTROLS[slot])) { problem(at, `${slot} : le nom commence par ${CONTROLS[slot]} (ex. ${CONTROLS[slot]}${raw})`); return undefined; }
    controls.push({ slot, name: raw, at });
    return raw;
  };
  if (!isObject(value)) { problem('', 'le raisonnement est un objet { objectifs: [...], terme: {...} }'); return { reasoning, problems }; }

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

  const targets = (raw: unknown, path: string): Target[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { problem(path, 'liste attendue : [{ piece, citation }] (citation facultative si l’élément visé n’existe pas encore)'); return []; }
    return raw.flatMap((entry, index) => {
      const at = `${path}[${index}]`;
      if (!isObject(entry) || !text(entry.piece) || (entry.citation !== undefined && !text(entry.citation)) || Object.keys(entry).some((key) => !['piece', 'citation'].includes(key))) { problem(at, '{ piece: chemin de l’élément visé, citation: passage visé (facultatif) } attendu'); return []; }
      return [{ piece: entry.piece as string, ...(entry.citation !== undefined ? { citation: entry.citation as string } : {}) }];
    });
  };

  const operand = (item: unknown, path: string): Operand | null => (typeof item === 'number' ? item : typeof item === 'string' && IDENTIFIER.test(item) ? item : formula(item, path));
  const formula = (raw: unknown, path: string): Formula | null => {
    if (isObject(raw) && raw.si !== undefined) {
      if (typeof raw.si !== 'string' || !IDENTIFIER.test(raw.si) || raw.alors === undefined || raw.sinon === undefined || Object.keys(raw).some((key) => !['si', 'alors', 'sinon'].includes(key))) { problem(path, FORMULA_SHAPE); return null; }
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
      if (!valid) { problem(`${path}.bareme`, 'bareme : { assiette, tranches: [{ jusqu_a: limite, taux }, …, { taux }] } : la dernière tranche n’a pas de limite'); return null; }
      const assiette = operand((scale as Record<string, unknown>).assiette, `${path}.bareme.assiette`);
      const parsed = tranches.map((tranche, index) => ({ jusqu_a: (tranche as Record<string, unknown>).jusqu_a === undefined ? null : operand((tranche as Record<string, unknown>).jusqu_a, `${path}.bareme.tranches[${index}].jusqu_a`), taux: operand((tranche as Record<string, unknown>).taux, `${path}.bareme.tranches[${index}].taux`) }));
      if (assiette === null || parsed.some((tranche, index) => tranche.taux === null || (tranche.jusqu_a === null && index < parsed.length - 1))) return null;
      return { operation: 'bareme', assiette, tranches: parsed as Array<{ jusqu_a: Operand | null; taux: Operand }> };
    }
    const operation = operations[0] as typeof OPERATIONS[number];
    const list = isObject(raw) ? raw[operation] : undefined;
    if (operations.length !== 1 || !(OPERATIONS as readonly string[]).includes(operation) || !Array.isArray(list) || list.length < 2 || (operation === 'arrondi' && (list.length !== 2 || !Number.isInteger(list[1])))) { problem(path, FORMULA_SHAPE); return null; }
    const termes = list.map((item, index) => operand(item, `${path}.${operation}[${index}]`));
    if (termes.some((item) => item === null)) return null;
    return { operation, termes: termes as Operand[] };
  };

  const bases = (raw: unknown, path: string): Basis[] => {
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) { problem(path, 'liste attendue : [{ source, citation, vigueur }]'); return []; }
    return raw.flatMap((entry, index) => {
      const at = `${path}[${index}]`;
      if (!isObject(entry) || !text(entry.source) || !text(entry.citation)) { problem(at, '{ source: identifiant du texte, de la décision ou chemin de la pièce, citation: passage exact } attendu'); return []; }
      for (const key of Object.keys(entry)) if (!['source', 'citation', 'vigueur', 'applicabilite', 'validite', 'renvoi'].includes(key)) problem(`${at}.${key}`, key === 'contredit' ? CONTREDIT_REMOVED : `clé inconnue ${key}`);
      const basis: Basis = { source: (entry.source as string).trim(), citation: entry.citation as string, renvoi: targets(entry.renvoi, `${at}.renvoi`) };
      if (entry.applicabilite !== undefined) {
        const name = control('applicabilite', entry.applicabilite, `${at}.applicabilite`);
        if (name) basis.applicabilite = name;
      }
      if (entry.validite !== undefined) {
        const name = control('validite', entry.validite, `${at}.validite`);
        if (name) basis.validite = name;
      }
      if (entry.vigueur !== undefined) {
        const vigueur = entry.vigueur;
        if (!isObject(vigueur) || typeof vigueur.debut !== 'string' || !DATE.test(vigueur.debut) || !(vigueur.fin === null || vigueur.fin === undefined || (typeof vigueur.fin === 'string' && DATE.test(vigueur.fin))) || Object.keys(vigueur).some((key) => !['debut', 'fin', 'au'].includes(key))) problem(`${at}.vigueur`, 'vigueur : { debut: \'AAAA-MM-JJ\', fin: \'AAAA-MM-JJ\' ou null, au: date_de_valeurs }');
        else {
          basis.vigueur = { debut: vigueur.debut, fin: (vigueur.fin as string | null | undefined) ?? null };
          if (vigueur.au !== undefined) {
            if (typeof vigueur.au === 'string' && IDENTIFIER.test(vigueur.au)) { basis.vigueur.au = vigueur.au; dated.push({ at: `${at}.vigueur.au`, name: vigueur.au }); }
            else problem(`${at}.vigueur.au`, 'au : nom d’une date de valeurs (ex. date_de_conclusion_du_contrat)');
          }
        }
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
      if (!isObject(delay) || typeof delay.de !== 'string' || !IDENTIFIER.test(delay.de) || typeof delay.a !== 'string' || !IDENTIFIER.test(delay.a) || Object.keys(delay).some((key) => !['de', 'a', ...BOUNDS].includes(key))
        || bounds.length !== 1 || duration.length !== 1 || !(UNITS as readonly string[]).includes(unit) || !Number.isInteger(count) || (count as number) < 0) { problem(`${path}.delai`, DELAY_SHAPE); return null; }
      return { delai: { de: delay.de, a: delay.a, borne: bounds[0], duree: { unite: unit as Duration['unite'], nombre: count as number } } };
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
    if (!isObject(raw)) { problem(path, CONDITION_SHAPE); return []; }
    if (raw.condition !== undefined) { problem(`${path}.condition`, `condition: nom n’existe plus : écris ${typeof raw.condition === 'string' && IDENTIFIER.test(raw.condition) ? `${raw.condition}: true (ou ${raw.condition}: false)` : 'nom: true (ou nom: false)'}, la valeur attendue de la condition`); return []; }
    if (raw.contredit !== undefined) problem(`${path}.contredit`, CONTREDIT_REMOVED);
    if (raw.preuve !== undefined) problem(`${path}.preuve`, 'preuve ne se place plus sur une condition de règle : place-la sous la valeur qu’elle établit, à la racine : nom: { true: [{ preuve: [{ piece, citation }] }] } (pour un délai ou un montant : dans valeurs)');
    const names = Object.keys(raw).filter((key) => !CONDITION_KEYS.has(key) && key !== 'contredit' && key !== 'preuve');
    const hasChoice = raw.l_une !== undefined;
    if (hasChoice === (names.length > 0)) { problem(path, hasChoice ? 'l_une ne porte pas de nom de condition : retire-le ou mets-le dans l’un des membres' : `${CONDITION_SHAPE} (exactement une clé hors ${[...CONDITION_KEYS].join(', ')})`); return []; }
    if (names.length > 1) { problem(path, `une condition porte exactement une clé nom: true|false (trouvé : ${names.join(', ')}) ; ${CONDITION_SHAPE}`); return []; }
    const result: Condition = { selon: bases(raw.selon, `${path}.selon`) };
    if (!hasChoice) {
      const name = names[0];
      const expected = raw[name];
      if (!IDENTIFIER.test(name)) { problem(`${path}.${name}`, 'terme en minuscules, lettres, chiffres et _ (ex. retard_de_livraison)'); return []; }
      if (typeof expected !== 'boolean') { problem(`${path}.${name}`, `${name} : true ou false attendu, la valeur que la règle exige de ${name} (${name}: true ou ${name}: false)`); return []; }
      result.condition = name;
      result.attendu = expected;
      const mesure = measure(raw, path);
      if (mesure) {
        const known = reasoning.computed.get(name);
        if (known && JSON.stringify(known) !== JSON.stringify(mesure)) problem(path, `${name} est calculé de deux façons différentes : garde un seul calcul ou renomme l’un des deux`);
        reasoning.computed.set(name, mesure);
        result.mesure = mesure;
      }
      if (raw.decompte !== undefined && !mesure?.delai) problem(`${path}.decompte`, 'decompte ne s’emploie qu’avec un délai');
      else if (raw.decompte !== undefined) result.decompte = control('decompte', raw.decompte, `${path}.decompte`);
    } else {
      if (raw.delai !== undefined || raw.montant !== undefined) problem(path, 'un délai ou un montant porte un nom : nom: true');
      if (!Array.isArray(raw.l_une) || raw.l_une.length < 2) { problem(`${path}.l_une`, 'l_une : au moins deux conditions'); return []; }
      result.l_une = raw.l_une.flatMap((entry, index) => condition(entry, `${path}.l_une[${index}]`, true));
    }
    if (!nested && !result.selon.length) problem(`${path}.selon`, 'condition sans source : ajoute selon: [{ source, citation }]', result.condition ? `${human(result.condition)} : aucun texte ne fonde cette condition.` : 'Une alternative n’est fondée sur aucun texte.', result.condition);
    return [result];
  };

  const foundation = (raw: unknown, path: string): Foundation[] => {
    if (!isObject(raw)) { problem(path, FOUNDATION_SHAPE); return []; }
    for (const key of Object.keys(raw)) if (!['preuve', 'selon', 'si'].includes(key)) problem(`${path}.${key}`, key === 'contredit' ? CONTREDIT_REMOVED : `clé inconnue ${key} (admises : preuve, selon, si)`);
    const result: Foundation = { preuve: refs(raw.preuve, `${path}.preuve`), selon: bases(raw.selon, `${path}.selon`), si: [] };
    if (!result.preuve.length && !result.selon.length) problem(path, FOUNDATION_SHAPE);
    if (raw.si !== undefined) {
      if (!Array.isArray(raw.si)) problem(`${path}.si`, 'liste de conditions attendue : - nom: true');
      else result.si = raw.si.flatMap((entry, index) => condition(entry, `${path}.si[${index}]`, true));
    }
    return [result];
  };

  for (const [key, raw] of Object.entries(value)) {
    if (key === 'bilan') continue;
    if (key === 'questions') { problem('questions', 'la clé questions s’appelle objectifs : chaque entrée { objectif: le but du client, obtenir | écarter | réduire | augmenter: terme } ; le verbe remplace reponse'); continue; }
    if (key === 'objectifs') {
      if (!Array.isArray(raw) || !raw.length) { problem('objectifs', OBJECTIVE_SHAPE); continue; }
      raw.forEach((entry, index) => {
        const at = `objectifs[${index}]`;
        if (!isObject(entry) || !text(entry.objectif)) { problem(at, OBJECTIVE_SHAPE); return; }
        const verbs = (Object.keys(VERBS) as Verb[]).filter((verb) => entry[verb] !== undefined);
        if (verbs.length !== 1) { problem(at, `${verbs.length ? 'un seul verbe' : 'verbe manquant'} : ${OBJECTIVE_SHAPE}`); return; }
        const effet = entry[verbs[0]];
        if (typeof effet !== 'string' || !IDENTIFIER.test(effet)) { problem(`${at}.${verbs[0]}`, `${verbs[0]} : nom du terme ou du montant visé`); return; }
        for (const field of Object.keys(entry)) if (!['objectif', ...verbs, 'validite', 'prescription'].includes(field)) problem(`${at}.${field}`, field === 'question' ? 'question s’appelle objectif : le but du client' : field === 'reponse' ? 'reponse est remplacée par le verbe : obtenir | écarter | réduire | augmenter: terme' : `clé inconnue ${field} (admises : objectif, ${Object.keys(VERBS).join(' | ')}, validite, prescription)`);
        const objective: Objective = { objectif: entry.objectif as string, effet, verbe: verbs[0] };
        for (const slot of ['validite', 'prescription'] as const) {
          if (entry[slot] === undefined) continue;
          if (entry[slot] === effet) { problem(`${at}.${slot}`, `${slot} : l’objectif porte déjà sur ce contrôle, retire ${slot}`); continue; }
          objective[slot] = control(slot, entry[slot], `${at}.${slot}`);
        }
        reasoning.objectifs.push(objective);
      });
      continue;
    }
    if (key === 'qualification') {
      if (raw === 'drafting' || raw === 'contentieux' || raw === 'consultation') reasoning.qualification = raw;
      else problem('qualification', 'qualification : \'drafting\', \'contentieux\' ou \'consultation\'');
      continue;
    }
    if (key === 'valeurs') {
      if (!isObject(raw)) { problem('valeurs', 'valeurs: { nom: { valeur, preuve } } attendu'); continue; }
      for (const [name, entry] of Object.entries(raw)) {
        const at = `valeurs.${name}`;
        const computedOnly = isObject(entry) && entry.valeur === undefined && entry.formule !== undefined;
        if (!IDENTIFIER.test(name) || !isObject(entry) || !(computedOnly || typeof entry.valeur === 'number' || isDate(entry.valeur) || entry.valeur === null)) { problem(at, '{ valeur: \'AAAA-MM-JJ\', nombre ou null si le dossier ne la fixe pas, preuve: [{ piece, citation }] ou selon: [{ source, citation, vigueur }], formule } attendu'); continue; }
        for (const field of Object.keys(entry)) if (!['valeur', 'preuve', 'selon', 'formule'].includes(field)) problem(`${at}.${field}`, field === 'contredit' ? CONTREDIT_REMOVED : `clé inconnue ${field} (admises : valeur, preuve, selon, formule)`);
        const value: Value = { valeur: computedOnly ? null : entry.valeur as string | number | null, preuve: refs(entry.preuve, `${at}.preuve`), selon: bases(entry.selon, `${at}.selon`) };
        value.selon.forEach((basis, index) => { if (basis.validite) problem(`${at}.selon[${index}].validite`, 'la source d’une valeur est un texte : validite ne s’y place pas'); });
        if (entry.formule !== undefined) {
          const parsed = formula(entry.formule, `${at}.formule`);
          if (parsed) value.formule = parsed;
          if (typeof entry.valeur === 'string') problem(`${at}.formule`, 'une formule calcule un nombre, pas une date');
        }
        reasoning.valeurs.set(name, value);
      }
      continue;
    }
    if (key === 'acte') {
      const read = readActe(raw);
      reasoning.acte = read.sections;
      for (const entry of read.problems) problem(entry.path, entry.text);
      continue;
    }
    if (key === 'essais') { problem('essais', 'la clé essais s’appelle hypotheses : renomme-la'); continue; }
    if (key === 'hypotheses') {
      if (!Array.isArray(raw)) { problem('hypotheses', 'hypotheses: [{ nom, faits, attendu }] attendu'); continue; }
      raw.forEach((entry, index) => {
        const at = `hypotheses[${index}]`;
        const booleans = (map: unknown) => isObject(map) && Object.values(map).every((item) => typeof item === 'boolean' || typeof item === 'number');
        const facts = (map: unknown) => isObject(map) && Object.values(map).every((item) => typeof item === 'boolean' || typeof item === 'number' || isDate(item));
        if (!isObject(entry) || !text(entry.nom) || !facts(entry.faits) || !booleans(entry.attendu)) { problem(at, '{ nom, faits: { terme: vrai|faux, valeur: \'AAAA-MM-JJ\' ou nombre }, attendu: { terme: vrai|faux, montant: nombre } } attendu'); return; }
        reasoning.hypotheses.push({ nom: entry.nom as string, faits: entry.faits as Trial['faits'], attendu: entry.attendu as Trial['attendu'] });
      });
      continue;
    }
    if (!IDENTIFIER.test(key) || RESERVED.has(key)) { problem(key, 'nom de terme invalide'); continue; }
    if (!isObject(raw)) { problem(key, 'un terme est { si: [...], sauf: [...] } ; une question établie est { true: [fondements], false: [fondements] }'); continue; }
    const rule = (raw.si !== undefined || raw.sauf !== undefined);
    const sided = raw.true !== undefined || raw.false !== undefined;
    if (rule && sided) { problem(key, `${key} mêle si/sauf et true/false : une clé est soit un terme (si, sauf), soit une question établie (true, false)`); continue; }
    const annotations = ['statut', 'decisif', 'erreurs', 'manques', 'en_jeu'];
    if (sided) {
      for (const name of Object.keys(raw)) if (!SIDES.includes(name as Side) && !annotations.includes(name)) problem(`${key}.${name}`, `clé inconnue ${name} (admises : true, false)`);
      const fondements: Record<Side, Foundation[]> = { true: [], false: [] };
      for (const side of SIDES) {
        const entries = raw[side];
        if (entries === undefined) continue;
        if (!Array.isArray(entries) || !entries.length) { problem(`${key}.${side}`, 'liste de fondements attendue : [{ preuve, selon, si }]'); continue; }
        fondements[side] = entries.flatMap((entry, index) => foundation(entry, `${key}.${side}[${index}]`));
      }
      if (!fondements.true.length && !fondements.false.length) problem(key, 'question sans fondement : ajoute true: [{ preuve: [...] }] ou false: [{ preuve: [...] }]');
      reasoning.terms.set(key, { si: [], sauf: [], fondements });
      continue;
    }
    for (const name of Object.keys(raw)) if (!TERM_KEYS.has(name) && !annotations.includes(name)) problem(`${key}.${name}`, `clé inconnue ${name} (admises : si, sauf pour un terme ; true, false pour une question établie)`);
    const list = (field: 'si' | 'sauf') => {
      const entries = raw[field];
      if (entries === undefined) return [];
      if (!Array.isArray(entries)) { problem(`${key}.${field}`, 'liste de conditions attendue'); return []; }
      return entries.flatMap((entry, index) => condition(entry, `${key}.${field}[${index}]`, false));
    };
    const term = { si: list('si'), sauf: list('sauf') };
    if (!term.si.length && !term.sauf.length) problem(key, 'terme sans condition : ajoute si: [...] (ou true: / false: pour établir une question)');
    reasoning.terms.set(key, term);
  }
  for (const [name, mesure] of reasoning.computed) {
    if (reasoning.terms.has(name)) problem(name, `${name} est à la fois un terme et un calcul : renomme l’un des deux`);
    const typed = (names: Array<string | null | number>, check: (value: string | number) => boolean, kind: string) => {
      for (const entry of names) if (typeof entry === 'string' && reasoning.valeurs.has(entry) && reasoning.valeurs.get(entry)!.valeur !== null && !check(reasoning.valeurs.get(entry)!.valeur!)) problem(`valeurs.${entry}`, `${entry} sert à ${name} : ${kind} attendu`);
    };
    if (mesure.delai) typed([mesure.delai.de, mesure.delai.a], isDate, 'une date \'AAAA-MM-JJ\'');
    if (mesure.montant) typed([mesure.montant.valeur, mesure.montant.seuil], (value) => typeof value === 'number', 'un nombre');
  }
  for (const { at, name } of dated) if (reasoning.valeurs.has(name) && reasoning.valeurs.get(name)!.valeur !== null && !isDate(reasoning.valeurs.get(name)!.valeur)) problem(`valeurs.${name}`, `${name} sert à ${at} : une date 'AAAA-MM-JJ' attendue`);
  for (const name of reasoning.terms.keys()) {
    const slot = (Object.keys(CONTROLS) as ControlSlot[]).find((key) => name.startsWith(CONTROLS[key]));
    if (slot && !controls.some((entry) => entry.slot === slot && entry.name === name)) problem(name, `${name} est un contrôle : désigne-le par ${slot}: '${name}' ${slot === 'applicabilite' ? 'sur la source' : slot === 'decompte' ? 'sur le délai' : slot === 'validite' ? 'sur l’objectif ou la clause' : 'sur l’objectif'} qu’il conditionne`);
  }
  for (const { slot, name, at } of controls) if (!reasoning.terms.has(name)) problem(at, `terme ${name} non défini : écris ${name}: { si: [...] }, le terme qui ${CONTROL_PURPOSE[slot]}`);
  const reaches = (origin: string, current: string, seen: Set<string>): boolean => {
    const next = reasoning.valeurs.get(current)?.formule ? formulaNames(reasoning.valeurs.get(current)!.formule!) : [];
    return next.some((name) => name === origin || (!seen.has(name) && reaches(origin, name, seen.add(name))));
  };
  for (const [name, entry] of reasoning.valeurs) {
    if (!entry.formule) continue;
    if (reaches(name, name, new Set())) problem(`valeurs.${name}.formule`, `${name} se calcule à partir d’elle-même`);
    for (const condition of formulaConditions(entry.formule)) if (reasoning.valeurs.has(condition)) problem(`valeurs.${name}.formule`, `si : ${condition} est une valeur ; si désigne un terme ou un fait (vrai/faux)`);
    for (const operand of formulaNames(entry.formule)) if (reasoning.valeurs.has(operand) && typeof reasoning.valeurs.get(operand)!.valeur === 'string') problem(`valeurs.${operand}`, `${operand} sert à la formule de ${name} : un nombre attendu`);
  }
  if (!reasoning.objectifs.length && !problems.some((entry) => entry.path === 'objectifs' || entry.path === 'questions')) problem('objectifs', `ajoute ${OBJECTIVE_SHAPE.replace(/ attendu$/, '')}`);
  return { reasoning, problems };
}

const ANNOTATIONS = new Set(['bilan', 'montant_calcule', 'statut', 'decisif', 'erreurs', 'manques', 'en_jeu', 'atteint', 'obstacles', 'titre', 'corrigee', 'citation_d_origine', 'en_vigueur', 'personnes', 'fiable', 'nature', 'obtenu', 'conforme', 'decisifs', 'vigueur_legifrance', 'calcul']);

const KEY_ORDER = ['qualification', 'objectifs', 'objectif', 'obtenir', 'écarter', 'réduire', 'augmenter', 'true', 'false', 'l_une', 'delai', 'montant', 'de', 'a', 'valeur', 'formule', 'si', 'alors', 'sinon', 'assiette', 'tranches', 'jusqu_a', 'taux', 'source', 'piece', 'citation', 'vigueur', 'debut', 'fin', 'au', 'selon', 'applicabilite', 'validite', 'renvoi', 'decompte', 'validite', 'prescription', 'preuve', 'sauf', 'nom', 'faits', 'attendu', 'id', 'intitule', 'traite', 'conflit', 'sur', 'modele', 'avocat', 'texte', 'sections'];
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
