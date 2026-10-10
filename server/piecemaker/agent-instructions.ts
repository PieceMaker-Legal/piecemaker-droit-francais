import { watch, type FSWatcher } from 'fs';
import { lstat, readFile, readlink, realpath, rename, rm, symlink, writeFile } from 'fs/promises';
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

async function readIfRegularFile(filePath: string): Promise<Buffer | null> {
  return (await lstat(filePath)).isFile() ? readFile(filePath) : null;
}

async function isLinkTo(linkPath: string, targetPath: string): Promise<boolean> {
  try {
    if (!(await lstat(linkPath)).isSymbolicLink()) return false;
    return path.resolve(path.dirname(linkPath), await readlink(linkPath)) === targetPath;
  } catch {
    return false;
  }
}

async function replaceAtomically(targetPath: string, create: (temporaryPath: string) => Promise<void>): Promise<void> {
  const temporaryPath = `${targetPath}.piecemaker-${process.pid}.tmp`;
  await rm(temporaryPath, { force: true });
  await create(temporaryPath);
  await rename(temporaryPath, targetPath);
}

const AGENTS_IMPORT = `@${AGENTS_FILE}\n`;

const importsAgents = (content: Buffer | null) => content !== null && /^@AGENTS\.md(\r?\n|$)/.test(content.toString('utf8'));

let symlinksSupported = true;

async function linkClaudeToAgents(claudePath: string): Promise<boolean> {
  if (!symlinksSupported) return false;
  try {
    await replaceAtomically(claudePath, (temporaryPath) => symlink(AGENTS_FILE, temporaryPath, 'file'));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EPERM') throw error;
    symlinksSupported = false;
    return false;
  }
}

async function pointClaudeAtAgents(projectRoot: string): Promise<void> {
  const claudePath = path.join(projectRoot, CLAUDE_FILE);
  if (await linkClaudeToAgents(claudePath)) return;
  await replaceAtomically(claudePath, (temporaryPath) => writeFile(temporaryPath, AGENTS_IMPORT));
}

export async function ensureAgentInstructionFiles(projectRoot: string, sharedInstructionsFile: string): Promise<string[]> {
  const claudePath = path.join(projectRoot, CLAUDE_FILE);
  const agentsPath = path.join(projectRoot, AGENTS_FILE);
  const [hasClaude, hasAgents] = await Promise.all([isPresent(claudePath), isPresent(agentsPath)]);
  const created: string[] = [];
  if (!hasAgents) {
    const claudeContent = hasClaude ? await readFile(claudePath) : null;
    const content = claudeContent && !importsAgents(claudeContent) ? claudeContent : agentInstructionsTemplate(sharedInstructionsFile);
    await writeFile(agentsPath, content, { flag: 'wx' });
  }
  if (!hasClaude) {
    await pointClaudeAtAgents(projectRoot);
    created.push(CLAUDE_FILE);
  }
  if (!hasAgents) created.push(AGENTS_FILE);
  return created;
}

const lastSyncedContents = new Map<string, Buffer>();

export async function mirrorAgentInstructionFiles(projectRoot: string): Promise<void> {
  try {
    const claudePath = path.join(projectRoot, CLAUDE_FILE);
    const agentsPath = path.join(projectRoot, AGENTS_FILE);
    if (await isLinkTo(claudePath, agentsPath)) {
      lastSyncedContents.set(projectRoot, await readFile(agentsPath));
      return;
    }
    const [agentsStats] = await Promise.all([lstat(agentsPath), lstat(claudePath)]);
    if (agentsStats.isSymbolicLink() && (await realpath(agentsPath)) === (await realpath(claudePath))) {
      const content = await readFile(claudePath);
      await replaceAtomically(agentsPath, (temporaryPath) => writeFile(temporaryPath, content));
    }
    let agentsContent: Buffer = await readFile(agentsPath);
    const claudeContent = await readIfRegularFile(claudePath);
    if (importsAgents(claudeContent)) {
      await linkClaudeToAgents(claudePath);
      lastSyncedContents.set(projectRoot, agentsContent);
      return;
    }
    if (claudeContent && !claudeContent.equals(agentsContent) && lastSyncedContents.get(projectRoot)?.equals(agentsContent)) {
      await replaceAtomically(agentsPath, (temporaryPath) => writeFile(temporaryPath, claudeContent));
      agentsContent = claudeContent;
    }
    await pointClaudeAtAgents(projectRoot);
    lastSyncedContents.set(projectRoot, agentsContent);
  } catch {
    return;
  }
}

export function startAgentInstructionsMirror(listProjectRoots: () => string[], onProjectWatched?: (projectRoot: string) => void): () => void {
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
        onProjectWatched?.(projectRoot);
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
