import { REASONING_FORCES } from '../../../shared/piecemaker-reasoning.js';
import type { ReasoningCondition, ReasoningDuration, ReasoningEnumeration, ReasoningFact, ReasoningForce, ReasoningQuestion, ReasoningReview, ReasoningSource, ReasoningStructure, ReasoningValue, ReasoningVigueur, ReasoningVoie } from '../../../shared/piecemaker-reasoning.js';

import { checkTypes, freeVariables, printExpression, printRule } from './catala.js';
import type { CatalaProgram, Declaration, DeclarationItem, Expression, Rule } from './catala.js';
import { isLegalDate } from './legal-period.js';

export type ReasoningItem = { review?: ReasoningReview; value?: ReasoningValue; force?: ReasoningForce | null; appreciation?: string; sources?: string[] };

type Variable = Extract<DeclarationItem, { type: string }>;
type Locals = Map<string, ReasoningValue>;
type Host = {
  lookup(name: string): ReasoningValue;
  call(name: string, args: ReasoningValue[]): ReasoningValue;
  sub(head: string, field: string): ReasoningValue | undefined;
  scopeCall(scope: string, provided: Map<string, ReasoningValue>): ReasoningStructure;
  enumOf(cas: string): string;
  rounding?: 'inférieur' | 'supérieur';
};
type Run = { variable(name: string): ReasoningValue; evaluate(expression: Expression): ReasoningValue; errors: Map<string, string> };
type RuleState = { applies: boolean | null; issues: string[]; blocking: boolean; sources: string[] };
type ScopePlan = { scope: Declaration; rules: Rule[]; ruleState: Map<Rule, RuleState>; vigueur: ReasoningVigueur[]; reference?: string; blocked: Set<string>; rounding?: 'inférieur' | 'supérieur' };

const STRENGTH = { article: 'loi', case: 'jurisprudence', document: 'doctrine' } as const;
const RANK = { loi: 3, jurisprudence: 2, doctrine: 1 };

class EvaluationError extends Error {}

const isDuration = (value: ReasoningValue): value is ReasoningDuration => typeof value === 'object' && value !== null && !Array.isArray(value) && 'ans' in value;
const isDate = (value: ReasoningValue): value is string => typeof value === 'string' && isLegalDate(value);
const isStructure = (value: ReasoningValue): value is ReasoningStructure => typeof value === 'object' && value !== null && !Array.isArray(value) && 'structure' in value;
const isEnumeration = (value: ReasoningValue): value is ReasoningEnumeration => typeof value === 'object' && value !== null && !Array.isArray(value) && 'énumération' in value;

export function addDuration(date: string, duration: ReasoningDuration, sign = 1, rounding?: 'inférieur' | 'supérieur'): string {
  const [year, month, day] = date.split('-').map(Number);
  const total = year * 12 + month - 1 + sign * (duration.ans * 12 + duration.mois);
  const targetYear = Math.floor(total / 12);
  const targetMonth = total - targetYear * 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const shifted = rounding === 'supérieur' && day > lastDay ? Date.UTC(targetYear, targetMonth + 1, 1) : Date.UTC(targetYear, targetMonth, Math.min(day, lastDay));
  return new Date(shifted + sign * duration.jours * 86400000).toISOString().slice(0, 10);
}

function same(left: ReasoningValue | undefined, right: ReasoningValue | undefined): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((entry, index) => same(entry, right[index]));
  if (typeof left === 'object' && typeof right === 'object' && left !== null && right !== null && !Array.isArray(left) && !Array.isArray(right)) {
    const fields = (value: object) => Object.entries(value as Record<string, ReasoningValue | undefined>).filter(([, entry]) => entry !== undefined);
    const rightFields = right as Record<string, ReasoningValue | undefined>;
    const leftEntries = fields(left);
    return leftEntries.length === fields(right).length && leftEntries.every(([key, entry]) => same(entry, rightFields[key]));
  }
  return false;
}

function distinct(values: ReasoningValue[]): ReasoningValue[] {
  return values.reduce<ReasoningValue[]>((list, value) => (list.some((entry) => same(entry, value)) ? list : [...list, value]), []);
}

function compare(left: ReasoningValue, right: ReasoningValue): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (isDate(left) && isDate(right)) return left < right ? -1 : left > right ? 1 : 0;
  if (isDuration(left) && isDuration(right)) {
    const mixed = (left.jours !== 0 || right.jours !== 0) && (left.ans || left.mois || right.ans || right.mois);
    if (mixed) throw new EvaluationError('Durées en jours et en mois non comparables.');
    return (left.ans * 12 + left.mois + left.jours) - (right.ans * 12 + right.mois + right.jours);
  }
  throw new EvaluationError('Comparaison entre valeurs de types différents.');
}

