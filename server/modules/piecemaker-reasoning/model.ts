import type { ReasoningConflict, ReasoningExpression, ReasoningProgram } from '../../../shared/piecemaker-reasoning.js';

export function isLegalDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function validateAnnotations(program: ReasoningProgram) {
  for (const node of program.nodes) {
    if (node.layer !== undefined && !['law', 'fact', 'theory'].includes(node.layer)) throw new TypeError(`Couche invalide : ${node.id}.`);
    if (node.layer === 'fact' && node.kind !== 'fact') throw new TypeError(`Un fait doit être une assertion : ${node.id}.`);
    if (node.layer === 'theory' && node.kind === 'fact') throw new TypeError(`Une théorie ne peut pas être un fait extrait : ${node.id}.`);
    if (node.layer === 'theory' && !node.rationale?.trim()) throw new TypeError(`Une théorie exige une justification : ${node.id}.`);
    if (node.parameters !== undefined && (node.layer !== 'law' || !Array.isArray(node.parameters) || node.parameters.length > 20 || node.parameters.some((parameter) => !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(parameter)) || new Set(node.parameters).size !== node.parameters.length)) throw new TypeError(`Paramètres invalides : ${node.id}.`);
    if (node.layer === 'law' && (node.kind !== 'rule' || !node.validity || !node.rationale?.trim())) throw new TypeError(`Une règle de droit exige une période de validité et une justification : ${node.id}.`);
    if (node.layer === 'law') {
      const checkParameters = (expression: ReasoningExpression): void => {
        if (!expression || typeof expression !== 'object') return;
        if ('ref' in expression) {
          if (!(node.parameters ?? []).includes(expression.ref)) throw new TypeError(`La règle ${node.id} doit recevoir ${expression.ref} en paramètre, sans dépendance implicite au dossier.`);
        } else if ('apply' in expression) { Object.values(expression.bindings).forEach(checkParameters); checkParameters(expression.at); }
        else expression.args.forEach(checkParameters);
      };
      checkParameters(node.expression!);
    }
    if (node.validity && (!isLegalDate(node.validity.from) || (node.validity.to !== null && (!isLegalDate(node.validity.to) || node.validity.to <= node.validity.from)))) throw new TypeError(`Période invalide : ${node.id} (fin exclusive).`);
    if (node.relation) {
      const relation = node.relation;
      if (node.kind !== 'fact' || ['subject', 'predicate', 'object', 'context'].some((field) => typeof relation[field as keyof typeof relation] !== 'string' || !String(relation[field as keyof typeof relation]).trim()) || Object.values(relation).some((value) => typeof value !== 'string' || value.length > 2000)) throw new TypeError(`Relation factuelle invalide : ${node.id}.`);
      for (const date of [relation.eventDate, relation.documentDate]) if (date !== undefined && !isLegalDate(date)) throw new TypeError(`Date factuelle invalide : ${node.id}.`);
    }
    if (node.input) {
      const input = node.input;
      if (node.kind !== 'fact' || !['piecemaker_nodes', 'piecemaker_links', 'piecemaker_citations'].includes(input.table) || !/^[a-z_][a-z0-9_]*$/i.test(input.column) || !input.where || typeof input.where !== 'object' || Array.isArray(input.where) || !Object.keys(input.where).length || Object.keys(input.where).length > 10 || Object.entries(input.where).some(([column, value]) => !/^[a-z_][a-z0-9_]*$/i.test(column) || column === 'project_id' || (value !== null && !['string', 'number', 'boolean'].includes(typeof value))) || (input.path !== undefined && (typeof input.path !== 'string' || !/^\$[.[]/.test(input.path) || input.path.length > 500))) throw new TypeError(`Liaison SQL invalide : ${node.id}.`);
    }
  }
  const identifiers = new Set([...program.nodes.map((node) => node.id), ...program.sources.map((source) => source.id)]);
  if (identifiers.size !== program.nodes.length + program.sources.length) throw new TypeError('Les sources et les propositions doivent avoir des identifiants distincts.');
  if (!Array.isArray(program.links ?? []) || (program.links?.length ?? 0) > 1000) throw new TypeError('Trop de liens de raisonnement.');
  const linkIds = new Set<string>();
  for (const link of program.links ?? []) {
    if (!link || typeof link.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(link.id) || linkIds.has(link.id) || !identifiers.has(link.from) || !identifiers.has(link.to) || !['supports', 'contradicts', 'reports', 'depends_on', 'qualifies', 'precedes'].includes(link.relation) || (link.rationale !== undefined && (typeof link.rationale !== 'string' || link.rationale.length > 8000))) throw new TypeError('Lien de raisonnement invalide ou extrémité absente.');
    linkIds.add(link.id);
  }
}

export function detectConflicts(program: ReasoningProgram): ReasoningConflict[] {
  const conflicts: ReasoningConflict[] = [];
  const facts = program.nodes.filter((node) => node.kind === 'fact' && node.relation && node.value !== undefined && node.value !== null);
  for (let index = 0; index < facts.length; index++) for (const other of facts.slice(index + 1)) {
    const node = facts[index];
    const identity = (relation: NonNullable<typeof node.relation>) => JSON.stringify([relation.subject, relation.predicate, relation.object, relation.context, relation.unit ?? '', relation.eventDate ?? '']);
    if (identity(node.relation!) === identity(other.relation!) && node.value !== other.value) conflicts.push({ kind: 'values', nodes: [node.id, other.id], message: `Valeurs incompatibles pour une même relation et un même périmètre : ${node.id} / ${other.id}.` });
  }
  for (const link of program.links ?? []) {
    if (link.relation === 'contradicts') conflicts.push({ kind: 'contradiction', nodes: [link.from, link.to], message: `Contradiction signalée, à examiner : ${link.from} / ${link.to}.` });
    if (link.relation === 'precedes') {
      const first = program.nodes.find((node) => node.id === link.from)?.relation?.eventDate;
      const second = program.nodes.find((node) => node.id === link.to)?.relation?.eventDate;
      if (first && second && first > second) conflicts.push({ kind: 'chronology', nodes: [link.from, link.to], message: `Chronologie incompatible avec le lien d’antériorité : ${link.from} (${first}) / ${link.to} (${second}).` });
    }
  }
  return conflicts;
}
