import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { Option, ResearchDecision, ResearchFilters, ResearchPage, ResearchSource, ResearchState, ResearchText, ResearchView, ResearchZone, Review, ReviewColumn } from '../shared.js';
import {
  APPEL_SIEGES,
  BULLETIN_PUBLICATIONS,
  CAA_VILLES,
  CASSATION_MATIERES,
  LEBON_PUBLICATIONS,
  PREMIERE_INSTANCE_TYPES,
  RESEARCH_LIMIT,
  RESEARCH_PAGE_SIZE,
  RESEARCH_SOURCES,
  researchCriteria,
} from '../shared.js';
import { decisionRecord, importance } from './decisions.js';
import type { DecisionRecord } from './decisions.js';
import { judgeZone } from './dispositif.js';
import { createLegifranceApi, legifranceCredentials } from './legifrance.js';
import type { LegifranceApi } from './legifrance.js';
import { PLUGIN_HOME, UserError, writeFileAtomic } from './paths.js';
import { clausesMatch, matchIndex, parseQuery } from './query.js';
import type { Criterion, ParsedQuery } from './query.js';
import type { ReviewSettings } from './reviews.js';
import { sanitizeFilename, storeDocument, writeNewReview } from './reviews.js';
import { listPlan, planClauses, resolvePlan, sourcePlan } from './sources.js';
import type { Listed, SourcePlan } from './sources.js';
import { MAX_COLUMNS, normalizeColumn } from './templates.js';

export const RESEARCH_TEMPLATE_NAME = 'Recherche juridique';

const DOWNLOAD_WORKERS = 5;
const EXCERPT_CHARS = 700;
const RETENTION_MS = 7 * 24 * 60 * 60_000;
const CACHED_INDEXES = 3;

type Stored = ResearchDecision & { tier: number; ratio: number };

type StoredIndex = { state: ResearchState; decisions: ResearchDecision[] };

type Job = { state: ResearchState; controller: AbortController };

const jobs = new Map<string, Job>();
const indexes = new Map<string, StoredIndex>();
let sharedApi: { key: string; api: LegifranceApi } | null = null;

export function researchHome(): string {
  return path.join(PLUGIN_HOME, 'research');
}

function researchDirectory(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new UserError('Recherche invalide.');
  return path.join(researchHome(), id);
}

function textFile(id: string, decision: string): string {
  if (!/^[A-Z]+\d+$/.test(decision)) throw new UserError('Décision invalide.');
  return path.join(researchDirectory(id), 'texts', `${decision}.json`);
}

export function legifranceConfigured(): boolean {
  return legifranceCredentials() !== null;
}

function defaultApi(): LegifranceApi {
  const credentials = legifranceCredentials();
  if (!credentials) throw new UserError('Identifiants Légifrance absents : renseignez LEGIFRANCE_CLIENT_ID et LEGIFRANCE_CLIENT_SECRET dans ~/.config/mcp-legifrance/.env (installation PieceMaker, étape Légifrance).');
  const key = `${credentials.id}\u0000${credentials.secret}\u0000${credentials.sandbox}`;
  if (sharedApi?.key !== key) sharedApi = { key, api: createLegifranceApi(credentials) };
  return sharedApi.api;
}

function pick(values: unknown, options: Option[]): string[] {
  const allowed = new Set(options.map((option) => option.value));
  return Array.isArray(values) ? [...new Set(values.filter((value): value is string => typeof value === 'string' && allowed.has(value)))] : [];
}

function choice<T extends string>(value: unknown, options: { value: T }[]): T {
  return options.find((option) => option.value === value)?.value ?? options[0].value;
}

function date(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(text))) throw new UserError(`Date ${label} invalide.`);
  return text;
}

