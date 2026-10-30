import path from 'node:path';

import type { Draft, Provider, ReviewDetail, ReviewSummary, RowRequest, Template, TemplateColumn } from '../shared.js';
import { classificationColumn, classifyColumn, DEFAULT_MODEL, DEFAULT_PROVIDER, hasActions, INDEX_TEMPLATE_NAME, isCaseIndex, LEGACY_INDEX_NAME, reviewCategory } from '../shared.js';
import { addClassification, readClassification, saveClassification } from './classification.js';
import { listMarkdownDocuments } from './documents.js';
import { deleteDraft, listDrafts, readDrafts, upsertDraft } from './drafts.js';
import { assertProject, assertReviewFile, UserError } from './paths.js';
import { researchState, startResearch, validateFilters } from './research.js';
import { deriveStatus, listReviews, readReview, updateReview } from './reviews.js';
import { INDEX_TEMPLATE, MAX_COLUMNS, normalizeColumn, readTemplates, upsertTemplate } from './templates.js';

type Input = Record<string, unknown>;

export type AssistantLaunchers = {
  isRunning(project: string, file: string): boolean;
  launchAnalysis(body: Input): Promise<ReviewDetail>;
  launchResearch(body: Input): Promise<ReviewDetail>;
  appendDocuments(body: Input): Promise<ReviewDetail>;
};

const RESEARCH_POLL_MS = 1000;
const RESEARCH_RUNNING = new Set(['counting', 'listing', 'downloading']);
const CONCURRENCY = 3;
const INDEX_REQUEST = /chronolog|tri des pi[eè]ces|^index$|(index|inventaire) (des pi[eè]ces|du dossier)|inventaire int[eé]gral|(scan|revue|lecture) int[eé]grale?/i;
const SINGLE_INDEX = 'Une seule analyse lit toutes les pièces du dossier, pour la chronologie et le tri : complétez celle-ci.';

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

function resolved(draft: Draft): { provider: Provider; model: string } {
  const provider = draft.provider ?? DEFAULT_PROVIDER;
  return { provider, model: draft.model || DEFAULT_MODEL[provider] };
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
  if (!resolved(draft).model) absent.push('modele_ia');
  return absent;
}

function draftSummary(draft: Draft) {
  const { provider, model } = resolved(draft);
  return {
    projet: draft.id,
    nom: draft.title,
    ...(isCaseIndex(draft) ? { index: true } : {}),
    mode: draft.mode ?? 'analyse',
    ...(draft.templateName ? { modele: draft.templateName } : {}),
    questions: draft.columns.map((column) => column.name),
    ...(draft.mode === 'recherche' ? { recherche: draft.research ?? {} } : { documents: draft.rows.map((row) => row.documents[0]) }),
    ia: provider,
    modele_ia: model,
    ...(draft.error ? { erreur: draft.error } : {}),
    a_completer: missing(draft),
  };
}

function reviewSummary(review: ReviewSummary) {
  return { fichier: review.file, nom: review.title, ...(isCaseIndex(review) ? { index: true } : {}), categorie: review.category, statut: review.status, lignes: `${review.doneCount}/${review.rowCount}`, date: review.createdAt };
}

function findDraft(project: string, id: unknown): Draft {
  const draft = listDrafts([project]).find((entry) => entry.id === text(id));
  if (!draft) throw new UserError(`Projet de tabular review introuvable : ${text(id)} (action lister).`);
  return draft;
}

