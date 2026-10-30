import type { ReasoningValue } from '../../../shared/piecemaker-reasoning.js';

import { basisControls, formulaConditions, SIDES } from './format.js';
import type { Condition, Duration, Foundation, Formula, Measure, Operand, Objective, Reasoning, Term, Trial } from './format.js';

export type Facts = { leaf(name: string): ReasoningValue; basis(path: string, condition: Condition, applicable: ReasoningValue[]): ReasoningValue; proven?(path: string, count: number): boolean };
export type Trace = Map<string, ReasoningValue>;
export type Test = (facts: Facts, trace?: Trace, roots?: string[]) => Map<string, ReasoningValue>;

export const and = (values: ReasoningValue[]): ReasoningValue => (values.includes(false) ? false : values.includes(null) ? null : true);
export const or = (values: ReasoningValue[]): ReasoningValue => (values.includes(true) ? true : values.includes(null) ? null : false);
const not = (value: ReasoningValue): ReasoningValue => (value === null ? null : !value);
const matches = (value: ReasoningValue, expected: boolean): ReasoningValue => (value === null ? null : value === expected);
export const isLeaf = (reasoning: Reasoning, name: string) => { const term = reasoning.terms.get(name); return !term || Boolean(term.fondements); };

export function structure(reasoning: Reasoning) {
  const leaves = new Set<string>();
  const used = new Set<string>();
  const cycles: string[] = [];
  const visit = (name: string, stack: string[]) => {
    if (stack.includes(name)) { cycles.push([...stack.slice(stack.indexOf(name)), name].join(' → ')); return; }
    const term = reasoning.terms.get(name);
    if (!term) { leaves.add(name); return; }
    if (term.fondements) leaves.add(name);
    const walk = (condition: Condition) => {
      for (const control of [...condition.selon.flatMap(basisControls), condition.decompte]) if (control) { used.add(control); visit(control, [...stack, name]); }
      if (condition.l_une) condition.l_une.forEach(walk);
      else { used.add(condition.condition!); visit(condition.condition!, [...stack, name]); }
    };
    [...term.si, ...term.sauf].forEach(walk);
    for (const side of SIDES) for (const entry of term.fondements?.[side] ?? []) {
      for (const control of entry.selon.flatMap(basisControls)) { used.add(control); visit(control, [...stack, name]); }
      entry.si.forEach(walk);
    }
  };
  for (const objective of reasoning.objectifs) for (const root of objectiveRoots(objective)) { used.add(root); if (reasoning.terms.has(root)) visit(root, []); }
  for (const value of reasoning.valeurs.values()) for (const name of value.formule ? formulaConditions(value.formule) : []) { used.add(name); visit(name, []); }
  for (const value of reasoning.valeurs.values()) for (const basis of value.selon) for (const control of basisControls(basis)) { used.add(control); visit(control, []); }
  for (const name of reasoning.terms.keys()) visit(name, []);
  return { leaves, used, cycles: [...new Set(cycles)] };
}

export const objectiveRoots = (objective: Objective) => [objective.effet, objective.validite, objective.prescription].filter((name): name is string => Boolean(name));
export const answer = (objective: Objective, values: Map<string, ReasoningValue>) => and(objectiveRoots(objective).map((name) => values.get(name) ?? null));

