import type { ReasoningEvaluation, ReasoningExpression, ReasoningProgram, ReasoningResult, ReasoningValue } from '../../../shared/piecemaker-reasoning.js';

import { detectConflicts, isLegalDate, validateAnnotations } from './model.js';

const ID = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const OPS: Record<string, [number, number]> = { and: [2, 20], or: [2, 20], not: [1, 1], equal: [2, 2], greater: [2, 2], atLeast: [2, 2], less: [2, 2], atMost: [2, 2], add: [2, 20], subtract: [2, 2], multiply: [2, 20], divide: [2, 2], if: [3, 3] };

export function emptyProgram(): ReasoningProgram {
  return { version: 1, nodes: [], sources: [], scenarios: [], tests: [] };
}

export function validateProgram(program: ReasoningProgram) {
  if (program.version !== 1 || !Array.isArray(program.nodes) || !Array.isArray(program.sources) || !Array.isArray(program.scenarios) || !Array.isArray(program.tests)) throw new TypeError('Programme version 1 attendu.');
  if (program.nodes.length > 200 || program.sources.length > 1000 || program.scenarios.length > 16 || program.tests.length > 200) throw new TypeError('Programme trop volumineux (200 nœuds, 1000 sources, 16 scénarios, 200 tests).');
  const scalar = (value: unknown): value is ReasoningValue => value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
  const validateExpression = (expression: ReasoningExpression, depth = 0): void => {
    if (scalar(expression)) return;
    if (depth > 20 || !expression || typeof expression !== 'object') throw new TypeError('Expression invalide ou trop profonde.');
    if ('ref' in expression) {
      if (!ID.test(expression.ref)) throw new TypeError('Référence invalide.');
      return;
    }
    if ('apply' in expression) {
      if (!ID.test(expression.apply) || !expression.bindings || typeof expression.bindings !== 'object' || Array.isArray(expression.bindings) || Object.keys(expression.bindings).length > 20 || Object.keys(expression.bindings).some((id) => !ID.test(id))) throw new TypeError('Application de règle invalide.');
      Object.values(expression.bindings).forEach((argument) => validateExpression(argument, depth + 1));
      validateExpression(expression.at, depth + 1);
      return;
    }
    const arity = OPS[expression.op];
    if (!Object.hasOwn(OPS, expression.op) || !Array.isArray(expression.args) || expression.args.length < arity[0] || expression.args.length > arity[1]) throw new TypeError('Opérateur ou nombre d’arguments invalide.');
    expression.args.forEach((argument) => validateExpression(argument, depth + 1));
  };
  const unique = (items: Array<{ id: string }>) => {
    if (items.some((item) => !item || !ID.test(item.id)) || new Set(items.map((item) => item.id)).size !== items.length) throw new TypeError('Identifiants invalides ou dupliqués.');
  };
  unique(program.nodes);
  unique(program.scenarios);
  unique(program.tests);
  for (const node of program.nodes) {
    if (!['fact', 'rule', 'calculation', 'conclusion'].includes(node.kind) || typeof node.label !== 'string' || !node.label.trim() || node.label.length > 2000) throw new TypeError(`Nœud invalide : ${node.id}.`);
    if (!Array.isArray(node.sources) || node.sources.some((id) => typeof id !== 'string')) throw new TypeError(`Sources invalides : ${node.id}.`);
    if (node.state !== undefined && !['asserted', 'disputed', 'unknown', 'reported'].includes(node.state)) throw new TypeError(`État invalide : ${node.id}.`);
    if (node.kind === 'fact') {
      if (node.expression !== undefined || (node.value !== undefined && !scalar(node.value))) throw new TypeError(`Fait invalide : ${node.id}.`);
    } else {
      if (node.expression === undefined || node.value !== undefined) throw new TypeError(`Expression attendue : ${node.id}.`);
      validateExpression(node.expression);
    }
  }
  for (const scenario of program.scenarios) {
    if (typeof scenario.label !== 'string' || !scenario.assumptions || typeof scenario.assumptions !== 'object' || Array.isArray(scenario.assumptions)) throw new TypeError('Scénario invalide.');
    for (const [id, value] of Object.entries(scenario.assumptions)) {
      if (!scalar(value) || !program.nodes.some((node) => node.id === id && node.kind === 'fact')) throw new TypeError(`Une hypothèse doit viser un fait existant : ${id}.`);
    }
  }
  for (const test of program.tests) {
    if (typeof test.label !== 'string' || !program.nodes.some((node) => node.id === test.target) || (test.scenario && !program.scenarios.some((scenario) => scenario.id === test.scenario))) throw new TypeError(`Cible ou scénario du test introuvable : ${test.id}.`);
    if (!test.expected || !['known', 'unknown', 'blocked', 'error'].includes(test.expected.status) || (Object.hasOwn(test.expected, 'value') && !scalar(test.expected.value))) throw new TypeError(`Attente invalide : ${test.id}.`);
    if (test.rationale !== undefined && (typeof test.rationale !== 'string' || test.rationale.length > 8000)) throw new TypeError(`Justification du test invalide : ${test.id}.`);
  }
  validateAnnotations(program);
}

