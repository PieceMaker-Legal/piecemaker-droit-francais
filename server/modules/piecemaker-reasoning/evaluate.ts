import { REASONING_FORCES } from '../../../shared/piecemaker-reasoning.js';
import type { ReasoningCondition, ReasoningDuration, ReasoningFact, ReasoningForce, ReasoningQuestion, ReasoningReview, ReasoningSource, ReasoningValue, ReasoningVigueur } from '../../../shared/piecemaker-reasoning.js';

import { printRule } from './catala.js';
import type { CatalaProgram, Declaration, Expression, Rule } from './catala.js';
import { isLegalDate } from './legal-period.js';

export type ReasoningItem = { review?: ReasoningReview; value?: ReasoningValue; force?: ReasoningForce | null; appreciation?: string; sources?: string[] };

const STRENGTH = { article: 'loi', case: 'jurisprudence', document: 'doctrine' } as const;
const RANK = { loi: 3, jurisprudence: 2, doctrine: 1 };

class EvaluationError extends Error {}

const isDuration = (value: ReasoningValue): value is ReasoningDuration => Boolean(value) && typeof value === 'object';
const isDate = (value: ReasoningValue): value is string => typeof value === 'string' && isLegalDate(value);

export function addDuration(date: string, duration: ReasoningDuration, sign = 1): string {
  const [year, month, day] = date.split('-').map(Number);
  const total = year * 12 + month - 1 + sign * (duration.ans * 12 + duration.mois);
  const targetYear = Math.floor(total / 12);
  const targetMonth = total - targetYear * 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const shifted = Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)) + sign * duration.jours * 86400000;
  return new Date(shifted).toISOString().slice(0, 10);
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

function arithmetic(operator: '+' | '-' | '*' | '/', left: ReasoningValue, right: ReasoningValue): ReasoningValue {
  if (typeof left === 'number' && typeof right === 'number') {
    if (operator === '/' && right === 0) throw new EvaluationError('Division par zéro.');
    return operator === '+' ? left + right : operator === '-' ? left - right : operator === '*' ? left * right : left / right;
  }
  if (isDate(left) && isDuration(right) && (operator === '+' || operator === '-')) return addDuration(left, right, operator === '+' ? 1 : -1);
  if (isDate(left) && isDate(right) && operator === '-') return { ans: 0, mois: 0, jours: Math.round((Date.parse(left) - Date.parse(right)) / 86400000) };
  if (isDuration(left) && isDuration(right) && (operator === '+' || operator === '-')) {
    const sign = operator === '+' ? 1 : -1;
    return { ans: left.ans + sign * right.ans, mois: left.mois + sign * right.mois, jours: left.jours + sign * right.jours };
  }
  throw new EvaluationError(`Opération « ${operator} » impossible sur ces types.`);
}

function typeMatches(type: string, value: ReasoningValue) {
  if (type === 'booléen' || type === 'condition') return typeof value === 'boolean';
  if (type === 'date') return isDate(value);
  if (type === 'durée') return isDuration(value);
  if (type === 'entier') return Number.isInteger(value);
  return typeof value === 'number';
}

function literal(expression: Expression): ReasoningValue | undefined {
  if (expression.t === 'lit') return expression.v;
  if (expression.t === 'neg' && expression.e.t === 'lit' && typeof expression.e.v === 'number') return -expression.e.v;
  return undefined;
}

function variables(expression: Expression | boolean | undefined, found = new Set<string>()): Set<string> {
  if (!expression || typeof expression === 'boolean') return found;
  if (expression.t === 'var') found.add(expression.path.join('.'));
  else if (expression.t === 'not' || expression.t === 'neg') variables(expression.e, found);
  else if (expression.t === 'bin') { variables(expression.l, found); variables(expression.r, found); }
  else if (expression.t === 'if') { variables(expression.c, found); variables(expression.a, found); variables(expression.b, found); }
  return found;
}

