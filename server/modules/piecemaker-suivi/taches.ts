import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const TACHES_FILE = 'todo.json';

export type TacheStatut = 'attente' | 'en-cours' | 'question' | 'terminee' | 'echec';
export type Demande = { requestId: string; toolName: string; input: unknown };
export type Decision = { allow: boolean; updatedInput?: unknown; message?: string };

export type Tache = {
  id: string;
  projectPath: string;
  dossier: string;
  raisonnement: string | null;
  type: string;
  titre: string;
  provider: string;
  model: string;
  prompt: string;
  auto: boolean;
  statut: TacheStatut;
  userId: number | null;
  sessionId: string | null;
  creeLe: string;
  lanceLe: string | null;
  finLe: string | null;
  erreur: string | null;
  question?: string | null;
};

export type TacheInput = Pick<Tache, 'projectPath' | 'dossier' | 'raisonnement' | 'type' | 'titre' | 'provider' | 'model' | 'prompt' | 'auto' | 'userId'>;

export type TacheLauncher = {
  open(tache: Tache): string;
  run(tache: Tache, sessionId: string, content: string): Promise<{ started: boolean; error: string | null }>;
  lastAnswer(sessionId: string): Promise<string>;
  pending(sessionId: string): Demande[];
  resolve(requestId: string, decision: Decision): void;
};

const QUESTION = /^[\s*_>#-]*question\s*:/im;

const KEPT_DONE = 30;
const TICK_MS = 3000;

export function createTachesService(home: string, launcher: TacheLauncher) {
  const file = path.join(home, TACHES_FILE);
  const load = (): Tache[] => {
    try {
      const value: unknown = JSON.parse(readFileSync(file, 'utf8'));
      return Array.isArray(value) ? value as Tache[] : [];
    } catch { return []; }
  };
  const save = (list: Tache[]) => {
    mkdirSync(home, { recursive: true });
    writeFileSync(`${file}.tmp`, `${JSON.stringify(list, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
  };
  let taches = load().map((tache) => tache.statut === 'en-cours' ? { ...tache, statut: 'echec' as const, finLe: new Date().toISOString(), erreur: 'Interrompue : serveur redémarré.' } : tache);
  save(taches);

  const update = (id: string, patch: Partial<Tache>) => {
    taches = taches.map((tache) => tache.id === id ? { ...tache, ...patch } : tache);
    const done = taches.filter((tache) => tache.statut === 'terminee' || tache.statut === 'echec');
    const dropped = new Set(done.slice(0, Math.max(0, done.length - KEPT_DONE)).map((tache) => tache.id));
    taches = taches.filter((tache) => !dropped.has(tache.id));
    save(taches);
  };
  const find = (id: string) => {
    const tache = taches.find((entry) => entry.id === id);
    if (!tache) throw new TypeError('Tâche introuvable.');
    return tache;
  };

  const turn = (tache: Tache, sessionId: string, content: string) => {
    update(tache.id, { statut: 'en-cours', sessionId, question: null, lanceLe: tache.lanceLe ?? new Date().toISOString() });
    const failed = (error: unknown) => update(tache.id, { statut: 'echec', erreur: error instanceof Error ? error.message : String(error), finLe: new Date().toISOString() });
    void launcher.run(tache, sessionId, content).then(async (result) => {
      if (!result.started || result.error) return update(tache.id, { statut: 'echec', erreur: result.error, finLe: new Date().toISOString() });
      const answer = await launcher.lastAnswer(sessionId).catch(() => '');
      if (QUESTION.test(answer)) update(tache.id, { statut: 'question', question: answer });
      else update(tache.id, { statut: 'terminee', erreur: null, finLe: new Date().toISOString() });
    }, failed).catch(failed);
    return find(tache.id);
  };

  const launch = (id: string) => {
    const tache = find(id);
    if (tache.statut !== 'attente') throw new TypeError('Tâche déjà lancée.');
    return turn(tache, launcher.open(tache), tache.prompt);
  };

  const reply = (id: string, texte: string) => {
    const tache = find(id);
    if (tache.statut !== 'question' || !tache.sessionId) throw new TypeError('Aucune question en attente.');
    if (!texte.trim()) throw new TypeError('Réponse requise.');
    return turn(tache, tache.sessionId, texte.trim());
  };

  const withDemandes = (tache: Tache) => tache.statut === 'en-cours' && tache.sessionId ? { ...tache, demandes: launcher.pending(tache.sessionId) } : tache;

  const tick = () => {
    if (taches.some((tache) => tache.statut === 'en-cours')) return;
    const next = taches.find((tache) => tache.auto && tache.statut === 'attente');
    if (next) launch(next.id);
  };
  const timer = setInterval(() => { try { tick(); } catch (error) { console.warn(`[piecemaker] tâche non lancée : ${error instanceof Error ? error.message : String(error)}`); } }, TICK_MS);
  timer.unref?.();

  return {
    list: () => taches.map(withDemandes),
    add(input: TacheInput) {
      const tache: Tache = { ...input, id: randomUUID(), statut: 'attente', sessionId: null, creeLe: new Date().toISOString(), lanceLe: null, finLe: null, erreur: null };
      taches = [...taches, tache];
      save(taches);
      return tache;
    },
    launch,
    reply,
    decide(id: string, requestId: string, decision: Decision) {
      const tache = find(id);
      if (!tache.sessionId || !launcher.pending(tache.sessionId).some((demande) => demande.requestId === requestId)) throw new TypeError('Demande introuvable ou déjà traitée.');
      launcher.resolve(requestId, decision);
      return withDemandes(find(id));
    },
    finish(id: string) {
      if (find(id).statut !== 'question') throw new TypeError('Aucune question en attente.');
      update(id, { statut: 'terminee', finLe: new Date().toISOString() });
      return find(id);
    },
    remove(id: string) {
      if (find(id).statut === 'en-cours') throw new TypeError('Tâche en cours : arrêtez la session d’abord.');
      taches = taches.filter((tache) => tache.id !== id);
      save(taches);
    },
    setAuto(id: string, auto: boolean) {
      if (find(id).statut !== 'attente') throw new TypeError('Tâche déjà lancée.');
      update(id, { auto });
      return find(id);
    },
    active: (projectPath: string, raisonnement: string | null) => taches.find((tache) => tache.projectPath === projectPath && tache.raisonnement === raisonnement && (tache.statut === 'attente' || tache.statut === 'en-cours' || tache.statut === 'question')) ?? null,
    stop: () => clearInterval(timer),
  };
}
