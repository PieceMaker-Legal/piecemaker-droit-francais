import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import express from 'express';

import { notifyCatalaUpdated } from '../modules/piecemaker-catala/index.js';

import type { createCatalaCitation } from './catala-citation.js';

type CatalaDeps = { env?: NodeJS.ProcessEnv; homeDir?: string; [key: string]: unknown };
type CatalaScript = {
  findCatalaPack(options: { env?: NodeJS.ProcessEnv; homeDir?: string }): { pack: Record<string, unknown> | null; status: Record<string, unknown> | null };
  listPrograms(cwd: string): string[];
  selectProgram(cwd: string, name?: string): { directory: string; name: string };
  sourceFiles(directory: string): string[];
  sourcesDigest(directory: string, files: string[]): string;
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

export function createCatalaCitationCheck(scriptPath: string, service: ReturnType<typeof createCatalaCitation>) {
  return async ({ cwd, programme }: { cwd: string; programme?: string }) => {
    const catala = await import(pathToFileURL(scriptPath).href) as CatalaScript;
    const { directory } = catala.selectProgram(cwd, programme);
    return service.verify(cwd, catala.sourceFiles(directory).map((nom) => ({ nom, chemin: path.join(directory, nom), contenu: fs.readFileSync(path.join(directory, nom), 'utf8') })));
  };
}

export function createCatalaRouter(scriptPath: string, deps: CatalaDeps = {}, service?: ReturnType<typeof createCatalaCitation>) {
  const router = express.Router();
  const running = new Set<string>();
  const script = () => import(pathToFileURL(scriptPath).href) as Promise<CatalaScript>;
  const snapshot = async (projectPath: string) => {
    const catala = await script();
    const { pack, status } = catala.findCatalaPack({ env: deps.env ?? process.env, homeDir: deps.homeDir ?? os.homedir() });
    const programmes = catala.listPrograms(projectPath).map((nom) => {
      const directory = path.join(projectPath, '.piecemaker', 'catala', nom);
      const results = path.join(directory, 'resultats');
      const files = catala.sourceFiles(directory);
      const explanation = readJson(path.join(results, 'explication.json'));
      const digest = catala.sourcesDigest(directory, files);
      const perimee = explanation?.sources_sha256 !== digest;
      const citationReport = readJson(path.join(results, 'citations.json'));
      const scenarios = readJson(path.join(results, 'scenarios.json'));
      const tests = readJson(path.join(results, 'tests.json'));
      const journaux = fs.existsSync(results) ? fs.readdirSync(results).filter((file) => file.endsWith('.log') && fs.lstatSync(path.join(results, file)).isFile()).sort() : [];
      return {
        nom,
        tache: readJson(path.join(directory, 'tache.json')),
        perimee,
        enCours: running.has(directory),
        fichiers: files.map((file) => ({ nom: file.split(path.sep).join('/'), chemin: path.join(directory, file), contenu: fs.readFileSync(path.join(directory, file), 'utf8') })),
        journaux: journaux.map((file) => ({ nom: file, chemin: path.join(results, file), contenu: fs.readFileSync(path.join(results, file), 'utf8') })),
        verification: readJson(path.join(results, 'verification.json')),
        tests: tests?.sources_sha256 === digest ? tests : null,
        preuve: readJson(path.join(results, 'preuve.json')),
        catleg: readJson(path.join(results, 'catleg.json')),
        citations: citationReport?.sources_sha256 === digest ? citationReport : null,
        explication: explanation,
        scenarios: scenarios?.sources_sha256 === digest ? scenarios.scenarios : [],
        graphe: !perimee && fs.existsSync(path.join(results, 'explication.dot')) ? fs.readFileSync(path.join(results, 'explication.dot'), 'utf8') : null,
      };
    });
    const styleSkill = path.resolve(path.dirname(scriptPath), '..', '..', '..', 'piecemaker-plugin', 'skills', 'style-redaction-cabinet', 'SKILL.md');
    const generalRule = (regle: string) => {
      const file = path.join(path.dirname(styleSkill), regle);
      return fs.existsSync(file) && /^type:\s*regle-generale\s*$/m.test(fs.readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '');
    };
    const styles = fs.existsSync(styleSkill) ? [...fs.readFileSync(styleSkill, 'utf8').matchAll(/^\|\s*([^|[\]]+?)\s*\|\s*\[(styles\/[^\]]+)\]/gm)].map(([, nom, regle]) => ({ nom, regle })).filter(({ regle }) => !generalRule(regle)) : [];
    return { pack: pack ? { id: pack.id, platform: pack.platform, version: pack.version, proof: pack.proof, installedAt: pack.installedAt } : null, status, programmes, styles };
  };
  const fail = (response: express.Response, error: unknown) => response.status(400).json({ error: error instanceof Error ? error.message : 'Catala indisponible.' });
  router.get('/', (request, response) => {
    const { projectPath } = request.query;
    if (typeof projectPath !== 'string' || !projectPath) { fail(response, new TypeError('projectPath requis.')); return; }
    snapshot(projectPath).then((data) => response.json(data), (error: unknown) => fail(response, error));
  });
  router.post('/citation', express.json(), async (request, response) => {
    try {
      const { projectPath, programme, fichier, source, citation, parent } = request.body ?? {};
      if (![projectPath, programme, fichier, source, citation].every((value) => typeof value === 'string') || !projectPath || !service || (parent !== undefined && typeof parent !== 'string')) throw new Error('Référence Catala incomplète.');
      const data = await snapshot(projectPath);
      const program = data.programmes.find((entry) => entry.nom === programme);
      const file = program?.fichiers.find((entry) => entry.chemin === fichier);
      if (!file) throw new Error('Fichier absent du programme Catala.');
      const saved = program?.citations?.results.find((entry: { origin: string; id?: string; quote: string; token?: string }) => entry.origin === fichier && entry.id === source && entry.quote === citation && entry.token);
      response.json({ token: saved?.token ?? await service.cite(projectPath, source, citation, file.contenu, parent) });
    } catch (error) { fail(response, error); }
  });
  router.post('/verify', express.json(), (request, response) => {
    const { projectPath, programme } = request.body ?? {};
    if (typeof projectPath !== 'string' || !projectPath || typeof programme !== 'string') { fail(response, new TypeError('projectPath et programme requis.')); return; }
    const directory = path.join(projectPath, '.piecemaker', 'catala', programme);
    if (running.has(directory)) { fail(response, new Error(`Vérification déjà en cours pour ${programme}.`)); return; }
    running.add(directory);
    const verified = script().then((catala) => catala.runCatala({ commande: 'verifier', cwd: projectPath, programme, deps: { ...deps, ...(service ? { citations: createCatalaCitationCheck(scriptPath, service) } : {}) } }));
    verified.finally(() => { running.delete(directory); notifyCatalaUpdated(projectPath); }).then(() => snapshot(projectPath)).then((data) => response.json(data), (error: unknown) => fail(response, error));
  });
  return router;
}

export function createCatalaUpdatedRouter(isLoopback: (request: express.Request) => boolean, projects: () => string[], verify?: ReturnType<typeof createCatalaCitationCheck>) {
  const router = express.Router();
  router.post('/catala-citations', express.json(), async (request, response) => {
    if (!isLoopback(request)) { response.sendStatus(403); return; }
    const { cwd, programme } = request.body ?? {};
    if (typeof cwd !== 'string' || !projects().includes(cwd) || (programme !== undefined && typeof programme !== 'string')) { response.status(400).json({ error: 'Dossier ou programme inconnu.' }); return; }
    if (!verify) { response.status(503).json({ error: 'Contrôle des citations indisponible.' }); return; }
    try { response.json(await verify({ cwd, programme })); }
    catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : String(error) }); }
  });
  router.post('/catala-updated', express.json(), (request, response) => {
    if (!isLoopback(request)) { response.sendStatus(403); return; }
    const { cwd } = request.body ?? {};
    if (typeof cwd !== 'string' || !projects().includes(cwd)) { response.status(400).json({ error: 'Dossier inconnu.' }); return; }
    notifyCatalaUpdated(cwd);
    response.json({ ok: true });
  });
  return router;
}