export function compile(reasoning: Reasoning): Test {
  return (facts, trace, roots = reasoning.objectifs.flatMap(objectiveRoots)) => {
    const memo = new Map<string, ReasoningValue>();
    const term = (name: string, stack: string[]): ReasoningValue => {
      if (memo.has(name)) return memo.get(name)!;
      const definition: Term | undefined = reasoning.terms.get(name);
      if (!definition || stack.includes(name)) return definition ? null : facts.leaf(name);
      const condition = (entry: Condition, path: string): ReasoningValue => {
        const inner = entry.l_une ? or(entry.l_une.map((member, index) => condition(member, `${path}.l_une[${index}]`))) : matches(term(entry.condition!, [...stack, name]), entry.attendu!);
        const applicable = entry.selon.map((basis) => and(basisControls(basis).map((control) => term(control, [...stack, name]))));
        const value = and([facts.basis(path, entry, applicable), inner, entry.decompte ? term(entry.decompte, [...stack, name]) : true]);
        trace?.set(path, value);
        return value;
      };
      const founded = (entry: Foundation, path: string): ReasoningValue => {
        const applicable = entry.selon.map((basis) => and(basisControls(basis).map((control) => term(control, [...stack, name]))));
        const proof = entry.preuve.length > 0 && Boolean(facts.proven?.(path, entry.preuve.length));
        const support = or([proof, entry.selon.length ? facts.basis(path, { selon: entry.selon }, applicable) : false]);
        const value = and([support, ...entry.si.map((member, index) => condition(member, `${path}.si[${index}]`))]);
        trace?.set(path, value);
        return value;
      };
      let value: ReasoningValue;
      if (definition.fondements) {
        const forced = facts.leaf(name);
        const sides = SIDES.map((side) => or(definition.fondements![side].map((entry, index) => founded(entry, `${name}.${side}[${index}]`))));
        trace?.set(`${name}:true`, sides[0]);
        trace?.set(`${name}:false`, sides[1]);
        value = forced !== null ? forced : sides[0] === true && sides[1] === false ? true : sides[0] === false && sides[1] === true ? false : null;
      } else value = and([...definition.si.map((entry, index) => condition(entry, `${name}.si[${index}]`)), not(or(definition.sauf.map((entry, index) => condition(entry, `${name}.sauf[${index}]`))))]);
      memo.set(name, value);
      trace?.set(name, value);
      return value;
    };
    return new Map(roots.map((root) => [root, term(root, [])]));
  };
}

export function reachableLeaves(reasoning: Reasoning, root: string) {
  const found = new Set<string>();
  const seen = new Set<string>();
  const visit = (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    const term = reasoning.terms.get(name);
    if (!term || term.fondements) { found.add(name); return; }
    const walk = (condition: Condition) => {
      for (const control of [...condition.selon.flatMap(basisControls), condition.decompte]) if (control) visit(control);
      if (condition.l_une) condition.l_une.forEach(walk); else visit(condition.condition!);
    };
    [...term.si, ...term.sauf].forEach(walk);
  };
  visit(root);
  return found;
}

export const ENUMERATION_LIMIT = 12;

export function decisive(test: Test, facts: Facts, objective: Objective, unknown: string[]): { decisive: string[]; inPlay: boolean } {
  if (unknown.length > ENUMERATION_LIMIT) return { decisive: unknown, inPlay: true };
  const found = new Set<string>();
  const total = 2 ** unknown.length;
  const run = (mask: number) => answer(objective, test({ ...facts, leaf: (name) => { const at = unknown.indexOf(name); return at < 0 ? facts.leaf(name) : Boolean(mask & (1 << at)); } }, undefined, objectiveRoots(objective)));
  const results = Array.from({ length: total }, (_, mask) => run(mask));
  for (let mask = 0; mask < total; mask += 1) {
    unknown.forEach((name, at) => { if (results[mask] !== results[mask ^ (1 << at)]) found.add(name); });
  }
  return { decisive: unknown.filter((name) => found.has(name)), inPlay: false };
}

export type Lookup = (name: string) => string | number | null;
export type Calculation = { value: ReasoningValue; missing: string[]; calcul: Record<string, string | number> | null };

export function addDuration(start: string, { unite, nombre }: Duration): string {
  const date = new Date(`${start}T00:00:00Z`);
  if (unite === 'jours') date.setUTCDate(date.getUTCDate() + nombre);
  else if (unite === 'jours_ouvres') for (let left = nombre; left > 0;) { date.setUTCDate(date.getUTCDate() + 1); if (date.getUTCDay() % 6 !== 0) left -= 1; }
  else {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + (unite === 'ans' ? nombre * 12 : nombre));
    date.setUTCDate(Math.min(day, new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()));
  }
  return date.toISOString().slice(0, 10);
}

export type Holds = (name: string) => ReasoningValue;

const cents = (value: number) => Math.round(value * 100) / 100;

