import type { ReasoningEvaluation, ReasoningExpression, ReasoningProgram, ReasoningTheory } from '../../../shared/piecemaker-reasoning.js';

export function assessTheories(program: ReasoningProgram, evaluations: ReasoningEvaluation[]): ReasoningTheory[] {
  return program.nodes.filter((node) => node.layer === 'theory' && node.kind === 'conclusion').map((theory) => {
    const visited = new Set<string>();
    const facts = new Set<string>();
    const laws = new Set<string>();
    const visit = (expression: ReasoningExpression): void => {
      if (!expression || typeof expression !== 'object') return;
      if ('apply' in expression) {
        const rule = program.nodes.find((node) => node.id === expression.apply);
        if (rule?.layer === 'law') laws.add(rule.id);
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
    const issues = [
      ...(!laws.size ? ['Aucune application datée de règle de droit dans cette théorie.'] : []),
      ...(!facts.size ? ['Aucune entrée factuelle dans cette théorie.'] : []),
      ...(!tests.length ? ['Aucun test pour cette conclusion.'] : []),
      ...(tests.some((test) => !test.rationale?.trim()) ? ['Origine des attentes des tests à expliciter.'] : []),
    ];
    const status = !laws.size || !facts.size ? 'incomplete' : !tests.length ? 'untested' : results.some((test) => !test.passed) ? 'failing' : tests.some((test) => !test.rationale?.trim()) ? 'incomplete' : 'passing';
    return { id: theory.id, label: theory.label, facts: [...facts], laws: [...laws], tests: tests.map((test) => test.id), status, issues };
  });
}
