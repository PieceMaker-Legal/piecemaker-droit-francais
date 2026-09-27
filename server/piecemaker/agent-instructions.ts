import { constants, watch, type FSWatcher } from 'fs';
import { copyFile, lstat, readFile, realpath, rename, stat, writeFile } from 'fs/promises';
import path from 'path';

import express, { type Request, type Response } from 'express';

import { projectsDb } from '@/modules/database/index.js';

const CLAUDE_FILE = 'CLAUDE.md';
const AGENTS_FILE = 'AGENTS.md';
const WATCHED_FILES = new Set([CLAUDE_FILE, AGENTS_FILE]);
const PROJECT_REFRESH_INTERVAL_MS = 5000;
const MIRROR_DEBOUNCE_MS = 300;

async function isPresent(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

export function agentInstructionsTemplate(sharedInstructionsFile: string): string {
  return [
    `@${sharedInstructionsFile}`,
    '',
    '# Ce dossier',
    '<!-- Éléments propres à ce dossier : parties, juridiction, échéances, particularités. À compléter. -->',
    '',
  ].join('\n');
}

export async function ensureAgentInstructionFiles(projectRoot: string, sharedInstructionsFile: string): Promise<string[]> {
  const claudePath = path.join(projectRoot, CLAUDE_FILE);
  const agentsPath = path.join(projectRoot, AGENTS_FILE);
  const [hasClaude, hasAgents] = await Promise.all([isPresent(claudePath), isPresent(agentsPath)]);
  if (hasClaude && hasAgents) return [];
  if (hasClaude) {
    await copyFile(claudePath, agentsPath, constants.COPYFILE_EXCL);
    return [AGENTS_FILE];
  }
  if (hasAgents) {
    await copyFile(agentsPath, claudePath, constants.COPYFILE_EXCL);
    return [CLAUDE_FILE];
  }
  const template = agentInstructionsTemplate(sharedInstructionsFile);
  await writeFile(claudePath, template, { flag: 'wx' });
  await writeFile(agentsPath, template, { flag: 'wx' });
  return [CLAUDE_FILE, AGENTS_FILE];
}

const lastMirroredContents = new Map<string, Buffer>();

export async function mirrorAgentInstructionFiles(projectRoot: string): Promise<void> {
  try {
    const claudePath = path.join(projectRoot, CLAUDE_FILE);
    const agentsPath = path.join(projectRoot, AGENTS_FILE);
    await Promise.all([stat(claudePath), stat(agentsPath)]);
    if ((await realpath(claudePath)) === (await realpath(agentsPath))) return;
    const [claudeContent, agentsContent] = await Promise.all([readFile(claudePath), readFile(agentsPath)]);
    if (claudeContent.equals(agentsContent)) {
      lastMirroredContents.set(projectRoot, claudeContent);
      return;
    }
    const lastMirrored = lastMirroredContents.get(projectRoot);
    if (!lastMirrored) return;
    const claudeChanged = agentsContent.equals(lastMirrored);
    if (!claudeChanged && !claudeContent.equals(lastMirrored)) return;
    const [content, targetPath] = claudeChanged ? [claudeContent, agentsPath] : [agentsContent, claudePath];
    const temporaryPath = `${targetPath}.piecemaker-${process.pid}.tmp`;
    await writeFile(temporaryPath, content);
    await rename(temporaryPath, targetPath);
    lastMirroredContents.set(projectRoot, content);
  } catch {
    return;
  }
}

export function startAgentInstructionsMirror(listProjectRoots: () => string[]): () => void {
  const watchers = new Map<string, FSWatcher>();
  const pendingMirrors = new Map<string, NodeJS.Timeout>();

  const scheduleMirror = (projectRoot: string) => {
    clearTimeout(pendingMirrors.get(projectRoot));
    pendingMirrors.set(projectRoot, setTimeout(() => {
      pendingMirrors.delete(projectRoot);
      void mirrorAgentInstructionFiles(projectRoot);
    }, MIRROR_DEBOUNCE_MS).unref());
  };

  const forget = (projectRoot: string) => {
    watchers.get(projectRoot)?.close();
    watchers.delete(projectRoot);
  };

  const refreshWatchers = () => {
    let projectRoots: Set<string>;
    try {
      projectRoots = new Set(listProjectRoots().map((projectRoot) => path.resolve(projectRoot)));
    } catch {
      return;
    }
    for (const projectRoot of watchers.keys()) {
      if (!projectRoots.has(projectRoot)) forget(projectRoot);
    }
    for (const projectRoot of projectRoots) {
      if (watchers.has(projectRoot)) continue;
      try {
        const watcher = watch(projectRoot, { persistent: false }, (_event, fileName) => {
          if (!fileName || WATCHED_FILES.has(fileName.toString())) scheduleMirror(projectRoot);
        });
        watcher.on('error', () => forget(projectRoot));
        watchers.set(projectRoot, watcher);
        scheduleMirror(projectRoot);
      } catch {
        continue;
      }
    }
  };

  refreshWatchers();
  const interval = setInterval(refreshWatchers, PROJECT_REFRESH_INTERVAL_MS).unref();
  return () => {
    clearInterval(interval);
    for (const timer of pendingMirrors.values()) clearTimeout(timer);
    for (const projectRoot of [...watchers.keys()]) forget(projectRoot);
  };
}

export function createAgentInstructionsRouter(sharedInstructionsFile: string) {
  const router = express.Router();

  router.post('/agent-instructions', async (request: Request, response: Response) => {
    const projectId = typeof request.body?.projectId === 'string' ? request.body.projectId : '';
    const projectRoot = projectId ? projectsDb.getProjectPathById(projectId) : null;
    if (!projectRoot) return response.status(404).json({ error: 'Projet introuvable.' });
    try {
      const created = await ensureAgentInstructionFiles(projectRoot, sharedInstructionsFile);
      await mirrorAgentInstructionFiles(projectRoot);
      response.json({ ok: true, created });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
