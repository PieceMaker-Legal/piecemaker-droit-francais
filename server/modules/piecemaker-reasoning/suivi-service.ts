import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type Database from 'better-sqlite3';
import express from 'express';

import type { SuiviDossier, SuiviSnapshot } from '../../../shared/piecemaker-suivi.js';

import { isLegalDate } from './legal-period.js';
import type { ReasoningConnectors, SourceInfo } from './program.js';
import { describeSuivi, SUIVI_FILE, verifySuivi } from './suivi.js';
import type { SuiviMark } from './suivi.js';

const empty = (): SuiviSnapshot => ({ revision: 0, updatedAt: null, code: '', hash: null, evenements: [], echeances: [], issues: [] });
const hashOf = (code: string) => createHash('sha256').update(code).digest('hex');
const MISSING = 'Aucun suivi : écris .piecemaker/suivi.yaml (evenements et echeances), puis relance verifier.';

export function createSuiviService(getDatabase: () => Database.Database, connectors: ReasoningConnectors) {
  let initialized = false;
  const database = () => {
    const db = getDatabase();
    if (!initialized) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS pm_suivi (
          project_id TEXT PRIMARY KEY NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          revision INTEGER NOT NULL, code TEXT NOT NULL, snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json))
        );
        CREATE TABLE IF NOT EXISTS pm_suivi_faits (
          project_id TEXT NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
          echeance TEXT NOT NULL, date TEXT NOT NULL, piece TEXT, at TEXT NOT NULL,
          PRIMARY KEY(project_id, echeance)
        );
      `);
      initialized = true;
    }
    return db;
  };
  const projects = () => database().prepare('SELECT project_id, project_path, custom_project_name FROM projects WHERE isArchived IS NULL OR isArchived = 0').all() as Array<{ project_id: string; project_path: string; custom_project_name: string | null }>;
  const projectId = (cwd: string) => {
    if (!cwd) throw new TypeError('Dossier requis.');
    const resolved = path.resolve(cwd);
    const project = projects().filter((entry) => resolved === path.resolve(entry.project_path) || resolved.startsWith(`${path.resolve(entry.project_path)}${path.sep}`)).sort((a, b) => b.project_path.length - a.project_path.length)[0];
    if (!project) throw new TypeError('Dossier non enregistré.');
    return { id: project.project_id, root: project.project_path };
  };
  const marks = (id: string) => new Map((database().prepare('SELECT echeance, date, piece, at FROM pm_suivi_faits WHERE project_id=?').all(id) as Array<SuiviMark & { echeance: string }>).map(({ echeance, ...mark }) => [echeance, mark]));
  const reliability = (id: string) => {
    const exists = database().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='pm_reasoning_reliability'").get();
    return new Map(exists ? (database().prepare('SELECT piece, reliable FROM pm_reasoning_reliability WHERE project_id=?').all(id) as Array<{ piece: string; reliable: number }>).map((row) => [row.piece, row.reliable === 1]) : []);
  };
  const stored = (id: string): SuiviSnapshot => {
    const row = database().prepare('SELECT snapshot_json FROM pm_suivi WHERE project_id=?').get(id) as { snapshot_json: string } | undefined;
    return row ? { ...empty(), ...JSON.parse(row.snapshot_json) as SuiviSnapshot } : empty();
  };
  const fileOf = async (root: string) => readFile(path.join(root, SUIVI_FILE), 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });

  const sources = new Map<string, Promise<SourceInfo | null | undefined>>();
  const cached: ReasoningConnectors = { ...connectors, source: (cwd, id) => { const key = `${cwd}\0${id}`; if (!sources.has(key)) sources.set(key, connectors.source(cwd, id)); return sources.get(key)!; } };

  const verify = async (cwd: string, fresh = true): Promise<SuiviSnapshot> => {
    const { id, root } = projectId(cwd);
    if (fresh) for (const key of sources.keys()) if (key.startsWith(`${root}\0`)) sources.delete(key);
    const code = await fileOf(root);
    if (code === null) throw new TypeError(MISSING);
    const result = await verifySuivi({ code, cwd: root, connectors: cached, reliability: reliability(id), marks: marks(id) });
    const previous = stored(id);
    const snapshot: SuiviSnapshot = { revision: previous.revision + 1, updatedAt: new Date().toISOString(), code, hash: hashOf(code), ...result };
    database().prepare('INSERT INTO pm_suivi VALUES(?,?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision, code=excluded.code, snapshot_json=excluded.snapshot_json').run(id, snapshot.revision, code, JSON.stringify(snapshot));
    return snapshot;
  };

  const read = async (cwd: string): Promise<SuiviSnapshot> => {
    const { id, root } = projectId(cwd);
    const code = await fileOf(root);
    if (code === null) return { ...empty(), absent: true };
    const snapshot = stored(id);
    return snapshot.hash === hashOf(code) ? snapshot : verify(root, false);
  };

  const all = async (): Promise<SuiviDossier[]> => {
    const sessions = database().prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sessions'").get() ? database().prepare('SELECT session_id FROM sessions WHERE project_path=? AND (isArchived IS NULL OR isArchived = 0) ORDER BY updated_at DESC LIMIT 1') : null;
    const found: SuiviDossier[] = [];
    for (const project of projects()) {
      if (await fileOf(project.project_path) === null) continue;
      const snapshot = await read(project.project_path).catch((error: unknown) => ({ ...empty(), issues: [{ id: 'lecture', kind: 'erreur' as const, path: '', line: null, text: error instanceof Error ? error.message : 'Suivi illisible.' }] }));
      const session = (sessions?.get(project.project_path) as { session_id: string } | undefined)?.session_id ?? null;
      found.push({ projectPath: project.project_path, nom: project.custom_project_name || path.basename(project.project_path), session, snapshot });
    }
    return found;
  };

  const mark = async (cwd: string, echeance: string, input: { date?: unknown; piece?: unknown; annuler?: unknown }) => {
    const { id, root } = projectId(cwd);
    if (input.annuler === true) database().prepare('DELETE FROM pm_suivi_faits WHERE project_id=? AND echeance=?').run(id, echeance);
    else {
      const date = input.date ?? new Date().toISOString().slice(0, 10);
      if (!isLegalDate(date)) throw new TypeError('date AAAA-MM-JJ attendue.');
      if (input.piece !== undefined && input.piece !== null && typeof input.piece !== 'string') throw new TypeError('piece : chemin de la pièce.');
      if (!(await read(root)).echeances.some((deadline) => deadline.nom === echeance)) throw new TypeError('Échéance introuvable.');
      database().prepare('INSERT OR REPLACE INTO pm_suivi_faits VALUES(?,?,?,?,?)').run(id, echeance, date, (input.piece as string | undefined) || null, new Date().toISOString());
    }
    return verify(root, false);
  };

  database();
  return {
    read,
    verify,
    all,
    mark,
    async command(cwd: string, input: { commande?: unknown }): Promise<string> {
      if (input.commande !== undefined && input.commande !== 'verifier') throw new TypeError('Commande : verifier.');
      const snapshot = await verify(cwd);
      return `Suivi du dossier (${SUIVI_FILE})\n${describeSuivi(snapshot)}`;
    },
  };
}

export function createSuiviRouter(service: ReturnType<typeof createSuiviService>) {
  const router = express.Router();
  const handle = (run: (body: Record<string, unknown>) => unknown, needsProject = true) => async (request: express.Request, response: express.Response) => {
    try {
      const body = { ...request.query, ...(request.body ?? {}) } as Record<string, unknown>;
      if (needsProject && typeof body.projectPath !== 'string') throw new TypeError('projectPath requis.');
      response.json(await run(body));
    } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : 'Suivi indisponible.' }); }
  };
  router.get('/tous', handle(() => service.all(), false));
  router.get('/', handle((body) => service.read(body.projectPath as string)));
  router.post('/verify', express.json(), handle((body) => service.verify(body.projectPath as string)));
  router.post('/fait', express.json(), handle((body) => {
    if (typeof body.echeance !== 'string') throw new TypeError('echeance requise.');
    return service.mark(body.projectPath as string, body.echeance, body);
  }));
  return router;
}

export function createSuiviLocalRouter(service: ReturnType<typeof createSuiviService>, isLoopback: (request: express.Request) => boolean) {
  const router = express.Router();
  router.post('/suivi', express.json(), (request, response) => {
    if (!isLoopback(request)) { response.status(403).json({ erreur: 'Réservé aux appels locaux.' }); return; }
    const { cwd, ...input } = request.body ?? {};
    if (typeof cwd !== 'string' || !cwd) { response.status(400).json({ erreur: 'cwd requis.' }); return; }
    service.command(cwd, input).then((resultat) => response.json({ resultat }), (error: unknown) => response.status(400).json({ erreur: error instanceof Error ? error.message : 'Commande impossible.' }));
  });
  return router;
}
