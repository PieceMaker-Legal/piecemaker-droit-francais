import type { ResearchFilters, ResearchSource } from '../shared.js';
import type { DecisionRecord } from './decisions.js';
import { formatDate } from './decisions.js';
import type { JudgeZone } from './dispositif.js';
import { splitParagraphs, withoutAnnexes } from './dispositif.js';
import type { Json, LegifranceApi } from './legifrance.js';
import type { Criterion } from './query.js';
import type { Listed } from './sources.js';

export type Jurisdiction = 'cc' | 'ca' | 'tj' | 'tcom';

export type JudilibrePlan = { source: ResearchSource; queries: string[]; filters: [string, string][] };

export type JudilibreHit = { id: string; jurisdiction: string; location: string; date: string; numbers: string[] };

export type OfficialDecision = { record: DecisionRecord; zone: JudgeZone | null; words: Set<string> };

export const JUDILIBRE_LINK = 'https://www.courdecassation.fr/decision/';

const PAGE_SIZE = 50;
const UPPER_DATE_LIMIT = '2998-12-31';
const SIMILARITY = 0.8;
const GAP = '[…]';

const FIRST_DEGREE: Record<string, Jurisdiction> = { TRIBUNAL_JUDICIAIRE: 'tj', TRIBUNAL_COMMERCE: 'tcom' };

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function siegeLocation(siege: string): string {
  return `ca_${fold(siege).replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '')}`;
}

function articleForm(value: string): string {
  return value.replace(/\b([LRDC])(\d+(?:-\d+)*)\b/g, '$1. $2');
}

function phrase(value: string): string {
  return `+"${articleForm(value).replace(/["«»“”]/g, ' ').replace(/\s+/g, ' ').trim()}"`;
}