function arithmetic(operator: '+' | '-' | '*' | '/', left: ReasoningValue, right: ReasoningValue, rounding?: 'inférieur' | 'supérieur'): ReasoningValue {
  if (typeof left === 'number' && typeof right === 'number') {
    if (operator === '/' && right === 0) throw new EvaluationError('Division par zéro.');
    return operator === '+' ? left + right : operator === '-' ? left - right : operator === '*' ? left * right : left / right;
  }
  if (isDate(left) && isDuration(right) && (operator === '+' || operator === '-')) return addDuration(left, right, operator === '+' ? 1 : -1, rounding);
  if (isDate(left) && isDate(right) && operator === '-') return { ans: 0, mois: 0, jours: Math.round((Date.parse(left) - Date.parse(right)) / 86400000) };
  if (isDuration(left) && isDuration(right) && (operator === '+' || operator === '-')) {
    const sign = operator === '+' ? 1 : -1;
    return { ans: left.ans + sign * right.ans, mois: left.mois + sign * right.mois, jours: left.jours + sign * right.jours };
  }
  throw new EvaluationError(`Opération « ${operator} » impossible sur ces types.`);
}

const bool = (value: ReasoningValue, operator: string): boolean | null => {
  if (value === null || typeof value === 'boolean') return value;
  throw new EvaluationError(`« ${operator} » attend un booléen.`);
};

const field = (value: ReasoningValue, name: string): ReasoningValue => {
  if (value === null) return null;
  if (!isStructure(value)) throw new EvaluationError(`« ${name} » lu sur une valeur qui n'est pas une structure.`);
  if (!(name in value.champs)) throw new EvaluationError(`Champ inconnu : ${name}.`);
  return value.champs[name];
};

const bind = (base: Locals, names: Array<[string, ReasoningValue]>): Locals => new Map([...base, ...names]);