export function evaluate(formula: Formula, lookup: Lookup, holds: Holds = () => null): number | null {
  const operand = (item: Operand): number | null => { const value = typeof item === 'number' ? item : typeof item === 'string' ? lookup(item) : evaluate(item, lookup, holds); return typeof value === 'number' ? value : null; };
  if (formula.operation === 'si') { const held = holds(formula.condition); return held === null ? null : operand(held ? formula.alors : formula.sinon); }
  if (formula.operation === 'bareme') {
    const base = operand(formula.assiette);
    const tranches = formula.tranches.map((tranche) => ({ limit: tranche.jusqu_a === null ? Infinity : operand(tranche.jusqu_a), rate: operand(tranche.taux) }));
    if (base === null || tranches.some((tranche) => tranche.limit === null || tranche.rate === null)) return null;
    let floor = 0;
    let total = 0;
    for (const tranche of tranches as Array<{ limit: number; rate: number }>) {
      if (base > floor) total += (Math.min(base, tranche.limit) - floor) * tranche.rate;
      floor = Math.max(floor, tranche.limit);
    }
    return cents(total);
  }
  const values = formula.termes.map(operand);
  if (values.some((value) => value === null)) return null;
  const [first, ...rest] = values as number[];
  if (formula.operation === 'arrondi') { const factor = 10 ** rest[0]; return Math.round(first * factor) / factor; }
  if (formula.operation === 'minimum') return Math.min(first, ...rest);
  if (formula.operation === 'maximum') return Math.max(first, ...rest);
  if (formula.operation === 'quotient' && rest.includes(0)) return null;
  return cents(rest.reduce((total, value) => (formula.operation === 'somme' ? total + value : formula.operation === 'difference' ? total - value : formula.operation === 'produit' ? total * value : total / value), first));
}

export function calculate(measure: Measure, lookup: Lookup): Calculation {
  if (measure.delai) {
    const { de, a, borne, duree } = measure.delai;
    const start = lookup(de);
    const end = lookup(a);
    const missing = [...(typeof start === 'string' ? [] : [de]), ...(typeof end === 'string' ? [] : [a])];
    if (typeof start !== 'string' || typeof end !== 'string') return { value: null, missing, calcul: null };
    const echeance = addDuration(start, duree);
    return { value: borne === 'au_plus' ? end <= echeance : end >= echeance, missing, calcul: { depart: start, echeance, date_retenue: end } };
  }
  const { valeur, comparaison, seuil } = measure.montant!;
  const amount = lookup(valeur);
  const threshold = typeof seuil === 'number' ? seuil : lookup(seuil);
  const missing = [...(typeof amount === 'number' ? [] : [valeur]), ...(typeof threshold === 'number' ? [] : [String(seuil)])];
  if (typeof amount !== 'number' || typeof threshold !== 'number') return { value: null, missing, calcul: null };
  const value = comparaison === 'plus_de' ? amount > threshold : comparaison === 'au_moins' ? amount >= threshold : comparaison === 'moins_de' ? amount < threshold : amount <= threshold;
  return { value, missing, calcul: { montant: amount, seuil: threshold } };
}

export type Known = { leaf(name: string): ReasoningValue; value(name: string, holds?: Holds): string | number | null; proven?(path: string, count: number): boolean; supported?(path: string): boolean };

export function simulate(reasoning: Reasoning, test: Test, known: Known, faits: Trial['faits']) {
  const computing = new Set<string>();
  const facts: Facts = {
    leaf: (name) => { const item = faits[name]; if (typeof item === 'boolean') return item; const measure = reasoning.computed.get(name); return measure ? calculate(measure, value).value : known.leaf(name); },
    basis: (at, _condition, applicable) => known.supported?.(at) === false ? null : (applicable.length ? or(applicable) : true),
    proven: known.proven,
  };
  const holds: Holds = (name) => (reasoning.terms.has(name) ? test(facts, undefined, [name]).get(name) ?? null : facts.leaf(name));
  function value(name: string): string | number | null {
    const item = faits[name];
    if (item !== undefined) return typeof item === 'boolean' ? null : item;
    const entry = reasoning.valeurs.get(name);
    if (!entry?.formule || entry.valeur !== null || computing.has(name)) return known.value(name, holds);
    computing.add(name);
    const result = evaluate(entry.formule, value, holds);
    computing.delete(name);
    return result;
  }
  return { test: (names: string[]) => test(facts, undefined, names), value, leaf: facts.leaf };
}

export function runTrials(reasoning: Reasoning, test: Test, known: Known = { leaf: () => null, value: () => null }) {
  return reasoning.hypotheses.map((trial) => {
    const run = simulate(reasoning, test, known, trial.faits);
    const names = Object.keys(trial.attendu);
    const values = run.test(names.filter((name) => !reasoning.valeurs.has(name)));
    const obtenu = Object.fromEntries(names.map((name) => [name, reasoning.valeurs.has(name) ? run.value(name) : values.get(name) ?? null])) as Record<string, ReasoningValue | number | string>;
    return { obtenu, conforme: Object.entries(trial.attendu).every(([name, expected]) => (typeof expected === 'number' ? typeof obtenu[name] === 'number' && Math.abs((obtenu[name] as number) - expected) < 0.005 : obtenu[name] === expected)) };
  });
}