async function prepare(project: string, input: Input, launchers: AssistantLaunchers) {
  const previous = input.projet ? findDraft(project, input.projet) : undefined;
  const mode = input.mode === 'recherche' || (input.mode === undefined && previous?.mode === 'recherche') ? 'recherche' : undefined;
  const template = input.modele ? findTemplate(input.modele === LEGACY_INDEX_NAME ? INDEX_TEMPLATE_NAME : input.modele) : null;
  const indexed = previous && isCaseIndex(previous);
  const wantsIndex = !mode && (template?.name === INDEX_TEMPLATE_NAME || (template && hasActions(template.columns)) || INDEX_REQUEST.test(text(input.nom)));
  if (wantsIndex && !indexed) return { ...await caseIndex(project, launchers), suite: SINGLE_INDEX };
  const questions = input.questions === undefined ? null : columns(input.questions);
  const chosenColumns = template || questions ? [...(template?.columns ?? []), ...(questions ?? [])] : previous?.columns ?? [];
  const nextColumns = indexed && !classifyColumn(chosenColumns) ? [...chosenColumns, classificationColumn(readClassification(project))] : chosenColumns;
  if (hasActions(nextColumns)) throw new UserError('Tri des pièces : l’avocat le prépare depuis le volet Tabular Review.');
  const draft = upsertDraft({
    id: previous?.id,
    project,
    title: indexed ? previous.title : text(input.nom) || previous?.title,
    templateName: indexed ? previous.templateName : template?.name ?? (questions ? '' : previous?.templateName ?? ''),
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

async function caseIndex(project: string, launchers: AssistantLaunchers) {
  const review = listReviews([project], launchers.isRunning).find(isCaseIndex);
  if (review) {
    await addClassification(project, review.file);
    return { fichier: review.file };
  }
  const classification = classificationColumn(readClassification(project));
  const draft = listDrafts([project]).find(isCaseIndex);
  if (draft) {
    if (!classifyColumn(draft.columns)) upsertDraft({ ...draft, columns: [...draft.columns, classification] });
    return { projet: draft.id };
  }
  const columns = readTemplates().find((entry) => entry.name === INDEX_TEMPLATE_NAME)?.columns ?? INDEX_TEMPLATE.columns;
  const created = upsertDraft({ project, title: INDEX_TEMPLATE_NAME, templateName: INDEX_TEMPLATE_NAME, columns: [...columns, classification], rows: documentRows(project, ['']) });
  return { projet: created.id };
}

function reviewName(project: string, value: unknown): string {
  const file = path.basename(text(value));
  assertReviewFile(project, file);
  return file;
}

function readOut(project: string, file: string, launchers: AssistantLaunchers) {
  const review = readReview(project, file);
  return {
    fichier: file,
    nom: review.title,
    categorie: reviewCategory(review),
    statut: deriveStatus(review, launchers.isRunning(project, file)),
    colonnes: review.columns.map((column) => ({ colonne: column.index, ...question(column), ...(column.action ? { action: column.action } : {}) })),
    lignes: review.rows.map((row) => ({
      ligne: row.id,
      document: row.label,
      sources: row.documents.map((document) => document.source),
      statut: row.status,
      ...(row.piece ? { piece: row.piece } : {}),
      reponses: Object.fromEntries(review.columns.map((column) => [column.index, review.cells[row.id]?.[String(column.index)]?.summary ?? ''])),
    })),
  };
}

async function editColumns(project: string, input: Input, launchers: AssistantLaunchers) {
  const file = reviewName(project, input.fichier);
  if (launchers.isRunning(project, file)) throw new UserError('Attendez la fin de l’analyse pour modifier ses colonnes.');
  if (!Array.isArray(input.questions) || !input.questions.length) throw new UserError('questions : liste attendue.');
  await updateReview(project, file, (review) => {
    for (const raw of input.questions as Input[]) {
      const entry = raw ?? {};
      if (entry.colonne === undefined) {
        if (review.columns.length >= MAX_COLUMNS) throw new UserError(`Une analyse tabulaire contient au plus ${MAX_COLUMNS} questions.`);
        const index = Math.max(-1, ...review.columns.map((column) => column.index)) + 1;
        review.columns.push({ index, ...columns([entry])[0] });
        continue;
      }
      const position = review.columns.findIndex((column) => column.index === Number(entry.colonne));
      if (position < 0) throw new UserError(`Colonne introuvable : ${String(entry.colonne)}`);
      const target = review.columns[position];
      if (entry.supprimer === true) {
        review.columns.splice(position, 1);
        for (const cells of Object.values(review.cells)) delete cells[String(target.index)];
        continue;
      }
      if (target.action === 'classify' && (entry.consigne !== undefined || entry.format !== undefined || entry.etiquettes !== undefined)) {
        throw new UserError('Le classement suit l’arborescence : modifiez-la avec l’action arborescence.');
      }
      review.columns[position] = {
        index: target.index,
        ...normalizeColumn({ ...target, name: text(entry.nom) || target.name, prompt: text(entry.consigne) || target.prompt, format: entry.format ?? target.format, tags: entry.etiquettes ?? target.tags }),
      };
    }
  });
  return readOut(project, file, launchers);
}

async function classificationTree(project: string, input: Input) {
  const folders = input.dossiers === undefined
    ? readClassification(project)
    : await saveClassification(project, Array.isArray(input.dossiers) ? input.dossiers.map((entry: Input) => ({ name: entry?.nom, explanation: entry?.explication })) : input.dossiers);
  return { dossiers: folders.map((folder) => ({ nom: folder.name, explication: folder.explanation })) };
}

async function relaunch(project: string, input: Input, launchers: AssistantLaunchers) {
  const file = reviewName(project, input.fichier);
  const review = readReview(project, file);
  if (reviewCategory(review) !== 'documents') throw new UserError('Seule une analyse de documents se relance ici : le tri et la recherche ont leur propre bouton dans le volet.');
  const known = new Set(review.rows.flatMap((row) => row.documents.map((document) => document.source)));
  const rows = listMarkdownDocuments(project)
    .filter((document) => !known.has(document.path))
    .map((document) => ({ label: path.posix.basename(document.path, '.md'), documents: [document.path] }));
  if (!rows.length) return { fichier: file, ajoutes: 0 };
  const detail = await launchers.appendDocuments({ project, file, rows, proxyOrigin: input.proxyOrigin });
  return { fichier: file, ajoutes: rows.length, statut: detail.status };
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
  const { provider, model } = resolved(draft);
  const settings = { project, title: draft.title, columns: draft.columns, provider, model, concurrency: CONCURRENCY, proxyOrigin: input.proxyOrigin };
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
  if (action === 'preparer') return prepare(project, body, launchers);
  if (action === 'lancer') return launch(project, body, launchers);
  if (action === 'index') return caseIndex(project, launchers);
  if (action === 'lire') return readOut(project, reviewName(project, body.fichier), launchers);
  if (action === 'colonnes') return editColumns(project, body, launchers);
  if (action === 'classement') {
    const file = reviewName(project, body.fichier);
    if (!isCaseIndex(readReview(project, file))) throw new UserError('Le classement du dossier appartient à l’index : utilisez l’action index.');
    await addClassification(project, file);
    return readOut(project, file, launchers);
  }
  if (action === 'arborescence') return classificationTree(project, body);
  if (action === 'relancer') return relaunch(project, body, launchers);
  throw new UserError(`Action inconnue : ${action}`);
}