export function evaluateProgram(program: ReasoningProgram): ReasoningEvaluation[] {
  validateProgram(program);
  const nodes = new Map(program.nodes.map((node) => [node.id, node]));
  const sources = new Map(program.sources.map((source) => [source.id, source]));
  const conflicts = detectConflicts(program);
  const evaluations = [{ id: 'base', label: 'Dossier sans hypothèses', assumptions: {} as Record<string, ReasoningValue> }, ...program.scenarios].map((scenario) => {
    const cache = new Map<string, ReasoningResult>();
    const evaluating = new Set<string>();
    const applying = new Set<string>();
    const outcome = (id: string, status: ReasoningResult['status'], value: ReasoningValue = null, issues: string[] = []): ReasoningResult => ({ id, status, value, dependencies: [], missing: status === 'unknown' ? [id] : [], assumptions: [], issues });
    const merge = (id: string, children: ReasoningResult[], result: ReasoningResult): ReasoningResult => ({
      ...result, id,
      dependencies: [...new Set(children.flatMap((child) => child.dependencies))],
      missing: [...new Set(children.flatMap((child) => child.missing))],
      assumptions: [...new Set(children.flatMap((child) => child.assumptions))],
      issues: [...new Set([...result.issues, ...children.flatMap((child) => child.issues)])],
    });
    const sourceIssues = (node: ReasoningProgram['nodes'][number]): string[] => {
      if (node.inputIssue) return [node.inputIssue];
      const objections = conflicts.filter((conflict) => conflict.nodes.includes(node.id));
      if (objections.length) return objections.map((conflict) => conflict.message);
      if (node.kind === 'rule' && node.layer !== 'law' && node.sources.some((id) => sources.get(id)?.document.startsWith('article:'))) return ['Règle juridique ancienne sans couche droit ni période : reformaliser cette version.'];
      if (node.requiresReview || node.sources.some((id) => { const source = sources.get(id); return !source || !source.verified || source.repaired || source.stale; })) return ['Source absente, non vérifiée, recalée ou remplacée : interprétation à réexaminer.'];
      if (node.layer === 'law') {
        if (node.state && node.state !== 'asserted') return ['Interprétation de la règle de droit contestée ou indéterminée.'];
        if (!node.sources.length) return ['Règle de droit sans source.'];
        for (const id of node.sources) {
          const source = sources.get(id)!;
          if (source.nature === 'article' || source.document.startsWith('article:')) {
            if (!source.validity) return ['Période du texte non retrouvée dans la source lue.'];
            if (node.validity!.from < source.validity.from || (source.validity.to !== null && (node.validity!.to === null || node.validity!.to > source.validity.to))) return ['La période de la règle dépasse celle du texte lu.'];
          }
        }
      }
      return [];
    };
    const expression = (value: ReasoningExpression, bindings: Record<string, ReasoningResult> = {}): ReasoningResult => {
      if (value === null || typeof value !== 'object') return value === null ? outcome('', 'unknown') : outcome('', 'known', value);
      if ('ref' in value) {
        if (Object.hasOwn(bindings, value.ref)) return bindings[value.ref];
        const result = evaluate(value.ref);
        return { ...result, dependencies: [...new Set([value.ref, ...result.dependencies])] };
      }
      if ('apply' in value) {
        const rule = nodes.get(value.apply);
        if (!rule || rule.layer !== 'law') return outcome('', 'blocked', null, [`Règle de droit absente : ${value.apply}.`]);
        if (applying.has(rule.id)) return outcome('', 'error', null, [`Cycle d’applications : ${rule.id}.`]);
        const issues = sourceIssues(rule);
        if (issues.length) return outcome('', 'blocked', null, issues);
        const parameters = rule.parameters ?? [];
        if (Object.keys(value.bindings).some((id) => !parameters.includes(id)) || parameters.some((id) => !Object.hasOwn(value.bindings, id))) return outcome('', 'blocked', null, [`Arguments incomplets ou inconnus pour ${rule.id}.`]);
        const date = expression(value.at, bindings);
        if (date.status !== 'known') return merge('', [date], outcome('', date.status, null, ['Date d’application à déterminer.']));
        if (!isLegalDate(date.value)) return outcome('', 'error', null, ['Date d’application ISO attendue.']);
        if (date.value < rule.validity!.from || (rule.validity!.to !== null && date.value >= rule.validity!.to)) return merge('', [date], outcome('', 'blocked', null, [`${rule.id} n’est pas applicable à la date ${date.value}.` ]));
        const args = Object.fromEntries(Object.entries(value.bindings).map(([id, argument]) => [id, expression(argument, bindings)]));
        applying.add(rule.id);
        const applied = expression(rule.expression!, args);
        applying.delete(rule.id);
        const result = merge('', [date, applied], applied);
        return { ...result, dependencies: [...new Set([rule.id, ...result.dependencies])] };
      }
      const first = expression(value.args[0], bindings);
      if (value.op === 'if') {
        if (first.status !== 'known') return first;
        if (typeof first.value !== 'boolean') return outcome('', 'error', null, ['La condition de if doit être booléenne.']);
        const branch = expression(value.args[first.value ? 1 : 2], bindings);
        return merge('', [first, branch], branch);
      }
      const args = [first, ...value.args.slice(1).map((argument) => expression(argument, bindings))];
      const failed = args.find((argument) => argument.status === 'error' || argument.status === 'blocked');
      if (failed) return merge('', args, outcome('', failed.status));
      if (value.op === 'and' || value.op === 'or') {
        if (args.some((argument) => argument.status === 'known' && typeof argument.value !== 'boolean')) return merge('', args, outcome('', 'error', null, ['and/or exigent des booléens.']));
        const decisive = args.find((argument) => argument.status === 'known' && argument.value === (value.op === 'or'));
        if (decisive) return merge('', [decisive], outcome('', 'known', decisive.value));
      }
      if (args.some((argument) => argument.status !== 'known')) return merge('', args, outcome('', 'unknown'));
      const values = args.map((argument) => argument.value);
      let result: ReasoningValue;
      if (value.op === 'equal') result = values[0] === values[1];
      else if (value.op === 'not') {
        if (typeof values[0] !== 'boolean') return merge('', args, outcome('', 'error', null, ['not exige un booléen.']));
        result = !values[0];
      } else if (value.op === 'and' || value.op === 'or') result = value.op === 'and' ? values.every(Boolean) : values.some(Boolean);
      else {
        if (!values.every((item) => typeof item === 'number')) return merge('', args, outcome('', 'error', null, ['Opération numérique sur une valeur non numérique.']));
        const numbers = values as number[];
        switch (value.op) {
          case 'add': result = numbers.reduce((a, b) => a + b, 0); break;
          case 'subtract': result = numbers[0] - numbers[1]; break;
          case 'multiply': result = numbers.reduce((a, b) => a * b, 1); break;
          case 'divide':
            if (numbers[1] === 0) return merge('', args, outcome('', 'error', null, ['Division par zéro.']));
            result = numbers[0] / numbers[1]; break;
          case 'greater': result = numbers[0] > numbers[1]; break;
          case 'atLeast': result = numbers[0] >= numbers[1]; break;
          case 'less': result = numbers[0] < numbers[1]; break;
          case 'atMost': result = numbers[0] <= numbers[1]; break;
          default: return outcome('', 'error', null, ['Opérateur inconnu.']);
        }
        if (typeof result === 'number' && (!Number.isFinite(result) || (Number.isInteger(result) && !Number.isSafeInteger(result)))) return merge('', args, outcome('', 'error', null, ['Résultat numérique non fini ou hors précision entière.']));
      }
      return merge('', args, outcome('', 'known', result));
    };
    const evaluate = (id: string): ReasoningResult => {
      const cached = cache.get(id);
      if (cached) return cached;
      if (evaluating.has(id)) return outcome(id, 'error', null, [`Cycle de dépendances : ${id}.`]);
      const node = nodes.get(id);
      if (!node) return outcome(id, 'unknown', null, [`Nœud absent : ${id}.`]);
      evaluating.add(id);
      let result: ReasoningResult;
      if (node.kind === 'fact' && Object.hasOwn(scenario.assumptions, id)) result = { ...outcome(id, scenario.assumptions[id] === null ? 'unknown' : 'known', scenario.assumptions[id]), assumptions: [id] };
      else if (sourceIssues(node).length) result = outcome(id, 'blocked', null, sourceIssues(node));
      else if (node.layer === 'law') result = outcome(id, 'unknown', null, ['Règle à appliquer avec ses paramètres et une date explicite.']);
      else if (node.kind === 'fact') {
        if (node.state === 'disputed' || node.state === 'unknown' || node.state === 'reported' || node.value === null || node.value === undefined) result = outcome(id, 'unknown');
        else if (!node.sources.length) result = outcome(id, 'blocked', null, ['Un fait renseigné doit être rattaché à une citation vérifiée.']);
        else result = outcome(id, 'known', node.value);
      } else result = { ...expression(node.expression!), id };
      evaluating.delete(id);
      if (result.status === 'unknown' && !result.missing.filter(Boolean).length) result.missing = [id];
      cache.set(id, result);
      return result;
    };
    return { scenario: scenario.id, results: program.nodes.map((node) => evaluate(node.id)), tests: [] } as ReasoningEvaluation;
  });
  for (const evaluation of evaluations) {
    evaluation.tests = program.tests.filter((test) => (test.scenario || 'base') === evaluation.scenario).map((test) => {
      const actual = evaluation.results.find((result) => result.id === test.target)!;
      return { id: test.id, label: test.label, expected: test.expected, actual, passed: actual.status === test.expected.status && (!Object.hasOwn(test.expected, 'value') || actual.value === test.expected.value) };
    });
  }
  return evaluations;
}
