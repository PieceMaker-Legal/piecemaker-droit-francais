import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type Database from 'better-sqlite3';
import express from 'express';

import type { SuiviDeadline, SuiviEvent, SuiviSnapshot } from '../../../shared/piecemaker-suivi.js';

import { SUIVI_FILE, suiviDateId } from './suivi.js';
import type { createSuiviService } from './suivi-service.js';

type Json = Record<string, unknown>;
type Suivi = ReturnType<typeof createSuiviService>;

const BOARD = 'cabinet';
const MATTERS = `projects/${BOARD}/matters/`;
const DELETED_SUFFIX = '.supprime';
const KEPT_DATE_FIELDS = ['confirmed', 'phase', 'page', 'docId'];

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const merge = (into: Json, patch: Json) => {
  for (const [key, value] of Object.entries(patch)) {
    if (isObject(value) && value.__delete__ === true) delete into[key];
    else if (isObject(value) && isObject(into[key])) merge(into[key] as Json, value);
    else into[key] = value;
  }
  return into;
};
const parseRaw = (code: string): Json | null => { try { const value: unknown = JSON.parse(code); return isObject(value) ? value : null; } catch { return null; } };
const isDeadline = (entry: SuiviEvent | SuiviDeadline): entry is SuiviDeadline => 'fait' in entry;

export const dossierMatterId = (projectPath: string) => `dossier-${sha(path.resolve(projectPath)).slice(0, 16)}`;

const deadlineSource = (deadline: SuiviDeadline) => {
  const state = deadline.erreurs ? `${deadline.erreurs} erreur(s)` : deadline.manques ? `${deadline.manques} point(s) à compléter` : 'vérifiée';
  const basis = [...deadline.selon, ...deadline.decompte].map((entry) => entry.titre ?? entry.source);
  return [state, deadline.suppose ? 'date supposée' : '', deadline.calcul.at(-1) ?? '', ...new Set(basis)].filter(Boolean).join(' · ').slice(0, 300);
};

export function projectMatter(id: string, nom: string, snapshot: SuiviSnapshot): Json {
  const matter = isObject(parseRaw(snapshot.code)?.matter) ? parseRaw(snapshot.code)!.matter as Json : {};
  const stored = new Map((Array.isArray(matter.keyDates) ? matter.keyDates as Json[] : []).filter(isObject).map((entry) => [entry.id, entry]));
  const events = snapshot.evenements.map((event) => ({ ...stored.get(suiviDateId(event.nom)), id: suiviDateId(event.nom), label: event.intitule, date: event.date, kind: 'other', source: event.suppose ? 'date supposée' : event.preuve[0]?.titre ?? event.preuve[0]?.piece ?? '', done: true, ...(event.preuve[0] ? { quote: event.preuve[0].citation } : {}) }));
  const deadlines = snapshot.echeances.filter((deadline) => deadline.date).map((deadline) => ({ ...stored.get(suiviDateId(deadline.nom)), id: suiviDateId(deadline.nom), label: deadline.intitule, date: deadline.date, kind: deadline.kind, source: deadlineSource(deadline), done: deadline.fait !== null, ...(deadline.preuve[0] ? { quote: deadline.preuve[0].citation } : {}) }));
  const verified = new Set([...snapshot.evenements, ...snapshot.echeances].map((entry) => suiviDateId(entry.nom)));
  const manual = [...stored.values()].filter((entry) => !verified.has(entry.id as string));
  return { ...matter, _id: id, name: matter.name || nom, status: matter.status || 'open', keyDates: [...events, ...deadlines, ...manual] };
}

