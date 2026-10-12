import path from 'node:path';

import type { Draft, ReviewDetail, ReviewSummary, RowRequest, Template, TemplateColumn } from '../shared.js';
import { hasActions } from '../shared.js';
import { listMarkdownDocuments } from './documents.js';
import { deleteDraft, listDrafts, readDrafts, upsertDraft } from './drafts.js';
import { assertProject, UserError } from './paths.js';
import { researchState, startResearch, validateFilters } from './research.js';
import { listReviews } from './reviews.js';
import { normalizeColumn, readTemplates, upsertTemplate } from './templates.js';

type Input = Record<string, unknown>;

export type AssistantLaunchers = {
  isRunning(project: string, file: string): boolean;
  launchAnalysis(body: Input): Promise<ReviewDetail>;
  launchResearch(body: Input): Promise<ReviewDetail>;
};

const RESEARCH_POLL_MS = 1000;
const RESEARCH_RUNNING = new Set(['counting', 'listing', 'downloading']);
const CONCURRENCY = 3;

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const question = (column: TemplateColumn) => ({ nom: column.name, consigne: column.prompt, format: column.format, ...(column.tags ? { etiquettes: column.tags } : {}) });

function columns(value: unknown): TemplateColumn[] {
  if (!Array.isArray(value)) throw new UserError('questions : liste attendue.');
  return value.map((entry) => {
    const input = (entry ?? {}) as Input;
    const prompt = text(input.consigne);
    return normalizeColumn({ name: text(input.nom) || prompt.replace(/\s+/g, ' ').slice(0, 60), prompt, format: input.format, tags: input.etiquettes });
  });
}

function findTemplate(value: unknown): Template {
  const wanted = text(value).toLowerCase();
  const template = readTemplates().find((entry) => entry.id === text(value) || entry.name.toLowerCase() === wanted);
  if (!template) throw new UserError(`Modèle introuvable : ${text(value)} (action modeles).`);
  return template;
}

function documentRows(project: string, value: unknown): RowRequest[] {
  if (!Array.isArray(value)) throw new UserError('documents : liste de fichiers ou de dossiers attendue.');
  const available = listMarkdownDocuments(project).map((document) => document.path);
  const rows: RowRequest[] = [];
  for (const entry of value) {
    const wanted = text(entry).replace(/\\/g, '/').replace(/^\.(\/|$)/, '').replace(/\/+$/, '');
    const matches = available.includes(wanted) ? [wanted] : available.filter((document) => !wanted || document.startsWith(`${wanted}/`));
    if (!matches.length) throw new UserError(`Aucun document Markdown pour « ${text(entry)} » (action documents).`);
    for (const match of matches) {
      if (!rows.some((row) => row.documents[0] === match)) rows.push({ label: path.posix.basename(match, '.md'), documents: [match] });
    }
  }
  return rows;
}

function missing(draft: Draft): string[] {
  const absent: string[] = [];
  if (!draft.columns.length) absent.push('questions');
  if (draft.mode === 'recherche') {
    if (!text(draft.research?.query)) absent.push('recherche.query');
    try {
      validateFilters(draft.research);
    } catch (error) {
      absent.push(`recherche : ${error instanceof Error ? error.message : String(error)}`);
    }
  } else if (!draft.rows.length) absent.push('documents');
  if (draft.provider && draft.provider !== 'claude' && !draft.model) absent.push('modele_ia');
  return absent;
}

function draftSummary(draft: Draft) {
  return {
    projet: draft.id,
    nom: draft.title,
    mode: draft.mode ?? 'analyse',
    ...(draft.templateName ? { modele: draft.templateName } : {}),
    questions: draft.columns.map((column) => column.name),
    ...(draft.mode === 'recherche' ? { recherche: draft.research ?? {} } : { documents: draft.rows.map((row) => row.documents[0]) }),
    ia: draft.provider ?? 'claude',
    modele_ia: draft.model ?? (draft.provider && draft.provider !== 'claude' ? '' : 'haiku'),
    ...(draft.error ? { erreur: draft.error } : {}),
    a_completer: missing(draft),
  };
}

function reviewSummary(review: ReviewSummary) {
  return { fichier: review.file, nom: review.title, categorie: review.category, statut: review.status, lignes: `${review.doneCount}/${review.rowCount}`, date: review.createdAt };
}

function findDraft(project: string, id: unknown): Draft {
  const draft = listDrafts([project]).find((entry) => entry.id === text(id));
  if (!draft) throw new UserError(`Projet de tabular review introuvable : ${text(id)} (action lister).`);
  return draft;
}