export function validateFilters(value: unknown): { filters: ResearchFilters; parsed: ParsedQuery } {
  const input = (value ?? {}) as Record<string, unknown>;
  const query = typeof input.query === 'string' ? input.query.trim().slice(0, 2000) : '';
  const parsed = parseQuery(query);
  const sources = pick(input.sources, RESEARCH_SOURCES) as ResearchSource[];
  if (!sources.length) throw new UserError('Choisissez au moins une juridiction.');
  const filters: ResearchFilters = {
    query,
    sources: RESEARCH_SOURCES.map((source) => source.value).filter((source) => sources.includes(source)),
    matieres: pick(input.matieres, CASSATION_MATIERES),
    publicationBulletin: choice(input.publicationBulletin, BULLETIN_PUBLICATIONS),
    sieges: pick(input.sieges, APPEL_SIEGES),
    publicationConseilEtat: choice(input.publicationConseilEtat, LEBON_PUBLICATIONS),
    villesCaa: pick(input.villesCaa, CAA_VILLES),
    publicationCaa: choice(input.publicationCaa, LEBON_PUBLICATIONS),
    typesPremiereInstance: pick(input.typesPremiereInstance, PREMIERE_INSTANCE_TYPES),
    dateDebut: date(input.dateDebut, 'de début'),
    dateFin: date(input.dateFin, 'de fin'),
    dispositifOnly: input.dispositifOnly !== false,
  };
  if (filters.sources.includes('cassation') && !filters.matieres.length) throw new UserError('Cour de cassation : choisissez au moins une matière (chambres).');
  if (filters.sources.includes('premiere_instance') && !filters.typesPremiereInstance.length) throw new UserError('Première instance : choisissez au moins un type de juridiction.');
  if (filters.dateDebut && filters.dateFin && filters.dateDebut > filters.dateFin) throw new UserError('La date de début est postérieure à la date de fin.');
  return { filters, parsed };
}

function pruneOldResearch(): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(researchHome(), { withFileTypes: true });
  } catch {
    return;
  }
  const limit = Date.now() - RETENTION_MS;
  for (const entry of entries) {
    const directory = path.join(researchHome(), entry.name);
    try {
      if (entry.isDirectory() && !jobs.has(entry.name) && fs.statSync(directory).mtimeMs < limit) fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      continue;
    }
  }
}

