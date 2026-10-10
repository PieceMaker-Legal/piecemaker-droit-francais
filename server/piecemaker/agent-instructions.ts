import { existsSync } from 'fs';
import { lstat, readFile, realpath, rename, writeFile } from 'fs/promises';
import path from 'path';

import express, { type Request, type Response } from 'express';

import { projectsDb } from '@/modules/database/index.js';

const CLAUDE_FILE = 'CLAUDE.md';
const AGENTS_FILE = 'AGENTS.md';
const AGENTS_IMPORT = `@${AGENTS_FILE}`;
const PROJECT_REFRESH_INTERVAL_MS = 5000;

async function isPresent(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch {
    return false;
  }
}

const AGENTS_IMPORT_LINE = /^@AGENTS\.md(\r?\n|$)/;
const importsAgents = (content: string) => AGENTS_IMPORT_LINE.test(content);
const hasLine = (content: string, line: string) => content.split(/\r?\n/).includes(line);
const withoutLine = (content: string, line: string) => content.split('\n').filter((current) => current.replace(/\r$/, '') !== line).join('\n');

export function agentInstructionsTemplate(): string {
  return [
    '# Ce dossier',
    '<!-- Éléments propres à ce dossier : parties, juridiction, échéances, particularités. À compléter. -->',
    '',
  ].join('\n');
}

export async function ensureAgentInstructionFiles(projectRoot: string, sharedInstructionsFile: string): Promise<string[]> {
  const claudePath = path.join(projectRoot, CLAUDE_FILE);
  const agentsPath = path.join(projectRoot, AGENTS_FILE);
  const [hasClaude, hasAgents] = await Promise.all([isPresent(claudePath), isPresent(agentsPath)]);
  const sharedImport = `@${sharedInstructionsFile}`;
  const claudeContent = hasClaude ? await readFile(claudePath, 'utf8') : null;
  const claudeImportsAgents = claudeContent !== null && importsAgents(claudeContent);
  if (!hasAgents) {
    const content = claudeContent !== null && !claudeImportsAgents ? withoutLine(claudeContent, sharedImport) : agentInstructionsTemplate();
    await writeFile(agentsPath, content, { flag: 'wx' });
  } else if (hasClaude && (await lstat(agentsPath)).isSymbolicLink() && (await realpath(claudePath)) === (await realpath(agentsPath))) {
    return [];
  }
  const claudeImports = `${AGENTS_IMPORT}\n${sharedImport}\n`;
  const nextClaudeContent = claudeContent === null || !claudeImportsAgents
    ? claudeImports
    : hasLine(claudeContent, sharedImport) ? null : claudeContent.replace(AGENTS_IMPORT_LINE, claudeImports);
  if (nextClaudeContent !== null) {
    const temporaryPath = `${claudePath}.piecemaker-${process.pid}.tmp`;
    await writeFile(temporaryPath, nextClaudeContent);
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
