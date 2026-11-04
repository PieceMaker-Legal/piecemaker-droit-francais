import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import express from 'express';

type CatalaDeps = { env?: NodeJS.ProcessEnv; homeDir?: string; [key: string]: unknown };
type CatalaScript = {
  findCatalaPack(options: { env?: NodeJS.ProcessEnv; homeDir?: string }): { pack: Record<string, unknown> | null; status: Record<string, unknown> | null };
  listPrograms(cwd: string): string[];
  sourceFiles(directory: string): string[];
  runCatala(input: { commande: string; cwd: string; programme?: string; deps?: CatalaDeps }): Promise<unknown>;
};

const readJson = (file: string) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

export function catalaScriptPath(applicationRoot: string) {
  return path.join(applicationRoot, 'server', 'piecemaker', 'vendor', 'skills', 'Skill-PieceMaker', 'scripts', 'catala.mjs');
}

export function createCatalaRouter(scriptPath: string, deps: CatalaDeps = {}) {
  const router = express.Router();
  const running = new Set<string>();
  const script = () => import(pathToFileURL(scriptPath).href) as Promise<CatalaScript>;
  const snapshot = async (projectPath: string) => {
    const catala = await script();
    const { pack, status } = catala.findCatalaPack({ env: deps.env ?? process.env, homeDir: deps.homeDir ?? os.homedir() });
    const programmes = catala.listPrograms(projectPath).map((nom) => {
      const directory = path.join(projectPath, '.piecemaker', 'catala', nom);
      const results = path.join(directory, 'resultats');
      const journaux = fs.existsSync(results) ? fs.readdirSync(results).filter((file) => file.endsWith('.log')).sort() : [];
      return {
        nom,
        enCours: running.has(directory),
        fichiers: catala.sourceFiles(directory).map((file) => ({ nom: file.split(path.sep).join('/'), chemin: path.join(directory, file) })),
        journaux: journaux.map((file) => ({ nom: file, chemin: path.join(results, file) })),
        verification: readJson(path.join(results, 'verification.json')),
        preuve: readJson(path.join(results, 'preuve.json')),
        catleg: readJson(path.join(results, 'catleg.json')),
        explication: readJson(path.join(results, 'explication.json')),
        graphe: fs.existsSync(path.join(results, 'explication.dot')) ? fs.readFileSync(path.join(results, 'explication.dot'), 'utf8') : null,
      };
    });
    return { pack: pack ? { id: pack.id, platform: pack.platform, version: pack.version, proof: pack.proof, installedAt: pack.installedAt } : null, status, programmes };
  };
  const fail = (response: express.Response, error: unknown) => response.status(400).json({ error: error instanceof Error ? error.message : 'Catala indisponible.' });
  router.get('/', (request, response) => {
    const { projectPath } = request.query;
    if (typeof projectPath !== 'string' || !projectPath) { fail(response, new TypeError('projectPath requis.')); return; }
    snapshot(projectPath).then((data) => response.json(data), (error: unknown) => fail(response, error));
  });
  router.post('/verify', express.json(), (request, response) => {
    const { projectPath, programme } = request.body ?? {};
    if (typeof projectPath !== 'string' || !projectPath || typeof programme !== 'string') { fail(response, new TypeError('projectPath et programme requis.')); return; }
    const directory = path.join(projectPath, '.piecemaker', 'catala', programme);
    if (running.has(directory)) { fail(response, new Error(`Vérification déjà en cours pour ${programme}.`)); return; }
    running.add(directory);
    const verified = script().then((catala) => catala.runCatala({ commande: 'verifier', cwd: projectPath, programme, ...(Object.keys(deps).length ? { deps } : {}) }));
    verified.finally(() => running.delete(directory)).then(() => snapshot(projectPath)).then((data) => response.json(data), (error: unknown) => fail(response, error));
  });
  return router;
}
