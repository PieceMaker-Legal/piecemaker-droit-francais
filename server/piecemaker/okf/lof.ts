import lof from './lof.json' with { type: 'json' };

export type LofTerm = {
  iri: string;
  label: string;
  kind: 'class' | 'objprop' | 'dataprop' | 'individual';
  annotations: string[][];
  subClassOf?: string[];
  domain?: string[];
  range?: string[];
  inverseOf?: string[];
  subPropertyOf?: string[];
  type?: string[];
  axioms?: Array<{ k: string; m: string }>;
};

export const LOF_ATTRIBUTION: string = lof.attribution;
export const LOF_SOURCE: string = lof.source;
const TERMS = lof.terms as Record<string, LofTerm>;

export const MATERIAL_ENTITY = 'BFO_0000040';
export const LEGAL_DOCUMENT = 'ODP001_0001002';
export const LEGAL_POSITION = 'ODP003_0001000';
export const TEMPORAL_INSTANT = 'BFO_0000203';
export const HAS_DATE_TIME_VALUE = 'ODP005_0001200';
export const FGLP_PROPERTIES = ['ODP003_0001100', 'ODP003_0001101', 'ODP004_0001100', 'ODP004_0001102', 'ODP004_0001103', 'ODP004_0001105'];
export const HELD_BY = 'ODP003_0001100';

export const lofTerm = (id: string): LofTerm | undefined => TERMS[id];
export const lofLabel = (id: string): string => TERMS[id]?.label ?? id;
export const lofTerms = (): Array<[string, LofTerm]> => Object.entries(TERMS);
export const definitionOf = (term: LofTerm): string => term.annotations.find(([name]) => name === 'definition')?.[1] ?? '';
export const isFunctional = (id: string): boolean => Boolean(TERMS[id]?.axioms?.some((axiom) => axiom.k === 'Characteristics' && axiom.m.split(', ').includes('Functional')));

const byLabel = new Map(Object.entries(TERMS).map(([id, term]) => [term.label, id]));

export function lofId(value: string, kinds: LofTerm['kind'][]): string | undefined {
  const id = TERMS[value] ? value : byLabel.get(value.trim());
  return id && kinds.includes(TERMS[id].kind) ? id : undefined;
}

export function isA(classId: string, ancestor: string): boolean {
  const seen = new Set<string>();
  const queue = [classId];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === ancestor) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    queue.push(...(TERMS[current]?.subClassOf ?? []));
  }
  return false;
}

export const fits = (classId: string, allowed: string[] = []): boolean => !allowed.length || allowed.some((ancestor) => isA(classId, ancestor));