function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= EXCERPT_CHARS) return flat;
  const cut = flat.slice(0, EXCERPT_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), EXCERPT_CHARS - 80))} …`;
}

export type Processed = { decision: Stored; text: ResearchText | null };

export function processDecision(listed: Listed, record: DecisionRecord | null, filters: ResearchFilters, clauses: Criterion[][], link: string, error?: string): Processed {
  const rank = importance({ source: listed.source, formation: record?.formation ?? '', publication: record?.publication ?? '', title: record?.title ?? listed.title });
  const base = {
    id: listed.id,
    rank: 0,
    title: record?.title ?? listed.title,
    source: listed.source,
    date: record?.date ?? '',
    importance: rank.label,
    titrage: record?.titrage ?? '',
    link,
    tier: rank.tier,
    ratio: listed.sourceTotal ? listed.position / listed.sourceTotal : 0,
  };
  if (!record || !record.text) {
    return {
      decision: { ...base, kept: true, analysis: record?.resume ?? '', analysisKind: record?.resume ? 'analyse' : 'aucune', zone: 'integral', chars: 0, error: error ?? 'Texte intégral indisponible.' },
      text: null,
    };
  }
  let zone: ResearchZone = 'integral';
  let retained = record.text;
  let kept = true;
  if (filters.dispositifOnly) {
    const judge = judgeZone(record.text, listed.source === 'cassation');
    zone = judge.zone;
    retained = judge.text;
    if (zone === 'motifs') kept = clausesMatch(matchIndex(retained), clauses);
  }
  return {
    decision: {
      ...base,
      kept,
      analysis: record.resume || excerpt(retained),
      analysisKind: record.resume ? 'analyse' : retained ? 'extrait' : 'aucune',
      zone,
      chars: retained.length,
    },
    text: { id: listed.id, zone, retained: retained === record.text ? '' : retained, full: record.text },
  };
}

function sortDecisions(decisions: Stored[]): ResearchDecision[] {
  return [...decisions]
    .sort((left, right) => left.tier - right.tier || left.ratio - right.ratio || right.date.localeCompare(left.date) || left.id.localeCompare(right.id))
    .map(({ tier: _tier, ratio: _ratio, ...decision }, index) => ({ ...decision, rank: index + 1 }));
}

function persist(state: ResearchState, decisions: ResearchDecision[]): void {
  const index = { state, decisions };
  writeFileAtomic(path.join(researchDirectory(state.id), 'index.json'), JSON.stringify(index));
  remember(state.id, index);
}

function remember(id: string, index: StoredIndex): void {
  indexes.delete(id);
  indexes.set(id, index);
  while (indexes.size > CACHED_INDEXES) indexes.delete(indexes.keys().next().value!);
}

async function pool<T>(items: T[], workers: number, signal: AbortSignal, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !signal.aborted) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, worker));
  if (signal.aborted) throw new Error('Annulée.');
}

async function execute(job: Job, api: LegifranceApi, parsed: ParsedQuery): Promise<void> {
  const { state } = job;
  const { signal } = job.controller;
  const { filters } = state;
  const plans: { plan: SourcePlan; total: number }[] = [];
  for (const source of filters.sources) {
    const resolved = await resolvePlan(api, sourcePlan(source, filters), parsed, filters, signal);
    plans.push(resolved);
    state.counts.push({ source, total: resolved.total });
    state.total += resolved.total;
  }
  if (state.total > RESEARCH_LIMIT) {
    state.phase = 'too_broad';
    persist(state, []);
    return;
  }
  state.phase = 'listing';
  const listed = new Map<string, { entry: Listed; plan: SourcePlan }>();
  for (const { plan, total } of plans) {
    if (!total) continue;
    const entries = await listPlan(api, plan, parsed, total, signal, (count) => {
      state.listed += count;
    });
    for (const entry of entries) if (!listed.has(entry.id)) listed.set(entry.id, { entry, plan });
  }
  state.listed = listed.size;
  state.phase = 'downloading';
  const results = new Map<string, Stored>();
  const texts = path.join(researchDirectory(state.id), 'texts');
  fs.mkdirSync(texts, { recursive: true });
  let fatal: UserError | null = null;
  const fetchDecision = async ({ entry, plan }: { entry: Listed; plan: SourcePlan }, final: boolean) => {
    let record: DecisionRecord | null = null;
    let error: string | undefined;
    try {
      record = decisionRecord(entry, await api.consult(entry.id, signal));
    } catch (failure) {
      if (failure instanceof UserError && !fatal) {
        fatal = failure;
        job.controller.abort();
      }
      if (signal.aborted) return;
      error = failure instanceof Error ? failure.message : String(failure);
    }
    if (!final && !record?.text) return;
    const { decision, text } = processDecision(entry, record, filters, planClauses(plan, parsed), `${plan.linkBase}${entry.id}`, error);
    if (text) writeFileAtomic(textFile(state.id, entry.id), JSON.stringify(text));
    results.set(entry.id, decision);
    state.downloaded = results.size;
  };
  const queue = [...listed.values()];
  try {
    await pool(queue, DOWNLOAD_WORKERS, signal, (item) => fetchDecision(item, false));
    await pool(queue.filter((item) => !results.has(item.entry.id)), 2, signal, (item) => fetchDecision(item, true));
  } catch (error) {
    throw fatal ?? error;
  }
  const decisions = sortDecisions([...results.values()]);
  Object.assign(state, {
    phase: 'done',
    downloaded: decisions.filter((decision) => !decision.error).length,
    kept: decisions.filter((decision) => decision.kept && !decision.error).length,
    excluded: decisions.filter((decision) => !decision.kept).length,
    undetected: filters.dispositifOnly ? decisions.filter((decision) => !decision.error && decision.zone !== 'motifs').length : 0,
    failed: decisions.filter((decision) => decision.error).length,
  });
  persist(state, decisions);
}

export function startResearch(input: unknown, api?: LegifranceApi): ResearchState {
  const { filters, parsed } = validateFilters(input);
  const client = api ?? defaultApi();
  pruneOldResearch();
  const state: ResearchState = {
    id: randomUUID(),
    phase: 'counting',
    filters,
    counts: [],
    total: 0,
    listed: 0,
    downloaded: 0,
    kept: 0,
    excluded: 0,
    undetected: 0,
    failed: 0,
    createdAt: new Date().toISOString(),
  };
  fs.mkdirSync(researchDirectory(state.id), { recursive: true });
  const job: Job = { state, controller: new AbortController() };
  jobs.set(state.id, job);
  void execute(job, client, parsed)
    .catch((error: unknown) => {
      state.phase = job.controller.signal.aborted && !(error instanceof UserError) ? 'cancelled' : 'error';
      if (state.phase === 'error') state.error = error instanceof Error ? error.message : String(error);
      try {
        persist(state, []);
      } catch {
        return;
      }
    })
    .finally(() => {
      jobs.delete(state.id);
    });
  return { ...state };
}

export function waitForResearch(id: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => (jobs.has(id) ? setTimeout(check, 5) : resolve());
    check();
  });
}

function loadIndex(id: string): StoredIndex {
  const cached = indexes.get(id);
  if (cached) {
    remember(id, cached);
    return cached;
  }
  try {
    const index = JSON.parse(fs.readFileSync(path.join(researchDirectory(id), 'index.json'), 'utf8')) as StoredIndex;
    remember(id, index);
    return index;
  } catch {
    throw new UserError('Recherche introuvable ou interrompue : relancez-la.');
  }
}

export function researchState(id: string): ResearchState {
  const job = jobs.get(id);
  return job ? { ...job.state, counts: [...job.state.counts] } : loadIndex(id).state;
}

export function stopAllResearch(): void {
  for (const job of jobs.values()) job.controller.abort();
}

export function cancelResearch(id: string): ResearchState {
  jobs.get(id)?.controller.abort();
  return researchState(id);
}

export function researchPage(id: string, page: unknown, view: unknown): ResearchPage {
  if (jobs.has(id)) throw new UserError('Recherche en cours.');
  const index = loadIndex(id);
  const selected: ResearchView = view === 'excluded' ? 'excluded' : 'kept';
  const items = index.decisions.filter((decision) => (selected === 'excluded' ? !decision.kept : decision.kept));
  const pageCount = Math.max(1, Math.ceil(items.length / RESEARCH_PAGE_SIZE));
  const requested = Number(page);
  const current = Number.isInteger(requested) ? Math.min(pageCount, Math.max(1, requested)) : 1;
  return {
    state: index.state,
    view: selected,
    page: current,
    pageCount,
    count: items.length,
    items: items.slice((current - 1) * RESEARCH_PAGE_SIZE, current * RESEARCH_PAGE_SIZE),
  };
}

export function researchText(id: string, decision: unknown): ResearchText {
  try {
    const stored = JSON.parse(fs.readFileSync(textFile(id, String(decision ?? '')), 'utf8')) as ResearchText;
    return { ...stored, retained: stored.retained || stored.full };
  } catch (error) {
    if (error instanceof UserError) throw error;
    throw new UserError('Texte de la décision indisponible.');
  }
}

const ZONE_NOTES: Record<ResearchZone, string> = {
  motifs: 'Extrait retenu : partie de la décision où le juge statue (motifs et dispositif).',
  dispositif: 'Extrait retenu : dispositif seul (motifs non repérés).',
  absente: 'Texte intégral : la partie du juge n’a pas pu être repérée.',
  integral: '',
};

function decisionMarkdown(decision: ResearchDecision, text: ResearchText): string {
  const note = ZONE_NOTES[text.zone];
  return [`# ${decision.title}`, '', `Source : ${decision.link}`, ...(note ? ['', note] : []), '', text.retained || text.full, ''].join('\n');
}