function evaluate(expression: Expression, locals: Locals, host: Host): ReasoningValue {
  const recur = (node: Expression, scope: Locals = locals) => evaluate(node, scope, host);
  switch (expression.t) {
    case 'lit': return expression.v;
    case 'var': {
      const [head, ...rest] = expression.path;
      let remaining = rest;
      let value: ReasoningValue;
      const sub = rest.length ? host.sub(head, rest[0]) : undefined;
      if (locals.has(head)) value = locals.get(head)!;
      else if (sub !== undefined) { value = sub; remaining = rest.slice(1); }
      else value = host.lookup(head);
      for (const name of remaining) value = field(value, name);
      return value;
    }
    case 'not': {
      const value = recur(expression.e);
      if (value === null) return null;
      if (typeof value !== 'boolean') throw new EvaluationError('« non » attend un booléen.');
      return !value;
    }
    case 'neg': {
      const value = recur(expression.e);
      if (value === null) return null;
      if (typeof value !== 'number') throw new EvaluationError('Négation d’une valeur non numérique.');
      return -value;
    }
    case 'if': {
      const condition = recur(expression.c);
      if (condition === null) { const a = recur(expression.a); const b = recur(expression.b); return same(a, b) ? a : null; }
      return condition ? recur(expression.a) : recur(expression.b);
    }
    case 'impossible': throw new EvaluationError('Cas impossible atteint.');
    case 'soit': return evaluate(expression.body, bind(locals, [[expression.name, recur(expression.e)]]), host);
    case 'selon': {
      const subject = recur(expression.e);
      if (subject === null) return null;
      if (!isEnumeration(subject)) throw new EvaluationError('« selon » attend une énumération.');
      const arm = expression.cas.find((entry) => entry.cas === null || entry.cas === subject.cas);
      if (!arm) throw new EvaluationError(`Aucun cas ne correspond à ${subject.cas}.`);
      return evaluate(arm.body, arm.variable ? bind(locals, [[arm.variable, subject.contenu ?? null]]) : locals, host);
    }
    case 'forme': {
      const subject = recur(expression.e);
      if (subject === null) return null;
      if (!isEnumeration(subject)) throw new EvaluationError('« sous forme » attend une énumération.');
      if (subject.cas !== expression.cas) return false;
      if (!expression.garde) return true;
      return evaluate(expression.garde, expression.variable ? bind(locals, [[expression.variable, subject.contenu ?? null]]) : locals, host);
    }
    case 'champ': return field(recur(expression.e), expression.name);
    case 'structure': return { structure: expression.name, champs: Object.fromEntries(expression.champs.map((entry) => [entry.name, recur(entry.e)])) };
    case 'cas': return { énumération: host.enumOf(expression.cas), cas: expression.cas, ...(expression.e ? { contenu: recur(expression.e) } : {}) };
    case 'liste': return expression.items.map((item) => recur(item));
    case 'nombre': {
      const list = recur(expression.l);
      if (list === null) return null;
      if (!Array.isArray(list)) throw new EvaluationError('« nombre de » attend une liste.');
      return list.length;
    }
    case 'somme': {
      const list = recur(expression.l);
      if (list === null) return null;
      if (!Array.isArray(list)) throw new EvaluationError('« somme » attend une liste.');
      if (list.some((entry) => entry === null)) return null;
      const zero: ReasoningValue = expression.type === 'durée' ? { ans: 0, mois: 0, jours: 0 } : 0;
      return list.reduce<ReasoningValue>((total, entry) => arithmetic('+', total, entry), zero);
    }
    case 'extremum': {
      const list = recur(expression.l);
      if (list === null) return null;
      if (!Array.isArray(list)) throw new EvaluationError(`« ${expression.sens} » attend une liste.`);
      if (list.length === 0) {
        if (expression.vide) return recur(expression.vide);
        throw new EvaluationError(`Liste vide : ${expression.sens} indéterminé.`);
      }
      if (list.some((entry) => entry === null)) return null;
      let best = list[0];
      for (const entry of list) {
        const order = compare(entry, best);
        if ((expression.sens === 'maximum' && order > 0) || (expression.sens === 'minimum' && order < 0)) best = entry;
      }
      return best;
    }
    case 'existe': case 'pour_tout': case 'filtre': case 'transforme': case 'contenu_de': {
      const list = recur(expression.l);
      if (list === null) return null;
      if (!Array.isArray(list)) throw new EvaluationError('Une liste est attendue.');
      if (expression.t === 'transforme') return list.map((entry) => recur(expression.e, bind(locals, [[expression.name, entry]])));
      if (expression.t === 'contenu_de') {
        if (list.length === 0) {
          if (expression.vide) return recur(expression.vide);
          throw new EvaluationError(`Liste vide : ${expression.sens} indéterminé.`);
        }
        const keys = list.map((entry) => recur(expression.e, bind(locals, [[expression.name, entry]])));
        if (keys.some((key) => key === null)) return null;
        let best = 0;
        keys.forEach((key, index) => {
          const order = compare(key!, keys[best]!);
          if ((expression.sens === 'maximum' && order > 0) || (expression.sens === 'minimum' && order < 0)) best = index;
        });
        return list[best];
      }
      const outcomes = list.map((entry) => bool(recur(expression.e, bind(locals, [[expression.name, entry]])), expression.t === 'existe' ? 'tel que' : 'on a'));
      if (expression.t === 'filtre') return outcomes.includes(null) ? null : list.filter((_, index) => outcomes[index] === true);
      if (expression.t === 'existe') return outcomes.includes(true) ? true : outcomes.includes(null) ? null : false;
      return outcomes.includes(false) ? false : outcomes.includes(null) ? null : true;
    }
    case 'combine': {
      const list = recur(expression.l);
      if (list === null) return null;
      if (!Array.isArray(list)) throw new EvaluationError('« combine » attend une liste.');
      let accumulator = recur(expression.init);
      for (const entry of list) accumulator = recur(expression.e, bind(locals, [[expression.name, entry], [expression.acc, accumulator]]));
      return accumulator;
    }
    case 'appel': return host.call(expression.name, expression.args.map((arg) => recur(arg)));
    case 'intégrée': {
      const value = recur(expression.e);
      if (value === null) return null;
      if (expression.nom === 'arrondi') return Math.round(value as number);
      if (expression.nom === 'décimal' || expression.nom === 'argent') return value;
      if (!isDate(value)) throw new EvaluationError(`« ${expression.nom} » attend une date.`);
      if (expression.nom === 'accès_jour') return Number(value.slice(8, 10));
      if (expression.nom === 'accès_mois') return Number(value.slice(5, 7));
      if (expression.nom === 'accès_année') return Number(value.slice(0, 4));
      if (expression.nom === 'premier_jour_du_mois') return `${value.slice(0, 8)}01`;
      const [year, month] = value.split('-').map(Number);
      return `${value.slice(0, 8)}${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, '0')}`;
    }
    case 'résultat_de': return host.scopeCall(expression.scope, new Map(expression.avec.map((entry) => [entry.name, recur(entry.e)])));
    case 'bin': {
      const { op } = expression;
      if (op === 'et' || op === 'ou') {
        const stop = op === 'ou';
        const left = recur(expression.l);
        if (left === stop) return stop;
        const right = recur(expression.r);
        if (right === stop) return stop;
        for (const value of [left, right]) if (value !== null && typeof value !== 'boolean') throw new EvaluationError(`« ${op} » attend des booléens.`);
        return left === null || right === null ? null : !stop;
      }
      const left = recur(expression.l);
      const right = recur(expression.r);
      if (op === 'ou bien') {
        if (left === null || right === null) return null;
        bool(left, op); bool(right, op);
        return left !== right;
      }
      if (left === null || right === null) return null;
      if (op === '=' || op === '!=') return same(left, right) === (op === '=');
      if (op === 'contient') {
        if (!Array.isArray(left)) throw new EvaluationError('« contient » attend une liste.');
        if (left.some((entry) => same(entry, right))) return true;
        return left.includes(null) ? null : false;
      }
      if (op === '++') {
        if (!Array.isArray(left) || !Array.isArray(right)) throw new EvaluationError('« ++ » attend deux listes.');
        return [...left, ...right];
      }
      if (op === '+' || op === '-' || op === '*' || op === '/') return arithmetic(op, left, right, host.rounding);
      const order = compare(left, right);
      return op === '<' ? order < 0 : op === '<=' ? order <= 0 : op === '>' ? order > 0 : order >= 0;
    }
  }
}