function terms(criterion: Criterion): string[] {
  if (criterion.typeRecherche === 'EXACTE') return [phrase(criterion.valeur)];
  return criterion.valeur.split(/\s+/).filter(Boolean).map((word) => (/^[\p{L}\p{N}’']+$/u.test(word) ? `+${word}` : phrase(word)));
}

export function judilibreQueries(clauses: Criterion[][]): string[] {
  return [...new Set(clauses.map((clause) => clause.flatMap(terms).join(' ')).filter(Boolean))];
}

export function judilibrePlan(source: ResearchSource, filters: ResearchFilters, clauses: Criterion[][]): JudilibrePlan | null {
  const dates: [string, string][] = [
    ...(filters.dateDebut ? [['date_start', filters.dateDebut] as [string, string]] : []),
    ...(filters.dateFin ? [['date_end', filters.dateFin >= '2999-01-01' ? UPPER_DATE_LIMIT : filters.dateFin] as [string, string]] : []),
  ];
  const queries = judilibreQueries(clauses);
  switch (source) {
    case 'appel':
      return { source, queries, filters: [['jurisdiction', 'ca'], ...filters.sieges.map((siege): [string, string] => ['location', siegeLocation(siege)]), ...dates] };
    case 'premiere_instance': {
      const jurisdictions = [...new Set(filters.typesPremiereInstance.flatMap((type) => (FIRST_DEGREE[type] ? [FIRST_DEGREE[type]] : [])))];
      return jurisdictions.length ? { source, queries, filters: [...jurisdictions.map((value): [string, string] => ['jurisdiction', value]), ...dates] } : null;
    }
    default:
      return null;
  }
}

function searchParams(plan: JudilibrePlan, query: string, page: number, pageSize: number): URLSearchParams {
  return new URLSearchParams([['query', query], ...plan.filters, ['page', String(page)], ['page_size', String(pageSize)]]);
}

export async function countJudilibre(api: LegifranceApi, plan: JudilibrePlan, signal: AbortSignal): Promise<number> {
  let total = 0;
  for (const query of plan.queries) {
    const response = await api.judilibre('/search', searchParams(plan, query, 0, 1), signal);
    const count = Number(response.total ?? Number.NaN);
    if (!Number.isInteger(count) || count < 0) throw new Error('L’API Judilibre n’a pas fourni de nombre de résultats fiable : recherche arrêtée.');
    total += count;
  }
  return total;
}

function hitOf(result: Json): JudilibreHit {
  const numbers = Array.isArray(result.numbers) ? result.numbers.map(String) : [];
  return {
    id: String(result.id ?? ''),
    jurisdiction: String(result.jurisdiction ?? ''),
    location: String(result.location ?? ''),
    date: formatDate(result.decision_date),
    numbers: numbers.length ? numbers : result.number ? [String(result.number)] : [],
  };
}

export async function listJudilibre(api: LegifranceApi, plan: JudilibrePlan, total: number, signal: AbortSignal, onPage: (count: number) => void): Promise<{ entry: Listed; hit: JudilibreHit }[]> {
  const listed = new Map<string, { entry: Listed; hit: JudilibreHit }>();
  for (const query of plan.queries) {
    for (let page = 0; ; page += 1) {
      const response = await api.judilibre('/search', searchParams(plan, query, page, PAGE_SIZE), signal);
      const batch = Array.isArray(response.results) ? response.results as Json[] : [];
      for (const result of batch) {
        const hit = hitOf(result);
        if (!/^[0-9a-f]{24}$/.test(hit.id) || listed.has(hit.id)) continue;
        const title = [hit.numbers[0], hit.date].filter(Boolean).join(', ') || hit.id;
        listed.set(hit.id, { entry: { id: hit.id, title, source: plan.source, position: listed.size, sourceTotal: total, result, origin: 'judilibre' }, hit });
      }
      onPage(batch.length);
      if (batch.length < PAGE_SIZE || !response.next_page) break;
    }
  }
  return [...listed.values()];
}

function slices(text: string, ranges: unknown): { start: number; end: number }[] {
  return (Array.isArray(ranges) ? ranges as Json[] : [])
    .map((range) => ({ start: Number(range.start), end: Number(range.end) }))
    .filter((range) => Number.isInteger(range.start) && Number.isInteger(range.end) && range.start >= 0 && range.end > range.start && range.start < text.length);
}

export function officialZone(decision: Json): JudgeZone | null {
  const text = typeof decision.text === 'string' ? decision.text : '';
  const zones = (decision.zones && typeof decision.zones === 'object' ? decision.zones : {}) as Json;
  const motivations = slices(text, zones.motivations);
  const dispositif = slices(text, zones.dispositif);
  if (!motivations.length && !dispositif.length) return null;
  const ranges = [...motivations.map((range) => ({ ...range, dispositif: false })), ...dispositif.map((range) => ({ ...range, dispositif: true }))].sort((left, right) => left.start - right.start);
  const parts: string[] = [];
  let previousEnd = -1;
  for (const range of ranges) {
    const slice = text.slice(range.start, range.end);
    const cleaned = range.dispositif ? withoutAnnexes(slice) : splitParagraphs(slice).join('\n\n');
    if (!cleaned) continue;
    if (previousEnd >= 0 && text.slice(previousEnd, range.start).trim()) parts.push(GAP);
    parts.push(cleaned);
    previousEnd = range.end;
  }
  return parts.length ? { zone: motivations.length ? 'motifs' : 'dispositif', text: parts.join('\n\n') } : null;
}

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : '';
}

function longDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function wordSet(text: string): Set<string> {
  return new Set(fold(text).match(/[a-z0-9]{4,}/g) ?? []);
}

export function similar(left: Set<string>, right: Set<string>): boolean {
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  const union = left.size + right.size - shared;
  return union > 0 && shared / union >= SIMILARITY;
}

export function officialDecision(entry: Pick<Listed, 'id' | 'title' | 'source'>, decision: Json): OfficialDecision {
  const text = typeof decision.text === 'string' ? decision.text : '';
  const date = formatDate(decision.decision_date);
  const place = clean(decision.location) || clean(decision.jurisdiction);
  const number = clean(decision.number) || (Array.isArray(decision.numbers) ? clean(decision.numbers[0]) : '');
  const summaries = Array.isArray(decision.titlesAndSummaries) ? decision.titlesAndSummaries as Json[] : [];
  const titrage = [...new Set(summaries.flatMap((entry) => (Array.isArray(entry.titles) ? entry.titles.map(clean) : [])).filter(Boolean))].join(' – ');
  const resume = clean(decision.summary) || [...new Set(summaries.map((entry) => clean(entry.summary)).filter(Boolean))].join('\n');
  const publication = Array.isArray(decision.publication) ? decision.publication.map(clean).filter(Boolean).join(', ') : clean(decision.publication);
  return {
    record: {
      id: entry.id,
      title: [place, date ? longDate(date) : '', number].filter(Boolean).join(', ') || entry.title,
      source: entry.source,
      date,
      formation: clean(decision.formation),
      publication,
      titrage,
      resume,
      text: text.trim(),
      numbers: number ? [number] : [],
      court: place,
    },
    zone: officialZone(decision),
    words: wordSet(text),
  };
}

export function fetchOfficial(api: LegifranceApi, entry: Pick<Listed, 'id' | 'title' | 'source'>, signal: AbortSignal): Promise<OfficialDecision> {
  return api.judilibre('/decision', new URLSearchParams({ id: entry.id, resolve_references: 'true' }), signal).then((decision) => officialDecision(entry, decision));
}

function numberKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '').replace(/^n°/, '');
}

