import type { ReasoningExpression, ReasoningNode, ReasoningProgram, ReasoningSource } from '../../../shared/piecemaker-reasoning.js';

const article = (id: string, title: string, excerpt: string, from: string): ReasoningSource => ({
  id: `src_lib_${id}`, ref: 0, quoteIndex: 0, token: '', document: `article:${id}`, title, excerpt, hash: 'bibliotheque', verified: true, repaired: false, nature: 'article', validity: { from, to: null },
});

const SOURCES = [
  article('LEGIARTI000019017112', 'Code civil, art. 2224', 'Les actions personnelles ou mobilières se prescrivent par cinq ans à compter du jour où le titulaire d\'un droit a connu ou aurait dû connaître les faits lui permettant de l\'exercer.', '2008-06-19'),
  article('LEGIARTI000019017270', 'Code civil, art. 2229', 'Elle est acquise lorsque le dernier jour du terme est accompli.', '2008-06-19'),
];

export const LIBRARY: ReasoningNode[] = [{
  id: 'LIB_prescription_2224',
  kind: 'rule',
  layer: 'law',
  origin: 'library',
  label: 'Prescription quinquennale de droit commun acquise (C. civ., art. 2224 et 2229)',
  parameters: ['connaissance', 'action'],
  conditions: {
    connaissance: { label: 'Jour où le titulaire a connu ou aurait dû connaître les faits lui permettant d’agir' },
    action: { label: 'Date de l’acte interruptif invoqué (assignation, reconnaissance…)' },
  },
  validity: { from: '2008-06-19', to: null },
  expression: { op: 'greater', args: [{ ref: 'action' }, { op: 'addDuration', args: [{ ref: 'connaissance' }, 5, 'years'] }] },
  rationale: 'Vrai si l’acte est postérieur au dernier jour du terme de cinq ans, compté au même quantième (dernier jour du mois à défaut). Hors délais spéciaux, report du point de départ, suspension, interruption antérieure, aménagement conventionnel et dispositions transitoires de la loi du 17 juin 2008 : ces points restent à formaliser dans le dossier. Module à valider par l’avocat.',
  sources: SOURCES.map((source) => source.id),
}];

const references = (expression: ReasoningExpression | undefined): string[] => {
  if (!expression || typeof expression !== 'object') return [];
  if ('ref' in expression) return [];
  if ('apply' in expression) return [expression.apply, ...Object.values(expression.bindings).flatMap(references), ...references(expression.at)];
  return expression.args.flatMap(references);
};

export function withLibrary(program: ReasoningProgram): ReasoningProgram {
  const used = new Set(program.nodes.flatMap((node) => [...references(node.expression), ...(node.exceptions ?? []).flatMap((exception) => [...references(exception.when), ...references(exception.then)])]));
  const missing = LIBRARY.filter((rule) => used.has(rule.id) && !program.nodes.some((node) => node.id === rule.id));
  if (!missing.length) return program;
  const sources = SOURCES.filter((source) => missing.some((rule) => rule.sources.includes(source.id)) && !program.sources.some((entry) => entry.id === source.id));
  return { ...program, nodes: [...program.nodes, ...missing], sources: [...program.sources, ...sources] };
}