export function createResearchReview(project: string, id: string, title: unknown, columns: unknown, settings: ReviewSettings): { file: string; review: Review } {
  if (jobs.has(id)) throw new UserError('Recherche en cours : attendez la fin du téléchargement.');
  const cleanTitle = typeof title === 'string' ? title.trim().slice(0, 120) : '';
  if (!cleanTitle) throw new UserError('Donnez un nom à la tabular review.');
  const questions = Array.isArray(columns) ? columns.map(normalizeColumn) : [];
  if (!questions.length) throw new UserError('Annoncez au moins une question.');
  if (questions.length > MAX_COLUMNS) throw new UserError(`Une tabular review contient au plus ${MAX_COLUMNS} questions.`);
  const index = loadIndex(id);
  if (index.state.phase !== 'done') throw new UserError('Aucun résultat à analyser pour cette recherche.');
  const decisions = index.decisions.filter((decision) => decision.kept && !decision.error);
  if (!decisions.length) throw new UserError('Aucune décision à analyser.');
  const rows = decisions.map((decision) => {
    const text = researchText(id, decision.id);
    const content = decisionMarkdown(decision, text);
    return {
      id: randomUUID(),
      label: decision.title,
      documents: [{ source: decision.link, copy: storeDocument(project, sanitizeFilename(decision.title).slice(0, 150) || decision.id, '.md', content), chars: content.length }],
      status: 'pending' as const,
    };
  });
  const now = new Date().toISOString();
  const review: Review = {
    version: 1,
    title: cleanTitle,
    templateName: RESEARCH_TEMPLATE_NAME,
    category: 'recherche-juridique',
    research: { query: index.state.filters.query, criteria: researchCriteria(index.state.filters), dispositifOnly: index.state.filters.dispositifOnly, total: index.state.total },
    projectPath: project,
    createdAt: now,
    updatedAt: now,
    provider: settings.provider,
    model: settings.model,
    concurrency: settings.concurrency,
    columns: questions.map((column, position): ReviewColumn => ({ ...column, index: position })),
    rows,
    cells: {},
  };
  return { file: writeNewReview(project, review), review };
}