export function evaluateReasoning(program: CatalaProgram, sources: Map<string, ReasoningSource>, items: Map<string, ReasoningItem>) {
  const diagnostics: string[] = [...checkTypes(program)];
  const declarations = new Map<string, Declaration>();
  for (const declaration of program.declarations) {
    if (declarations.has(declaration.scope)) diagnostics.push(`Champ d'application déclaré deux fois : ${declaration.scope}.`);
    declarations.set(declaration.scope, declaration);
  }
  const rulesOf = (scope: string) => program.bodies.filter((body) => body.scope === scope).flatMap((body) => body.rules);
  for (const body of program.bodies) if (!declarations.has(body.scope)) diagnostics.push(`Champ d'application non déclaré : ${body.scope}.`);
  const isDossier = (declaration: Declaration) => declaration.items.length > 0 && declaration.items.every((item) => item.role === 'champ');
  const lawScopes = [...declarations.values()].filter((declaration) => !isDossier(declaration));
  const variablesOf = (declaration: Declaration) => declaration.items.filter((item): item is Variable => item.role !== 'champ');
  const isInput = (item: DeclarationItem) => item.role !== 'champ' && item.role.startsWith('entrée');
  const structures = new Map(program.structures.map((entry) => [entry.name, entry] as const));
  const globals = new Map(program.globals.map((entry) => [entry.name, entry] as const));
  const caseOwner = new Map<string, string>();
  for (const entry of program.enumerations) for (const item of entry.cases) if (!caseOwner.has(item.name)) caseOwner.set(item.name, entry.name);
  const enumerations = new Map(program.enumerations.map((entry) => [entry.name, entry] as const));
  const matches = (type: string, value: ReasoningValue): boolean => {
    if (type === 'booléen' || type === 'condition') return typeof value === 'boolean';
    if (type === 'date') return isDate(value);
    if (type === 'durée') return isDuration(value);
    if (type === 'entier') return Number.isInteger(value);
    if (type.startsWith('liste de ')) return Array.isArray(value) && value.every((entry) => entry === null || matches(type.slice('liste de '.length), entry));
    if (structures.has(type)) return isStructure(value) && value.structure === type;
    if (enumerations.has(type)) return isEnumeration(value) && value.énumération === type;
    return typeof value === 'number';
  };

  const nestedDepth = { current: 0 };
  const nested = <T>(action: () => T): T => {
    if (nestedDepth.current > 200) throw new EvaluationError('Appels imbriqués trop profonds.');
    nestedDepth.current++;
    try { return action(); } finally { nestedDepth.current--; }
  };

  const globalCache = new Map<string, ReasoningValue>();
  const globalVisiting = new Set<string>();
  const globalValue = (name: string): ReasoningValue => {
    if (globalCache.has(name)) return globalCache.get(name)!;
    if (globalVisiting.has(name)) throw new EvaluationError(`Définition circulaire : ${name}.`);
    const global = globals.get(name)!;
    if (global.args.length) throw new EvaluationError(`« ${name} » attend ${global.args.length} argument(s).`);
    globalVisiting.add(name);
    try {
      const value = nested(() => evaluate(global.body, new Map(), globalHost));
      globalCache.set(name, value);
      return value;
    } finally {
      globalVisiting.delete(name);
    }
  };
  const callGlobal = (name: string, args: ReasoningValue[]): ReasoningValue => {
    const global = globals.get(name);
    if (!global) throw new EvaluationError(`Fonction inconnue : ${name}.`);
    if (args.length !== global.args.length) throw new EvaluationError(`« ${name} » attend ${global.args.length} argument(s).`);
    return nested(() => evaluate(global.body, new Map(global.args.map((arg, index) => [arg.name, args[index]] as const)), globalHost));
  };
  const enumOf = (cas: string) => {
    const owner = caseOwner.get(cas);
    if (!owner) throw new EvaluationError(`Cas inconnu : ${cas}.`);
    return owner;
  };
  const globalHost: Host = {
    lookup(name) {
      if (globals.has(name)) return globalValue(name);
      if (caseOwner.has(name)) return { énumération: enumOf(name), cas: name };
      throw new EvaluationError(`Variable non déclarée : ${name}.`);
    },
    call: (name, args) => callGlobal(name, args),
    sub: () => undefined,
    scopeCall() { throw new EvaluationError('Appel de champ d’application hors champ d’application.'); },
    enumOf,
  };
  const constant = (expression: Expression): ReasoningValue | undefined => {
    try { return evaluate(expression, new Map(), globalHost); } catch { return undefined; }
  };

  const facts = new Map<string, ReasoningFact>();
  const established = (scope: string, name: string) => {
    const fact = facts.get(`${scope}.${name}`);
    return fact?.status === 'établi' ? fact.value : null;
  };
  for (const scope of lawScopes) for (const item of variablesOf(scope)) if (isInput(item) || item.role.startsWith('contexte')) {
    facts.set(`${scope.scope}.${item.name}`, { id: `${scope.scope}.${item.name}`, scope: scope.scope, variable: item.name, type: item.type, value: null, force: null, appreciation: '', author: 'ia', sources: [], status: 'non établi', issues: [] });
  }
  for (const dossier of [...declarations.values()].filter(isDossier)) {
    const subScopes = new Map(dossier.items.flatMap((item) => (item.role === 'champ' ? [[item.name, item.scope] as const] : [])));
    for (const rule of rulesOf(dossier.scope)) {
      const scope = subScopes.get(rule.target[0]);
      const fact = scope && rule.target.length === 2 ? facts.get(`${scope}.${rule.target[1]}`) : undefined;
      if (!fact || rule.kind !== 'définition') { diagnostics.push(`${dossier.scope} : « ${rule.target.join('.')} » ne désigne pas une entrée d'un champ d'application.`); continue; }
      const value = rule.condition ? undefined : constant(rule.consequence as Expression);
      if (value === undefined) { fact.issues.push('Valeur attendue : une constante tirée de la pièce.'); continue; }
      fact.value = value;
      fact.sources = rule.attrs.selon ?? [];
      const force = rule.attrs.force?.[0];
      fact.force = REASONING_FORCES.includes(force as ReasoningForce) ? force as ReasoningForce : null;
      if (force && !fact.force) fact.issues.push(`Force probante inconnue : ${force}.`);
      fact.appreciation = rule.attrs['appréciation']?.join(', ') ?? '';
    }
  }
  for (const fact of facts.values()) {
    const item = items.get(fact.id);
    if (item?.review) fact.review = item.review;
    if (item && item.value !== undefined) Object.assign(fact, { value: item.value, force: item.force ?? null, appreciation: item.appreciation ?? '', sources: item.sources ?? fact.sources, author: 'avocat' });
    if (!fact.sources.length) fact.issues.push('Pièce à rechercher dans le dossier.');
    const usable = fact.sources.filter((id) => {
      const source = sources.get(id);
      if (!source) fact.issues.push(`Source inconnue : ${id}.`);
      else if (source.kind !== 'document') fact.issues.push(`${id} n'est pas une pièce du dossier.`);
      else if (!source.verified) fact.issues.push(`Extrait introuvable dans la pièce (${id}).`);
      else return true;
      return false;
    });
    if (fact.value !== null && !matches(fact.type, fact.value)) { fact.issues.push(`Valeur de type ${fact.type} attendue.`); fact.value = null; }
    if (fact.value !== null && !fact.force) fact.issues.push('Force probante de la pièce à indiquer.');
    const validated = fact.review?.status === 'validé';
    if (fact.review?.status === 'écarté') fact.issues.push('Écarté par l’avocat.');
    else if (fact.value !== null && (validated || (usable.length && fact.force && fact.force !== 'sans_valeur'))) fact.status = 'établi';
  }

  const plans = new Map<string, ScopePlan>();
  for (const scope of lawScopes) {
    const rules = rulesOf(scope.scope);
    const reference = scope.attrs['date_de_référence']?.[0];
    const rounding = program.bodies.find((body) => body.scope === scope.scope && body.arrondi)?.arrondi;
    const vigueur: ReasoningVigueur[] = [];
    const ruleState = new Map<Rule, RuleState>();
    for (const rule of rules) {
      const issues: string[] = [];
      const usable = (rule.attrs.selon ?? []).filter((id) => {
        const source = sources.get(id);
        if (!source) issues.push(`Source inconnue : ${id}.`);
        else if (!source.verified) issues.push(`Extrait introuvable (${id}).`);
        else if (source.history?.status === 'remise en cause') issues.push(`${source.title} : décision remise en cause par un recours.`);
        else return true;
        return false;
      });
      for (const id of usable) if (sources.get(id)!.history?.status === 'à examiner') issues.push(`${sources.get(id)!.title} : historique judiciaire à examiner.`);
      let applies: boolean | null = true;
      const dateName = rule.attrs['à_la_date']?.[0] ?? reference;
      for (const id of usable.filter((candidate) => sources.get(candidate)!.kind === 'article')) {
        const source = sources.get(id)!;
        const date = dateName ? established(scope.scope, dateName) : null;
        const inForce = !source.validity || !isDate(date) ? null : source.validity.from <= date && (source.validity.to === null || date < source.validity.to);
        if (!source.validity) issues.push(`${source.title} : période de vigueur inconnue.`);
        else if (inForce === false) issues.push(`${source.title} : non en vigueur au ${date}.`);
        if (!vigueur.some((entry) => entry.source === id && entry.date === date)) vigueur.push({ source: id, date: isDate(date) ? date : null, inForce });
        applies = inForce === false ? false : inForce === null || applies === null ? (applies === false ? false : null) : applies;
      }
      if (!usable.length) issues.push(`Fondement manquant pour « ${rule.target.join('.')} » : citer le texte, la décision ou la doctrine qui pose la condition.`);
      ruleState.set(rule, { applies, issues, blocking: !usable.length || usable.some((id) => sources.get(id)!.kind === 'article' && !sources.get(id)!.validity), sources: usable });
    }
    const blocked = new Set<string>();
    for (const item of variablesOf(scope)) {
      if (isInput(item) || item.args?.length) continue;
      const id = `${scope.scope}.${item.name}`;
      const own = rules.filter((rule) => rule.target.length === 1 && rule.target[0] === item.name);
      const states = own.map((rule) => ruleState.get(rule)!);
      if (!own.length || states.some((state) => state.blocking) || items.get(id)?.review?.status === 'écarté') blocked.add(id);
    }
    plans.set(scope.scope, { scope, rules, ruleState, vigueur, reference, blocked, rounding });
  }

  const runs = new Map<string, Run>();
  const scopeRun = (target: string, provided: Map<string, ReasoningValue>): Run => {
    const plan = plans.get(target);
    if (!plan) throw new EvaluationError(`Champ d'application appelable inconnu : ${target}.`);
    const key = `${target}|${[...provided].map(([name, value]) => `${name}=${JSON.stringify(value)}`).sort().join('&')}`;
    if (!runs.has(key)) runs.set(key, makeRun(plan, provided));
    return runs.get(key)!;
  };

  const makeRun = (plan: ScopePlan, provided: Map<string, ReasoningValue>): Run => {
    const { scope, rules, ruleState, blocked, rounding } = plan;
    const values = new Map<string, ReasoningValue>();
    const errors = new Map<string, string>();
    const visiting = new Set<string>();
    const item = (name: string) => variablesOf(scope).find((entry) => entry.name === name);
    const subScopeOf = (name: string) => {
      const entry = scope.items.find((candidate) => candidate.role === 'champ' && candidate.name === name);
      return entry?.role === 'champ' ? entry.scope : undefined;
    };
    const inputOf = (name: string) => (provided.has(name) ? provided.get(name)! : established(scope.scope, name));
    const inputsOf = (sub: string) => {
      const inputs = new Map<string, ReasoningValue>();
      for (const rule of rules) {
        if (rule.kind !== 'définition' || rule.target.length !== 2 || rule.target[0] !== sub) continue;
        const condition = rule.condition ? evaluate(rule.condition, new Map(), host) : true;
        if (condition === true) inputs.set(rule.target[1], evaluate(rule.consequence as Expression, new Map(), host));
      }
      return inputs;
    };
    const definition = (name: string, type: string, own: Rule[], argValues: ReasoningValue[], base: Locals = new Map()): ReasoningValue => {
      const localsOf = (rule: Rule): Locals => new Map([...base, ...(rule.args ?? []).map((arg, index) => [arg, argValues[index] ?? null] as [string, ReasoningValue])]);
      const applies = (rule: Rule): boolean | null => {
        const state = ruleState.get(rule)!.applies;
        if (state === false) return false;
        const condition = rule.condition ? evaluate(rule.condition, localsOf(rule), host) : true;
        if (condition !== null && typeof condition !== 'boolean') throw new EvaluationError('Condition non booléenne.');
        return condition === false ? false : condition === null || state === null ? null : true;
      };
      const consequence = (rule: Rule): ReasoningValue => (typeof rule.consequence === 'boolean' ? rule.consequence : evaluate(rule.consequence, localsOf(rule), host));
      const exceptions = own.filter((rule) => rule.exception !== undefined).map((rule) => ({ rule, applies: applies(rule) }));
      if (exceptions.some((outcome) => outcome.applies === null)) return null;
      const active = exceptions.filter((outcome) => outcome.applies === true).map((outcome) => consequence(outcome.rule));
      const baseOutcomes = own
        .filter((rule) => rule.exception === undefined && !exceptions.some((outcome) => outcome.applies === true && outcome.rule.exception === (rule.label ?? '')))
        .map((rule) => ({ rule, applies: applies(rule) }));
      if (type === 'condition') {
        const decided = distinct(active);
        if (decided.some((entry) => entry === null)) return null;
        if (decided.length > 1) throw new EvaluationError(`Conflit : plusieurs exceptions applicables donnent des valeurs différentes à ${name}.`);
        if (decided.length === 1) return decided[0];
        if (baseOutcomes.some((outcome) => outcome.applies === true && consequence(outcome.rule) === true)) return true;
        return baseOutcomes.some((outcome) => outcome.applies === null) ? null : false;
      }
      const contributions = [...active, ...baseOutcomes.filter((outcome) => outcome.applies === true).map((outcome) => consequence(outcome.rule))];
      if (contributions.some((entry) => entry === null)) return null;
      const decided = distinct(contributions);
      if (decided.length > 1) throw new EvaluationError(`Conflit : plusieurs définitions applicables de ${name}.`);
      return decided.length === 1 ? decided[0] : null;
    };
    const stateValue = (entry: Variable): ReasoningValue => {
      let previous: ReasoningValue = null;
      for (const state of entry.states ?? []) {
        const own = rules.filter((rule) => rule.target.length === 1 && rule.target[0] === entry.name && rule.state === state);
        previous = own.length ? definition(entry.name, entry.type, own, [], new Map([[entry.name, previous]])) : null;
      }
      return previous;
    };
    const variable = (name: string): ReasoningValue => {
      const entry = item(name);
      if (!entry) throw new EvaluationError(`Variable non déclarée : ${name}.`);
      if (isInput(entry)) return inputOf(name);
      if (entry.args?.length) throw new EvaluationError(`« ${name} » dépend d’arguments : appel attendu.`);
      if (entry.role.startsWith('contexte') && provided.has(name)) return provided.get(name)!;
      if (entry.role.startsWith('contexte') && established(scope.scope, name) !== null) return established(scope.scope, name);
      if (values.has(name)) return values.get(name)!;
      if (visiting.has(name)) throw new EvaluationError(`Définition circulaire : ${name}.`);
      visiting.add(name);
      let value: ReasoningValue = null;
      try {
        value = nested(() => (entry.states?.length ? stateValue(entry) : definition(name, entry.type, rules.filter((rule) => rule.target.length === 1 && rule.target[0] === name), [])));
      } catch (error) {
        errors.set(name, error instanceof Error ? error.message : String(error));
      }
      visiting.delete(name);
      if (blocked.has(`${scope.scope}.${name}`) || errors.has(name)) value = null;
      values.set(name, value);
      return value;
    };
    const host: Host = {
      rounding,
      lookup(name) {
        if (item(name)) return variable(name);
        if (globals.has(name)) return globalValue(name);
        if (caseOwner.has(name)) return { énumération: enumOf(name), cas: name };
        throw new EvaluationError(`Variable non déclarée : ${name}.`);
      },
      call(name, args) {
        const local = item(name);
        if (local?.args?.length) {
          if (args.length !== local.args.length) throw new EvaluationError(`« ${name} » attend ${local.args.length} argument(s).`);
          return nested(() => definition(name, local.type, rules.filter((rule) => rule.target.length === 1 && rule.target[0] === name), args));
        }
        return callGlobal(name, args);
      },
      sub(head, name) {
        const target = subScopeOf(head);
        if (!target) return undefined;
        return scopeRun(target, inputsOf(head)).variable(name);
      },
      scopeCall(target, given) {
        const run = scopeRun(target, given);
        const results = variablesOf(plans.get(target)!.scope).filter((entry) => entry.role.includes('résultat'));
        return { structure: `résultat de ${target}`, champs: Object.fromEntries(results.map((entry) => [entry.name, run.variable(entry.name)])) };
      },
      enumOf,
    };
    return {
      errors,
      variable,
      evaluate: (expression) => nested(() => evaluate(expression, new Map(), host)),
    };
  };

  const questions: ReasoningQuestion[] = [];
  const conditions = new Map<string, ReasoningCondition>();
  for (const scope of lawScopes) {
    const { rules, ruleState, blocked, vigueur, reference } = plans.get(scope.scope)!;
    const run = scopeRun(scope.scope, new Map());
    const factValue = (name: string) => established(scope.scope, name);
    const typeOf = new Map(variablesOf(scope).map((entry) => [entry.name, entry.type] as const));
    const dependencies = (rule: Rule) => {
      const names = new Set<string>();
      if (rule.condition) for (const name of freeVariables(rule.condition, rule.args)) names.add(name);
      if (typeof rule.consequence !== 'boolean') for (const name of freeVariables(rule.consequence, rule.args)) names.add(name);
      return [...names].filter((name) => !caseOwner.has(name));
    };
    const conditionIds: string[] = [];
    for (const entry of variablesOf(scope)) {
      if (isInput(entry)) continue;
      const id = `${scope.scope}.${entry.name}`;
      const isFunction = Boolean(entry.args?.length);
      const own = rules.filter((rule) => rule.target.length === 1 && rule.target[0] === entry.name);
      const states = own.map((rule) => ruleState.get(rule)!);
      const usable = [...new Set(states.flatMap((state) => state.sources))];
      const ranks = usable.map((sourceId) => STRENGTH[sources.get(sourceId)!.kind]);
      const strength = ranks.sort((a, b) => RANK[b] - RANK[a])[0] ?? null;
      const issues = isFunction ? [] : [...new Set(states.flatMap((state) => state.issues))];
      const review = items.get(id)?.review;
      if (!isFunction) {
        if (!own.length) issues.push(`Aucune règle ne définit ${entry.name}.`);
        if (strength === 'doctrine') issues.push('Fondée sur la seule doctrine : à confirmer par un texte ou une décision.');
        if (review?.status === 'écarté') issues.push('Écartée par l’avocat.');
      }
      const dependsOn = [...new Set(own.flatMap((rule) => dependencies(rule)))].map((name) => `${scope.scope}.${name}`);
      conditions.set(id, { id, scope: scope.scope, variable: entry.name, label: own.find((rule) => rule.attrs['libellé'])?.attrs['libellé'].join(', ') ?? entry.name, code: own.map((rule) => printRule(rule, '')).join(''), sources: usable, strength, dependsOn, value: null, status: 'indéterminée', issues, ...(review ? { review } : {}) });
      if (!isFunction) conditionIds.push(id);
    }
    for (const id of conditionIds) {
      const condition = conditions.get(id)!;
      condition.value = run.variable(condition.variable);
      const error = run.errors.get(condition.variable);
      if (error) condition.issues.push(error);
      condition.status = blocked.has(id) || error ? 'bloquée' : condition.value === true ? 'remplie' : condition.value === false ? 'non remplie' : 'indéterminée';
    }

    const result = variablesOf(scope).find((entry) => entry.role.includes('résultat'));
    const closure = new Set<string>();
    const walk = (id: string) => { if (closure.has(id)) return; closure.add(id); conditions.get(id)?.dependsOn.forEach(walk); };
    if (result) walk(`${scope.scope}.${result.name}`);
    const resultCondition = result ? conditions.get(`${scope.scope}.${result.name}`) : undefined;
    const issues: string[] = [];
    const question = scope.attrs.question?.join(', ') ?? '';
    if (!question) issues.push('Question de droit à énoncer : #[question = "…"].');
    if (!result) issues.push('Résultat à déclarer : il répond à la question.');
    if (!reference) issues.push('Date de référence à désigner : #[date_de_référence = entrée de type date].');
    else if (typeOf.get(reference) !== 'date' || !facts.has(`${scope.scope}.${reference}`)) issues.push(`La date de référence ${reference} doit être une entrée de type date.`);
    if (!conditionIds.some((id) => conditions.get(id)!.sources.length && id !== resultCondition?.id)) issues.push('Au moins une condition fondée est requise.');
    if (!vigueur.length) issues.push('Aucun article cité : la vigueur du texte applicable n’est pas contrôlée.');
    for (const rule of rules) {
      if (rule.kind !== 'assertion') continue;
      let outcome: ReasoningValue = null;
      try { outcome = run.evaluate(rule.consequence as Expression); } catch { outcome = null; }
      const label = rule.attrs['libellé']?.join(', ') ?? printExpression(rule.consequence as Expression);
      if (outcome === false) issues.push(`Assertion non vérifiée : ${label}`);
      else if (outcome !== true) issues.push(`Assertion à établir : ${label}`);
    }
    const status = [...closure].some((id) => conditions.get(id)?.status === 'bloquée') ? 'bloquée' : resultCondition?.status === 'bloquée' ? 'bloquée' : resultCondition?.value === true ? 'remplie' : resultCondition?.value === false ? 'non remplie' : 'indéterminée';
    const objective = scope.attrs.objectif?.join(' ');
    const goal = objective === 'rempli' ? true : objective === 'non rempli' ? false : null;
    if (objective && goal === null) issues.push('Objectif attendu : rempli ou non rempli.');
    const reach = (rule: Rule) => {
      const found = new Set<string>();
      const visit = (name: string) => {
        const id = `${scope.scope}.${name}`;
        if (found.has(id)) return;
        found.add(id);
        conditions.get(id)?.dependsOn.forEach((dependency) => visit(dependency.slice(scope.scope.length + 1)));
      };
      (rule.condition ? [...freeVariables(rule.condition, rule.args)] : []).forEach(visit);
      return [...found];
    };
    const voieFacts = new Map<ReasoningVoie, string[]>();
    const voies: ReasoningVoie[] = (result ? rules.filter((rule) => rule.target.length === 1 && rule.target[0] === result.name) : []).map((rule) => {
      const state = ruleState.get(rule)!;
      const members = reach(rule);
      let value: ReasoningValue = null;
      try { value = rule.condition ? run.evaluate(rule.condition) : true; } catch { value = null; }
      const branch = members.map((id) => conditions.get(id)).filter((entry): entry is ReasoningCondition => Boolean(entry));
      const kinds = [...state.sources.map((id) => STRENGTH[sources.get(id)!.kind]), ...branch.flatMap((entry) => (entry.strength ? [entry.strength] : []))];
      const weaknesses = [
        ...branch.filter((entry) => entry.strength === 'doctrine').map((entry) => `${entry.label} : fondée sur la seule doctrine.`),
        ...branch.flatMap((entry) => entry.issues.filter((issue) => issue.includes('à examiner'))),
        ...members.map((id) => facts.get(id)).filter((fact): fact is ReasoningFact => fact?.status === 'établi' && (fact.force === 'indice' || fact.force === 'commencement_de_preuve')).map((fact) => `${fact.variable} : ${fact.force === 'indice' ? 'simple indice' : 'commencement de preuve'}.`),
      ];
      const voie: ReasoningVoie = {
        label: rule.attrs['libellé']?.join(', ') ?? printRule({ ...rule, attrs: {} }, '').trim(),
        code: printRule(rule, '').trim(),
        favorable: goal === null || rule.consequence === goal,
        status: state.blocking || branch.some((entry) => entry.status === 'bloquée') ? 'bloquée' : state.applies === false || value === false ? 'fermée' : state.applies === true && value === true ? 'ouverte' : 'à établir',
        strength: kinds.sort((a, b) => RANK[a] - RANK[b])[0] ?? null,
        conditions: branch.map((entry) => entry.id),
        toProve: members.filter((id) => facts.get(id)?.status === 'non établi'),
        weaknesses,
      };
      voieFacts.set(voie, members.filter((id) => facts.has(id)));
      return voie;
    });
    const ORDER = { ouverte: 0, 'à établir': 1, fermée: 2, bloquée: 3 };
    voies.sort((a, b) => Number(b.favorable) - Number(a.favorable) || ORDER[a.status] - ORDER[b.status] || (b.strength ? RANK[b.strength] : 0) - (a.strength ? RANK[a.strength] : 0) || a.toProve.length - b.toProve.length);
    if (goal !== null) {
      const ours = new Set(voies.filter((voie) => voie.favorable).flatMap((voie) => voieFacts.get(voie)!));
      const theirs = new Set(voies.filter((voie) => !voie.favorable).flatMap((voie) => voieFacts.get(voie)!));
      for (const id of ours) facts.get(id)!.burden = 'nous';
      for (const id of theirs) if (!ours.has(id)) facts.get(id)!.burden = 'adversaire';
    }
    questions.push({
      scope: scope.scope, question, result: result?.name ?? '', value: resultCondition?.value ?? null, status,
      referenceDate: reference ? (factValue(reference) as string | null) : null, vigueur,
      conditions: conditionIds, facts: [...facts.values()].filter((fact) => fact.scope === scope.scope).map((fact) => fact.id),
      valid: !issues.length,
      issues,
      objective: goal,
      objectiveStatus: goal === null ? null : resultCondition?.value === goal ? 'atteint' : resultCondition?.value === !goal ? 'hors d’atteinte' : 'à établir',
      voies,
    });
  }
  return { questions, conditions: [...conditions.values()], facts: [...facts.values()], diagnostics };
}