export function reconcileDates(raw: Json, snapshot: SuiviSnapshot, incoming: Json[], base: unknown[] | undefined, today: string) {
  const known = new Map<string, SuiviEvent | SuiviDeadline>([...snapshot.evenements, ...snapshot.echeances].map((entry) => [suiviDateId(entry.nom), entry]));
  const itemOf = (entry: SuiviEvent | SuiviDeadline) => (raw[isDeadline(entry) ? 'echeances' : 'evenements'] as Json)[entry.nom] as Json;
  const marks: Array<{ echeance: string; date?: string; annuler?: boolean }> = [];
  const seen = new Set<string>();
  const kept: Json[] = [];
  for (const date of incoming) {
    const entry = known.get(date.id as string);
    if (!entry) { kept.push(date); continue; }
    seen.add(date.id as string);
    const item = itemOf(entry);
    if (date.label && date.label !== entry.intitule) item.intitule = date.label;
    if (date.date && date.date !== entry.date) item.date = date.date;
    if (isDeadline(entry)) {
      if (date.kind && date.kind !== entry.kind) item.kind = date.kind;
      if (date.done === true && !entry.fait) marks.push({ echeance: entry.nom, date: today });
      if (date.done !== true && entry.fait?.par === 'avocat') marks.push({ echeance: entry.nom, annuler: true });
      if (date.done !== true && entry.fait?.par === 'fichier') delete item.fait;
    }
    const extras = Object.fromEntries(KEPT_DATE_FIELDS.filter((field) => date[field] !== undefined).map((field) => [field, date[field]]));
    if (Object.keys(extras).length) kept.push({ id: date.id, ...extras });
  }
  for (const id of base ?? []) {
    const entry = known.get(id as string);
    if (!entry || seen.has(id as string)) continue;
    delete (raw[isDeadline(entry) ? 'echeances' : 'evenements'] as Json)[entry.nom];
    if (isDeadline(entry)) marks.push({ echeance: entry.nom, annuler: true });
  }
  return { kept, marks };
}

