import { existsSync } from 'fs';
import { lstat, readFile, realpath, rename, writeFile } from 'fs/promises';
import path from 'path';

import express, { type Request, type Response } from 'express';

import { projectsDb } from '@/modules/database/index.js';

const CLAUDE_FILE = 'CLAUDE.md';
const AGENTS_FILE = 'AGENTS.md';
const AGENTS_IMPORT = `@${AGENTS_FILE}\n`;
const PROJECT_REFRESH_INTERVAL_MS = 5000;

async function isPresent(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

const importsAgents = (content: Buffer) => /^@AGENTS\.md(\r?\n|$)/.test(content.toString('utf8'));

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
  const claudeContent = hasClaude ? await readFile(claudePath) : null;
  const claudeImportsAgents = claudeContent !== null && importsAgents(claudeContent);
  if (!hasAgents) {
    const content = claudeContent && !claudeImportsAgents ? claudeContent : agentInstructionsTemplate(sharedInstructionsFile);
    await writeFile(agentsPath, content, { flag: 'wx' });
  } else if (hasClaude && (await lstat(agentsPath)).isSymbolicLink() && (await realpath(claudePath)) === (await realpath(agentsPath))) {
    return [];
  }
  if (!claudeImportsAgents) {
    const temporaryPath = `${claudePath}.piecemaker-${process.pid}.tmp`;
    await writeFile(temporaryPath, AGENTS_IMPORT);
    await rename(temporaryPath, claudePath);
  }
  return [...(hasClaude ? [] : [CLAUDE_FILE]), ...(hasAgents ? [] : [AGENTS_FILE])];
}

export function startAgentInstructionsMigration(
  listProjectRoots: () => string[],
  sharedInstructionsFile: string,
  onProjectSeen?: (projectRoot: string) => void,
): () => void {
  const seen = new Set<string>();

  const sweep = () => {
    let projectRoots: Set<string>;
    try {
      projectRoots = new Set(listProjectRoots().map((projectRoot) => path.resolve(projectRoot)));
    } catch {
      return;
    }
    for (const projectRoot of seen) {
      if (!projectRoots.has(projectRoot)) seen.delete(projectRoot);
    }
    for (const projectRoot of projectRoots) {
      if (seen.has(projectRoot) || !existsSync(projectRoot)) continue;
      seen.add(projectRoot);
      if (existsSync(path.join(projectRoot, CLAUDE_FILE))) {
        ensureAgentInstructionFiles(projectRoot, sharedInstructionsFile).catch(() => undefined);
      }
      onProjectSeen?.(projectRoot);
    }
  };

  sweep();
  const interval = setInterval(sweep, PROJECT_REFRESH_INTERVAL_MS).unref();
  return () => clearInterval(interval);
}

export function createAgentInstructionsRouter(sharedInstructionsFile: string) {
  const router = express.Router();

  router.post('/agent-instructions', async (request: Request, response: Response) => {
    const projectId = typeof request.body?.projectId === 'string' ? request.body.projectId : '';
    const projectRoot = projectId ? projectsDb.getProjectPathById(projectId) : null;
    if (!projectRoot) return response.status(404).json({ error: 'Projet introuvable.' });
    try {
      const created = await ensureAgentInstructionFiles(projectRoot, sharedInstructionsFile);
      response.json({ ok: true, created });
    } catch (error) {
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