export function evaluateReasoning(program: CatalaProgram, sources: Map<string, ReasoningSource>, items: Map<string, ReasoningItem>, assumptions = new Map<string, ReasoningValue>()) {
  const diagnostics: string[] = [];
  const declarations = new Map<string, Declaration>();
  for (const declaration of program.declarations) {
    if (declarations.has(declaration.scope)) diagnostics.push(`Champ d'application déclaré deux fois : ${declaration.scope}.`);
    declarations.set(declaration.scope, declaration);
  }
  const rulesOf = (scope: string) => program.bodies.filter((body) => body.scope === scope).flatMap((body) => body.rules);
  for (const body of program.bodies) if (!declarations.has(body.scope)) diagnostics.push(`Champ d'application non déclaré : ${body.scope}.`);
  const isDossier = (declaration: Declaration) => declaration.items.some((item) => item.role === 'champ');
  const lawScopes = [...declarations.values()].filter((declaration) => !isDossier(declaration));

  const facts = new Map<string, ReasoningFact>();
  for (const scope of lawScopes) for (const item of scope.items) if (item.role === 'entrée') {
    facts.set(`${scope.scope}.${item.name}`, { id: `${scope.scope}.${item.name}`, scope: scope.scope, variable: item.name, type: item.type, value: null, force: null, appreciation: '', author: 'ia', sources: [], status: 'non établi', issues: [] });
  }
  for (const dossier of [...declarations.values()].filter(isDossier)) {
    const subScopes = new Map(dossier.items.flatMap((item) => (item.role === 'champ' ? [[item.name, item.scope] as const] : [])));
    for (const rule of rulesOf(dossier.scope)) {
      const scope = subScopes.get(rule.target[0]);
      const fact = scope && rule.target.length === 2 ? facts.get(`${scope}.${rule.target[1]}`) : undefined;
      if (!fact || rule.kind !== 'définition') { diagnostics.push(`${dossier.scope} : « ${rule.target.join('.')} » ne désigne pas une entrée d'un champ d'application.`); continue; }
      const value = rule.condition ? undefined : literal(rule.consequence as Expression);
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
    if (fact.value !== null && !typeMatches(fact.type, fact.value)) { fact.issues.push(`Valeur de type ${fact.type} attendue.`); fact.value = null; }
    if (fact.value !== null && !fact.force) fact.issues.push('Force probante de la pièce à indiquer.');
    const validated = fact.review?.status === 'validé';
    if (fact.review?.status === 'écarté') fact.issues.push('Écarté par l’avocat.');
    else if (fact.value !== null && (validated || (usable.length && fact.force && fact.force !== 'sans_valeur'))) fact.status = 'établi';
    if (assumptions.has(fact.id)) Object.assign(fact, { value: assumptions.get(fact.id), status: assumptions.get(fact.id) === null ? 'non établi' : 'établi', issues: ['Hypothèse de test.'] });
  }

  const conditions = new Map<string, ReasoningCondition>();
  const questions: ReasoningQuestion[] = [];
  for (const scope of lawScopes) {
    const rules = rulesOf(scope.scope);
    const typeOf = new Map(scope.items.flatMap((item) => (item.role === 'champ' ? [] : [[item.name, item.type] as const])));
    const reference = scope.attrs['date_de_référence']?.[0];
    const factValue = (name: string) => {
      const fact = facts.get(`${scope.scope}.${name}`);
      return fact?.status === 'établi' ? fact.value : null;
    };
    const vigueur: ReasoningVigueur[] = [];
    const ruleState = new Map<Rule, { applies: boolean | null; issues: string[]; blocking: boolean; sources: string[] }>();
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
        const date = dateName ? factValue(dateName) : null;
        const inForce = !source.validity || !isDate(date) ? null : source.validity.from <= date && (source.validity.to === null || date < source.validity.to);
        if (!source.validity) issues.push(`${source.title} : période de vigueur inconnue.`);
        else if (inForce === false) issues.push(`${source.title} : non en vigueur au ${date}.`);
        if (!vigueur.some((entry) => entry.source === id && entry.date === date)) vigueur.push({ source: id, date: isDate(date) ? date : null, inForce });
        applies = inForce === false ? false : inForce === null || applies === null ? (applies === false ? false : null) : applies;
      }
      if (!usable.length) issues.push(`Fondement manquant pour « ${rule.target.join('.')} » : citer le texte, la décision ou la doctrine qui pose la condition.`);
      ruleState.set(rule, { applies, issues, blocking: !usable.length || usable.some((id) => sources.get(id)!.kind === 'article' && !sources.get(id)!.validity), sources: usable });
    }

    const values = new Map<string, ReasoningValue>();
    const blocked = new Set<string>();
    const errors = new Map<string, string>();
    const visiting = new Set<string>();
    const evaluate = (expression: Expression): ReasoningValue => {
      switch (expression.t) {
        case 'lit': return expression.v;
        case 'var': {
          if (expression.path.length !== 1) throw new EvaluationError(`Chemin non pris en charge : ${expression.path.join('.')}.`);
          return variable(expression.path[0]);
        }
        case 'not': { const value = evaluate(expression.e); if (value === null) return null; if (typeof value !== 'boolean') throw new EvaluationError('« non » attend un booléen.'); return !value; }
        case 'neg': { const value = evaluate(expression.e); if (value === null) return null; if (typeof value !== 'number') throw new EvaluationError('Négation d’une valeur non numérique.'); return -value; }
        case 'if': {
          const condition = evaluate(expression.c);
          if (condition === null) { const a = evaluate(expression.a); const b = evaluate(expression.b); return JSON.stringify(a) === JSON.stringify(b) ? a : null; }
          return condition ? evaluate(expression.a) : evaluate(expression.b);
        }
        case 'bin': {
          if (expression.op === 'et' || expression.op === 'ou') {
            const stop = expression.op === 'ou';
            const left = evaluate(expression.l);
            if (left === stop) return stop;
            const right = evaluate(expression.r);
            if (right === stop) return stop;
            for (const value of [left, right]) if (value !== null && typeof value !== 'boolean') throw new EvaluationError(`« ${expression.op} » attend des booléens.`);
            return left === null || right === null ? null : !stop;
          }
          const left = evaluate(expression.l);
          const right = evaluate(expression.r);
          if (left === null || right === null) return null;
          if (expression.op === '=' || expression.op === '!=') return (JSON.stringify(left) === JSON.stringify(right)) === (expression.op === '=');
          if (expression.op === '+' || expression.op === '-' || expression.op === '*' || expression.op === '/') return arithmetic(expression.op, left, right);
          const order = compare(left, right);
          return expression.op === '<' ? order < 0 : expression.op === '<=' ? order <= 0 : expression.op === '>' ? order > 0 : order >= 0;
        }
      }
    };
    const variable = (name: string): ReasoningValue => {
      const type = typeOf.get(name);
      if (!type) throw new EvaluationError(`Variable non déclarée : ${name}.`);
      if (scope.items.some((item) => item.role === 'entrée' && item.name === name)) return factValue(name);
      if (values.has(name)) return values.get(name)!;
      if (visiting.has(name)) throw new EvaluationError(`Définition circulaire : ${name}.`);
      visiting.add(name);
      let value: ReasoningValue = null;
      try { value = defined(name, type); } catch (error) { errors.set(name, error instanceof Error ? error.message : String(error)); }
      visiting.delete(name);
      if (blocked.has(`${scope.scope}.${name}`) || errors.has(name)) value = null;
      values.set(name, value);
      return value;
    };
    const defined = (name: string, type: string): ReasoningValue => {
      const own = rules.filter((rule) => rule.target.length === 1 && rule.target[0] === name);
      const applies = (rule: Rule) => {
        const state = ruleState.get(rule)!.applies;
        if (state === false) return false;
        const condition = rule.condition ? evaluate(rule.condition) : true;
        if (condition !== null && typeof condition !== 'boolean') throw new EvaluationError('Condition non booléenne.');
        return condition === false ? false : condition === null || state === null ? null : true;
      };
      const consequence = (rule: Rule) => (typeof rule.consequence === 'boolean' ? rule.consequence : evaluate(rule.consequence));
      const exceptions = own.filter((rule) => rule.exception).map((rule) => ({ rule, applies: applies(rule) }));
      const active = exceptions.filter((outcome) => outcome.applies === true);
      const results = [...new Set(active.map((outcome) => JSON.stringify(consequence(outcome.rule))))];
      if (results.length > 1) throw new EvaluationError(`Conflit : plusieurs exceptions applicables donnent des valeurs différentes à ${name}.`);
      if (results.length === 1) return JSON.parse(results[0]);
      if (exceptions.some((outcome) => outcome.applies === null)) return null;
      const base = own.filter((rule) => !rule.exception).map((rule) => ({ rule, applies: applies(rule) }));
      if (type === 'condition') {
        if (base.some((outcome) => outcome.applies === true && outcome.rule.consequence === true)) return true;
        return base.some((outcome) => outcome.applies === null) ? null : false;
      }
      const values = [...new Set(base.filter((outcome) => outcome.applies === true).map((outcome) => JSON.stringify(consequence(outcome.rule))))];
      if (values.length > 1) throw new EvaluationError(`Conflit : plusieurs définitions applicables de ${name}.`);
      return values.length === 1 ? JSON.parse(values[0]) : null;
    };

    const conditionIds: string[] = [];
    for (const item of scope.items) {
      if (item.role === 'champ' || item.role === 'entrée') continue;
      const id = `${scope.scope}.${item.name}`;
      const own = rules.filter((rule) => rule.target.length === 1 && rule.target[0] === item.name);
      const states = own.map((rule) => ruleState.get(rule)!);
      const usable = [...new Set(states.flatMap((state) => state.sources))];
      const ranks = usable.map((sourceId) => STRENGTH[sources.get(sourceId)!.kind]);
      const strength = ranks.sort((a, b) => RANK[b] - RANK[a])[0] ?? null;
      const issues = [...new Set(states.flatMap((state) => state.issues))];
      if (!own.length) issues.push(`Aucune règle ne définit ${item.name}.`);
      if (strength === 'doctrine') issues.push('Fondée sur la seule doctrine : à confirmer par un texte ou une décision.');
      const review = items.get(id)?.review;
      if (review?.status === 'écarté') issues.push('Écartée par l’avocat.');
      if (!own.length || states.some((state) => state.blocking) || review?.status === 'écarté') blocked.add(id);
      const dependsOn = [...new Set(own.flatMap((rule) => [...variables(rule.condition), ...variables(rule.consequence)]))].map((name) => `${scope.scope}.${name}`);
      conditions.set(id, { id, scope: scope.scope, variable: item.name, label: own.find((rule) => rule.attrs['libellé'])?.attrs['libellé'].join(', ') ?? item.name, code: own.map((rule) => printRule(rule, '')).join(''), sources: usable, strength, dependsOn, value: null, status: 'indéterminée', issues, ...(review ? { review } : {}) });
      conditionIds.push(id);
    }
    for (const id of conditionIds) {
      const condition = conditions.get(id)!;
      condition.value = variable(condition.variable);
      const error = errors.get(condition.variable);
      if (error) condition.issues.push(error);
      condition.status = blocked.has(id) || error ? 'bloquée' : condition.value === true ? 'remplie' : condition.value === false ? 'non remplie' : 'indéterminée';
    }

    const result = scope.items.find((item) => item.role === 'résultat');
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
    const status = [...closure].some((id) => conditions.get(id)?.status === 'bloquée') ? 'bloquée' : resultCondition?.status === 'bloquée' ? 'bloquée' : resultCondition?.value === true ? 'remplie' : resultCondition?.value === false ? 'non remplie' : 'indéterminée';
    questions.push({
      scope: scope.scope, question, result: result?.name ?? '', value: resultCondition?.value ?? null, status,
      referenceDate: reference ? (factValue(reference) as string | null) : null, vigueur,
      conditions: conditionIds, facts: [...facts.values()].filter((fact) => fact.scope === scope.scope).map((fact) => fact.id),
      valid: !issues.length,
      issues,
    });
  }
  return { questions, conditions: [...conditions.values()], facts: [...facts.values()], diagnostics };
}
