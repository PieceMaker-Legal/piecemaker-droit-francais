import type { ReasoningEvaluation, ReasoningExpression, ReasoningMatrixRow, ReasoningProgram, ReasoningSnapshot, ReasoningTheory } from '../../../shared/piecemaker-reasoning.js';

export function assessTheories(program: ReasoningProgram, evaluations: ReasoningEvaluation[], changes: ReasoningSnapshot['changes'] = []): ReasoningTheory[] {
  const byId = new Map(program.nodes.map((node) => [node.id, node]));
  const base = new Map((evaluations.find((evaluation) => evaluation.scenario === 'base')?.results ?? []).map((result) => [result.id, result]));
  const factsOf = (expression: ReasoningExpression, seen = new Set<string>()): string[] => {
    if (!expression || typeof expression !== 'object') return [];
    if ('apply' in expression) return [...Object.values(expression.bindings).flatMap((binding) => factsOf(binding, seen)), ...factsOf(expression.at, seen)];
    if ('ref' in expression) {
      if (seen.has(expression.ref)) return [];
      seen.add(expression.ref);
      const node = byId.get(expression.ref);
      if (node?.kind === 'fact') return [node.id];
      return node?.expression && node.layer !== 'law' ? factsOf(node.expression, seen) : [];
    }
    return expression.args.flatMap((argument) => factsOf(argument, seen));
  };
  const row = (rule: string, parameter: string, label: string, expression: ReasoningExpression, burden?: string): ReasoningMatrixRow => {
    const facts = [...new Set(factsOf(expression))];
    const results = facts.map((id) => base.get(id));
    const proofs = results.map((result) => result?.proof);
    const status: ReasoningMatrixRow['status'] = !facts.length ? (typeof expression !== 'object' || expression === null ? 'established' : 'unknown')
      : results.some((result) => result?.status === 'blocked' || result?.status === 'error') ? 'blocked'
        : proofs.includes('unestablished') ? 'unestablished'
          : proofs.includes('disputed') ? 'disputed'
            : proofs.includes('to_examine') ? 'to_examine'
              : proofs.every((proof) => proof === 'established') ? 'established' : 'unknown';
    const nodes = facts.map((id) => byId.get(id)!);
    return {
      rule, parameter, label, facts, status,
      ...(burden ?? nodes.find((node) => node.burden)?.burden ? { burden: burden ?? nodes.find((node) => node.burden)!.burden } : {}),
      pieces: [...new Set(nodes.flatMap((node) => node.sources.map((id) => program.sources.find((source) => source.id === id)?.title ?? id)))],
      candidates: [...new Set(nodes.flatMap((node) => (node.evidenceCandidates ?? []).map((piece) => piece.label)))],
      objections: [...new Set((program.links ?? []).filter((link) => link.relation === 'contradicts' && (facts.includes(link.from) || facts.includes(link.to))).map((link) => byId.get(facts.includes(link.from) ? link.to : link.from)?.label ?? (facts.includes(link.from) ? link.to : link.from)))],
    };
  };
  return program.nodes.filter((node) => node.layer === 'theory' && node.kind === 'conclusion').map((theory) => {
    const visited = new Set<string>();
    const facts = new Set<string>();
    const laws = new Set<string>();
    const matrix: ReasoningMatrixRow[] = [];
    const visit = (expression: ReasoningExpression): void => {
      if (!expression || typeof expression !== 'object') return;
      if ('apply' in expression) {
        const rule = program.nodes.find((node) => node.id === expression.apply);
        if (rule?.layer === 'law') {
          laws.add(rule.id);
          for (const [parameter, binding] of Object.entries(expression.bindings)) matrix.push(row(rule.id, parameter, rule.conditions?.[parameter]?.label ?? parameter, binding, rule.conditions?.[parameter]?.burden));
          matrix.push(row(rule.id, '@date', 'Date d’application de la règle', expression.at));
        }
        Object.values(expression.bindings).forEach(visit);
        visit(expression.at);
      } else if ('ref' in expression) {
        if (visited.has(expression.ref)) return;
        visited.add(expression.ref);
        const node = program.nodes.find((entry) => entry.id === expression.ref);
        if (node?.kind === 'fact') facts.add(node.id);
        else if (node?.expression && node.layer !== 'law') visit(node.expression);
      } else expression.args.forEach(visit);
    };
    visit(theory.expression!);
    const tests = program.tests.filter((test) => test.target === theory.id);
    const results = evaluations.flatMap((evaluation) => evaluation.tests).filter((test) => tests.some((entry) => entry.id === test.id));
    const reopened = changes.some((change) => change.id === theory.id && change.scenario === 'base' && change.before !== 'Absent' && change.after !== 'Retiré');
    const issues = [
      ...(!laws.size ? ['Aucune application datée de règle de droit dans cette théorie.'] : []),
      ...(!facts.size ? ['Aucune entrée factuelle dans cette théorie.'] : []),
      ...(!tests.length ? ['Aucun test pour cette conclusion.'] : []),
      ...(tests.some((test) => !test.rationale?.trim()) ? ['Origine des attentes des tests à expliciter.'] : []),
      ...(reopened ? ['Résultat modifié au dernier changement : conclusion à réexaminer.'] : []),
    ];
    const status = !laws.size || !facts.size ? 'incomplete' : !tests.length ? 'untested' : results.some((test) => !test.passed) ? 'failing' : tests.some((test) => !test.rationale?.trim()) ? 'incomplete' : 'passing';
    return { id: theory.id, label: theory.label, facts: [...facts], laws: [...laws], tests: tests.map((test) => test.id), status, issues, validatedTests: tests.filter((test) => test.review?.decision === 'retained').length, matrix };
  });
}