function prepare(project: string, input: Input) {
  const previous = input.projet ? findDraft(project, input.projet) : undefined;
  const mode = input.mode === 'recherche' || (input.mode === undefined && previous?.mode === 'recherche') ? 'recherche' : undefined;
  const template = input.modele ? findTemplate(input.modele) : null;
  const questions = input.questions === undefined ? null : columns(input.questions);
  const nextColumns = template || questions ? [...(template?.columns ?? []), ...(questions ?? [])] : previous?.columns ?? [];
  if (hasActions(nextColumns)) throw new UserError('Tri des pièces : l’avocat le prépare depuis le volet Tabular Review.');
  const draft = upsertDraft({
    id: previous?.id,
    project,
    title: text(input.nom) || previous?.title,
    templateName: template?.name ?? (questions ? '' : previous?.templateName ?? ''),
    columns: nextColumns,
    rows: !mode && input.documents !== undefined ? documentRows(project, input.documents) : mode ? [] : previous?.rows ?? [],
    mode,
    research: mode ? { ...(previous?.research ?? {}), ...((input.recherche ?? {}) as Input) } : undefined,
    provider: input.ia ?? previous?.provider,
    model: input.modele_ia ?? previous?.model,
    error: '',
  });
  return draftSummary(draft);
}

function saveTemplate(input: Input) {
  const previous = input.modele ? findTemplate(input.modele) : null;
  const saved = upsertTemplate({
    id: previous?.id,
    name: text(input.nom) || previous?.name,
    description: input.description ?? previous?.description ?? '',
    columns: input.questions === undefined ? previous?.columns : columns(input.questions),
  });
  const template = previous ? saved.find((entry) => entry.id === previous.id) : saved.at(-1);
  return { id: template?.id, nom: template?.name, description: template?.description, questions: template?.columns.map(question) };
}

function watchResearch(id: string, draft: Draft, launch: (body: Input) => Promise<unknown>) {
  const fail = (error: unknown) => {
    if (readDrafts().some((entry) => entry.id === draft.id)) upsertDraft({ ...draft, error: error instanceof Error ? error.message : String(error) });
  };
  const check = () => {
    let state;
    try {
      state = researchState(id);
    } catch (error) {
      fail(error);
      return;
    }
    if (RESEARCH_RUNNING.has(state.phase)) {
      setTimeout(check, RESEARCH_POLL_MS).unref();
      return;
    }
    if (state.phase !== 'done') {
      fail(new Error(state.error ?? (state.phase === 'too_broad' ? `Recherche trop large : ${state.total} résultats.` : `Recherche ${state.phase}.`)));
      return;
    }
    launch({ id }).then(() => deleteDraft(draft.id), fail);
  };
  check();
}

async function launch(project: string, input: Input, launchers: AssistantLaunchers) {
  const draft = findDraft(project, input.projet);
  const absent = missing(draft);
  if (absent.length) throw new UserError(`À compléter avant de lancer : ${absent.join(', ')}.`);
  const settings = { project, title: draft.title, columns: draft.columns, provider: draft.provider ?? 'claude', model: draft.model ?? 'haiku', concurrency: CONCURRENCY, proxyOrigin: input.proxyOrigin };
  if (draft.mode === 'recherche') {
    const state = startResearch(draft.research);
    watchResearch(state.id, draft, (body) => launchers.launchResearch({ ...settings, ...body }));
    return { recherche: state.id, suite: 'Recherche lancée : la revue démarre à la fin du téléchargement (action lister).' };
  }
  const detail = await launchers.launchAnalysis({ ...settings, templateName: draft.templateName || 'Questions personnalisées', rows: draft.rows });
  deleteDraft(draft.id);
  return { fichier: detail.file, statut: detail.status };
}

export async function assistant(body: Input, launchers: AssistantLaunchers): Promise<unknown> {
  const action = text(body.action);
  if (action === 'modeles') {
    if (body.modele) {
      const template = findTemplate(body.modele);
      return { id: template.id, nom: template.name, description: template.description, questions: template.columns.map(question) };
    }
    return readTemplates().map((template) => ({ id: template.id, nom: template.name, description: template.description, questions: template.columns.length }));
  }
  if (action === 'enregistrer_modele') return saveTemplate(body);
  const project = assertProject(body.project);
  if (action === 'lister') {
    return {
      projets: listDrafts([project]).map(draftSummary),
      analyses: listReviews([project], launchers.isRunning).map(reviewSummary),
    };
  }
  if (action === 'documents') return listMarkdownDocuments(project).map((document) => document.path);
  if (action === 'preparer') return prepare(project, body);
  if (action === 'lancer') return launch(project, body, launchers);
  throw new UserError(`Action inconnue : ${action}`);
}