export function createBoardService(getDatabase: () => Database.Database, suivi: Suivi) {
  const database = getDatabase();
  database.exec('CREATE TABLE IF NOT EXISTS pm_board_docs (path TEXT PRIMARY KEY NOT NULL, data_json TEXT NOT NULL CHECK(json_valid(data_json)))');
  const seed = database.prepare('INSERT OR IGNORE INTO pm_board_docs VALUES(?,?)');
  seed.run(`projects/${BOARD}`, JSON.stringify({ _id: BOARD, name: 'Cabinet', createdBy: null, createdAt: Date.now(), updatedAt: Date.now(), people: [] }));
  seed.run('c4lSample/state', JSON.stringify({ dismissed: true }));

  const central = () => Object.fromEntries((database.prepare('SELECT path, data_json FROM pm_board_docs').all() as Array<{ path: string; data_json: string }>).map((row) => [row.path, JSON.parse(row.data_json) as Json]));
  const save = database.prepare('INSERT INTO pm_board_docs VALUES(?,?) ON CONFLICT(path) DO UPDATE SET data_json=excluded.data_json');
  const rootOf = (docPath: string) => suivi.projects().find((project) => `${MATTERS}${dossierMatterId(project.project_path)}` === docPath)?.project_path ?? null;

  const build = async () => {
    const docs: Record<string, Json> = central();
    for (const dossier of await suivi.all()) docs[`${MATTERS}${dossierMatterId(dossier.projectPath)}`] = projectMatter(dossierMatterId(dossier.projectPath), dossier.nom, dossier.snapshot);
    return { rev: sha(JSON.stringify(docs)), docs };
  };
  let building: ReturnType<typeof build> | null = null;
  const current = () => { building ??= build().finally(() => { building = null; }); return building; };

  const writeFileAtomic = async (root: string, raw: Json) => {
    const file = path.join(root, SUIVI_FILE);
    await writeFile(`${file}.tmp`, `${JSON.stringify(raw, null, 2)}\n`);
    await rename(`${file}.tmp`, file);
  };
  const writeMatter = async (root: string, op: string, data: Json | undefined, base: unknown[] | undefined) => {
    const file = path.join(root, SUIVI_FILE);
    if (op === 'delete') { await rename(file, `${file}${DELETED_SUFFIX}`); return; }
    if (op === 'set') await rename(`${file}${DELETED_SUFFIX}`, file).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    const code = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT' && op === 'set') return '{}'; if (error.code === 'ENOENT') throw new TypeError(`Aucun ${SUIVI_FILE} pour ce dossier.`); throw error; });
    const raw = parseRaw(code);
    if (!raw) throw new TypeError(`${SUIVI_FILE} illisible : corrige le fichier avant de modifier ce dossier.`);
    raw.evenements ??= {};
    raw.echeances ??= {};
    const snapshot = await suivi.read(root).catch(() => null);
    const { _id: _ignored, ...fields } = data ?? {};
    const matter: Json = op === 'set' ? fields : merge(isObject(raw.matter) ? raw.matter : {}, fields);
    const marks = [];
    if (Array.isArray(fields.keyDates) && snapshot) {
      const result = reconcileDates(raw, snapshot, (fields.keyDates as unknown[]).filter(isObject), base, new Date().toISOString().slice(0, 10));
      matter.keyDates = result.kept;
      marks.push(...result.marks);
    }
    raw.matter = matter;
    const ordered = { matter: raw.matter, evenements: raw.evenements, echeances: raw.echeances };
    await writeFileAtomic(root, ordered);
    for (const { echeance, ...mark } of marks) await suivi.mark(root, echeance, mark).catch(() => undefined);
  };

  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(task: () => Promise<T>) => { const run = queue.then(task, task); queue = run.catch(() => undefined); return run; };

  const write = (op: unknown, docPath: unknown, data: unknown, base?: unknown) => enqueue(async () => {
    if (typeof docPath !== 'string' || !/^[A-Za-z0-9][^\0]*$/.test(docPath) || docPath.includes('..')) throw new TypeError('Chemin invalide.');
    if (!['set', 'update', 'delete'].includes(op as string)) throw new TypeError('Opération : set, update ou delete.');
    if (op !== 'delete' && !isObject(data)) throw new TypeError('Données : objet attendu.');
    const root = rootOf(docPath);
    if (root) return writeMatter(root, op as string, data as Json | undefined, Array.isArray(base) ? base : undefined);
    if (op === 'delete') { database.prepare('DELETE FROM pm_board_docs WHERE path=?').run(docPath); return; }
    const existing = central()[docPath];
    if (op === 'update' && !existing) throw new TypeError(`Document absent : ${docPath}`);
    save.run(docPath, JSON.stringify(op === 'set' ? data : merge(existing, data as Json)));
  });

  const read = async (docPath: string) => {
    const { docs } = await current();
    if (docs[docPath]) return docs[docPath];
    const depth = docPath.split('/').length + 1;
    return Object.fromEntries(Object.entries(docs).filter(([key]) => key.startsWith(`${docPath}/`) && key.split('/').length === depth).map(([key, value]) => [key.slice(key.lastIndexOf('/') + 1), value]));
  };

  return {
    current,
    write,
    read,
    async command(input: Json) {
      if (typeof input.chemin !== 'string' || !input.chemin) throw new TypeError('chemin requis (ex. projects/cabinet/requests/<id>).');
      if (input.commande === 'lire') return JSON.stringify(await read(input.chemin), null, 2);
      const data = parseRaw(typeof input.donnees === 'string' ? input.donnees : JSON.stringify(input.donnees ?? null));
      if (!data) throw new TypeError('donnees : objet JSON attendu.');
      const exists = rootOf(input.chemin) !== null || central()[input.chemin] !== undefined;
      await write(exists ? 'update' : 'set', input.chemin, data);
      return `Écrit : ${input.chemin}`;
    },
  };
}

export function createBoardRouter(board: ReturnType<typeof createBoardService>) {
  const router = express.Router();
  const fail = (response: express.Response, error: unknown) => response.status(400).json({ error: error instanceof Error ? error.message : 'Board indisponible.' });
  router.get('/', (request, response) => {
    board.current().then(({ rev, docs }) => { response.json(request.query.rev === rev ? { rev } : { rev, docs }); }, (error: unknown) => fail(response, error));
  });
  router.post('/', express.json({ limit: '20mb' }), (request, response) => {
    const { op, path: docPath, data, base } = (request.body ?? {}) as Json;
    board.write(op, docPath, data, base).then(() => { response.json({ ok: true }); }, (error: unknown) => fail(response, error));
  });
  return router;
}