export function sameNumber(left: string, right: string): boolean {
  const a = numberKey(left);
  const b = numberKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const first = /^(\d{2})\/0*(\d{3,})$/.exec(a);
  const second = /^(\d{2})\/0*(\d{3,})$/.exec(b);
  if (!first || !second || first[1] !== second[1]) return false;
  return first[2] === second[2] || first[2].slice(0, -1) === second[2] || second[2].slice(0, -1) === first[2];
}

export function jurisdictionOf(record: Pick<DecisionRecord, 'source' | 'court'>): Jurisdiction | null {
  if (record.source === 'cassation') return 'cc';
  if (record.source === 'appel') return 'ca';
  if (record.source !== 'premiere_instance') return null;
  const court = fold(record.court);
  if (court.startsWith('tribunal judiciaire')) return 'tj';
  if (court.startsWith('tribunal de commerce') || court.startsWith('tribunal des activites economiques')) return 'tcom';
  return null;
}

export function matchesHit(record: Pick<DecisionRecord, 'source' | 'court' | 'date' | 'numbers' | 'siege'>, hit: JudilibreHit): boolean {
  const jurisdiction = jurisdictionOf(record);
  if (!jurisdiction || hit.jurisdiction !== jurisdiction || !record.date || hit.date !== record.date) return false;
  if (jurisdiction === 'ca' && record.siege && hit.location && hit.location !== siegeLocation(record.siege)) return false;
  return record.numbers.some((number) => hit.numbers.some((candidate) => sameNumber(number, candidate)));
}

export async function lookupOfficial(api: LegifranceApi, record: DecisionRecord, words: Set<string>, signal: AbortSignal): Promise<OfficialDecision | null> {
  const jurisdiction = jurisdictionOf(record);
  if (!jurisdiction || !record.date || !record.numbers.length) return null;
  const tried = new Set<string>();
  for (const number of record.numbers.slice(0, 3)) {
    const variants = [number, ...(/^\d{2}\/\d{6,}$/.test(number) ? [number.slice(0, -1)] : [])];
    for (const variant of variants) {
      const response = await api.judilibre('/search', new URLSearchParams({ query: `"${variant}"`, jurisdiction, date_start: record.date, date_end: record.date, page_size: '10' }), signal);
      const hits = (Array.isArray(response.results) ? response.results as Json[] : []).map(hitOf).filter((hit) => !tried.has(hit.id) && matchesHit(record, hit));
      for (const hit of hits) {
        tried.add(hit.id);
        const official = await fetchOfficial(api, { id: hit.id, title: record.title, source: record.source }, signal);
        if (similar(official.words, words)) return official;
      }
    }
  }
  return null;
}
