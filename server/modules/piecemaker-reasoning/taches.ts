import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const TACHES_FILE = 'todo.json';

export type TacheStatut = 'attente' | 'en-cours' | 'terminee' | 'echec';

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
};

export type TacheInput = Pick<Tache, 'projectPath' | 'dossier' | 'raisonnement' | 'type' | 'titre' | 'provider' | 'model' | 'prompt' | 'auto' | 'userId'>;

export type TacheLauncher = {
  open(tache: Tache): string;
  run(tache: Tache, sessionId: string): Promise<{ started: boolean; error: string | null }>;
};

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

  const launch = (id: string) => {
    const tache = find(id);
    if (tache.statut !== 'attente') throw new TypeError('Tâche déjà lancée.');
    const sessionId = launcher.open(tache);
    update(id, { statut: 'en-cours', sessionId, lanceLe: new Date().toISOString() });
    void launcher.run(tache, sessionId).then(
      (result) => update(id, { statut: result.started && !result.error ? 'terminee' : 'echec', erreur: result.error, finLe: new Date().toISOString() }),
      (error: unknown) => update(id, { statut: 'echec', erreur: error instanceof Error ? error.message : String(error), finLe: new Date().toISOString() }),
    );
    return find(id);
  };

  const tick = () => {
    if (taches.some((tache) => tache.statut === 'en-cours')) return;
    const next = taches.find((tache) => tache.auto && tache.statut === 'attente');
    if (next) launch(next.id);
  };
  const timer = setInterval(() => { try { tick(); } catch (error) { console.warn(`[piecemaker] tâche non lancée : ${error instanceof Error ? error.message : String(error)}`); } }, TICK_MS);
  timer.unref?.();

  return {
    list: () => taches,
    add(input: TacheInput) {
      const tache: Tache = { ...input, id: randomUUID(), statut: 'attente', sessionId: null, creeLe: new Date().toISOString(), lanceLe: null, finLe: null, erreur: null };
      taches = [...taches, tache];
      save(taches);
      return tache;
    },
    launch,
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
    active: (projectPath: string, raisonnement: string | null) => taches.find((tache) => tache.projectPath === projectPath && tache.raisonnement === raisonnement && (tache.statut === 'attente' || tache.statut === 'en-cours')) ?? null,
    stop: () => clearInterval(timer),
  };
}
