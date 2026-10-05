import { partyCodeChange } from './party-codes.js';
import type { PartySide } from './party-codes.js';
import type { KnowledgeMapping, KnowledgeNode, KnowledgeUpdateOperation, NodeKind } from './types.js';

export type SelectionGraph = {
  nodes: KnowledgeNode[];
  mappings: KnowledgeMapping[];
  reservedCodes?: string[];
};

export type SelectionSide = 'client' | 'adversaire' | 'tiers';

export type SelectionChange = {
  operations: KnowledgeUpdateOperation[];
  graph: SelectionGraph;
  nodeId: string;
  previousId: string;
};

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const stripAccents = (value: string): string => value.normalize('NFKD').replace(/[̀-ͯ]/g, '');

export const cleanSelection = (value: string): string => value.replace(/\s+/g, ' ').trim();

const matchKey = (value: string): string => stripAccents(cleanSelection(value))
  .toLocaleLowerCase('fr-FR')
  .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseSelectionDate(selection: string): string | null {
  const value = stripAccents(cleanSelection(selection)).toLocaleLowerCase('fr-FR').replace(/^le\s+/, '').replace(/[.,;]+$/, '');
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value);
  if (numeric) return isoDate(Number(numeric[3]), Number(numeric[2]), Number(numeric[1]));
  const written = /^(\d{1,2})(?:er|e)?\s+([a-z]+)\s+(\d{4})$/.exec(value);
  const month = written ? MONTHS.indexOf(written[2]) : -1;
  return written && month >= 0 ? isoDate(Number(written[3]), month + 1, Number(written[1])) : null;
}

export function nodeSide(node: Pick<KnowledgeNode, 'data'>): SelectionSide {
  return node.data.partySide === 'client' ? 'client' : node.data.partySide === 'adversaire' ? 'adversaire' : 'tiers';
}

export function findEntityBySelection(selection: string, graph: SelectionGraph): KnowledgeNode | null {
  const key = matchKey(selection);
  if (!key) return null;
  return graph.nodes.find((node) => {
    if (node.kind !== 'person' && node.kind !== 'company') return false;
    const reals = graph.mappings.filter((mapping) => mapping.nodeId === node.id).map((mapping) => mapping.real);
    return [node.label, ...node.aliases, ...reals].some((value) => matchKey(value) === key);
  }) || null;
}

function applyOperations(graph: SelectionGraph, operations: KnowledgeUpdateOperation[]): SelectionGraph {
  let nodes = graph.nodes;
  let mappings = graph.mappings;
  for (const operation of operations) {
    if (operation.op === 'renameNode') {
      const { fromNodeId, toNodeId } = operation.rename;
      nodes = nodes.map((node) => node.id === fromNodeId ? { ...node, id: toNodeId } : node);
      mappings = mappings.map((mapping) => mapping.nodeId === fromNodeId ? { ...mapping, nodeId: toNodeId } : mapping);
    } else if (operation.op === 'upsertNode') {
      const input = operation.node;
      const previous = nodes.find((node) => node.id === input.id);
      const next: KnowledgeNode = { projectId: '', date: null, createdAt: '', updatedAt: '', ...previous, id: input.id, kind: input.kind, label: input.label || '', aliases: input.aliases || [], data: input.data || {} };
      nodes = previous ? nodes.map((node) => node.id === input.id ? next : node) : [...nodes, next];
    } else if (operation.op === 'upsertMapping') {
      const input = operation.mapping;
      const next: KnowledgeMapping = { projectId: '', data: {}, nodeId: input.nodeId, real: input.real, masked: input.masked };
      mappings = [...mappings.filter((mapping) => !(mapping.nodeId === input.nodeId && mapping.real === input.real)), next];
    } else if (operation.op === 'removePartyDesignation') {
      nodes = nodes.map((node) => {
        if (node.id !== operation.nodeId) return node;
        const { partySide: _side, position: _position, ...data } = node.data;
        return { ...node, data };
      });
    }
  }
  return { ...graph, nodes, mappings };
}

function mappingOperations(nodeId: string, code: string, reals: string[]): KnowledgeUpdateOperation[] {
  return code ? [...new Set(reals.filter(Boolean))].map((real) => ({ op: 'upsertMapping', mapping: { nodeId, real, masked: code } })) : [];
}

export function changeNodeSide(node: KnowledgeNode, side: SelectionSide, graph: SelectionGraph): SelectionChange {
  if (nodeSide(node) === side) return { operations: [], graph, nodeId: node.id, previousId: node.id };
  const change = partyCodeChange(
    node,
    { kind: node.kind, legalForm: text(node.data.legalForm), side: side as PartySide, position: text(node.data.position) },
    graph.nodes,
    graph.mappings,
    graph.reservedCodes,
  );
  const operations: KnowledgeUpdateOperation[] = [
    ...change.operations,
    { op: 'upsertNode', node: { id: change.nodeId, kind: node.kind, label: node.label, aliases: node.aliases, data: change.data } },
    ...mappingOperations(change.nodeId, change.code, [node.label, ...node.aliases, ...graph.mappings.filter((mapping) => mapping.nodeId === node.id).map((mapping) => mapping.real)]),
  ];
  if (side === 'tiers') operations.push({ op: 'removePartyDesignation', nodeId: change.nodeId });
  return { operations, graph: applyOperations(graph, operations), nodeId: change.nodeId, previousId: node.id };
}

export function createEntity(label: string, kind: NodeKind, side: SelectionSide, graph: SelectionGraph): SelectionChange {
  const name = cleanSelection(label);
  const placeholder = { id: 'manual:new', kind, data: {} };
  const change = partyCodeChange(
    placeholder,
    { kind, legalForm: '', side: side as PartySide, position: '' },
    graph.nodes,
    graph.mappings,
    graph.reservedCodes,
  );
  const operations: KnowledgeUpdateOperation[] = [
    { op: 'upsertNode', node: { id: change.nodeId, kind, label: name, aliases: [], data: change.data } },
    ...mappingOperations(change.nodeId, change.code, [name]),
  ];
  return { operations, graph: applyOperations(graph, operations), nodeId: change.nodeId, previousId: change.nodeId };
}
