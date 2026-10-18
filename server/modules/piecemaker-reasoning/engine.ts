import type { ReasoningValue } from '../../../shared/piecemaker-reasoning.js';

import type { Condition, Reasoning, Term } from './format.js';

export type Facts = { leaf(name: string): ReasoningValue; basis(path: string, condition: Condition): ReasoningValue };
export type Trace = Map<string, ReasoningValue>;
export type Test = (facts: Facts, trace?: Trace, roots?: string[]) => Map<string, ReasoningValue>;

const and = (values: ReasoningValue[]): ReasoningValue => (values.includes(false) ? false : values.includes(null) ? null : true);
const or = (values: ReasoningValue[]): ReasoningValue => (values.includes(true) ? true : values.includes(null) ? null : false);
const not = (value: ReasoningValue): ReasoningValue => (value === null ? null : !value);

export function structure(reasoning: Reasoning) {
  const leaves = new Set<string>();
  const used = new Set<string>();
  const cycles: string[] = [];
  const visit = (name: string, stack: string[]) => {
    if (stack.includes(name)) { cycles.push([...stack.slice(stack.indexOf(name)), name].join(' → ')); return; }
    const term = reasoning.terms.get(name);
    if (!term) { leaves.add(name); return; }
    const walk = (condition: Condition) => {
      if (condition.l_une) condition.l_une.forEach(walk);
      else { used.add(condition.condition!); visit(condition.condition!, [...stack, name]); }
    };
    [...term.si, ...term.sauf].forEach(walk);
  };
  for (const question of reasoning.questions) if (reasoning.terms.has(question.reponse)) visit(question.reponse, []);
  for (const name of reasoning.terms.keys()) visit(name, []);
  return { leaves, used, cycles: [...new Set(cycles)] };
}

export function compile(reasoning: Reasoning): Test {
  return (facts, trace, roots = reasoning.questions.map((question) => question.reponse)) => {
    const memo = new Map<string, ReasoningValue>();
    const term = (name: string, stack: string[]): ReasoningValue => {
      if (memo.has(name)) return memo.get(name)!;
      const definition: Term | undefined = reasoning.terms.get(name);
      if (!definition || stack.includes(name)) return definition ? null : facts.leaf(name);
      const condition = (entry: Condition, path: string): ReasoningValue => {
        const inner = entry.l_une ? or(entry.l_une.map((member, index) => condition(member, `${path}.l_une[${index}]`))) : term(entry.condition!, [...stack, name]);
        const value = and([facts.basis(path, entry), inner]);
        trace?.set(path, value);
        return value;
      };
      const value = and([...definition.si.map((entry, index) => condition(entry, `${name}.si[${index}]`)), not(or(definition.sauf.map((entry, index) => condition(entry, `${name}.sauf[${index}]`))))]);
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
    if (!term) { found.add(name); return; }
    const walk = (condition: Condition) => (condition.l_une ? condition.l_une.forEach(walk) : visit(condition.condition!));
    [...term.si, ...term.sauf].forEach(walk);
  };
  visit(root);
  return found;
}

export const ENUMERATION_LIMIT = 12;

export function decisive(test: Test, facts: Facts, root: string, unknown: string[]): { decisive: string[]; inPlay: boolean } {
  if (unknown.length > ENUMERATION_LIMIT) return { decisive: unknown, inPlay: true };
  const found = new Set<string>();
  const total = 2 ** unknown.length;
  const run = (mask: number) => test({ ...facts, leaf: (name) => { const at = unknown.indexOf(name); return at < 0 ? facts.leaf(name) : Boolean(mask & (1 << at)); } }).get(root);
  const results = Array.from({ length: total }, (_, mask) => run(mask));
  for (let mask = 0; mask < total; mask += 1) {
    unknown.forEach((name, at) => { if (results[mask] !== results[mask ^ (1 << at)]) found.add(name); });
  }
  return { decisive: unknown.filter((name) => found.has(name)), inPlay: false };
}

export function runTrials(reasoning: Reasoning, test: Test) {
  return reasoning.essais.map((trial) => {
    const trace: Trace = new Map();
    const values = test({ leaf: (name) => trial.faits[name] ?? null, basis: () => true }, trace, Object.keys(trial.attendu));
    const obtenu = Object.fromEntries(Object.keys(trial.attendu).map((name) => [name, values.get(name) ?? null]));
    return { obtenu, conforme: Object.entries(trial.attendu).every(([name, expected]) => obtenu[name] === expected) };
  });
}
