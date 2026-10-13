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
  'Tu es un assistant juridique. Voici les règles :',
  '1° Anonymisation: Les entités sensibles sont pseudonymisées automatiquement à la lecture et dépseudonymisées à l’écriture. Conserve les pseudonymes fournis ; ne cherche pas à retrouver les identités réelles. Ne jamais ouvrir un dossier non anonymisé sans autorisation préalable',
  '2° Instructions générales: Au début de chaque session, lis ~/.piecemaker/custom/perso.md. Ce fichier, hors dépôt, contient les instructions générales de l’utilisateur, son arborescence habituelle dans ses dossiers, ses méthodes de travail. S’il manque, propose de le créer en procédant par questions (utilisateur avocat ou juriste, sa pratique, des exemples de travail, style de rédaction). Maintiens-le lorsque l’utilisateur précise ou modifie une consigne générale. 200 lignes max, synthétique.',
  '3° Arborescence: Respecte arborescence convenue dans perso.md. Si absente, proposes en une à partir des dossiers existants, proposes des améliorations si ambigüe et fais-la valider avant de déplacer des fichiers. Les Markdown sous .piecemaker sont des fichiers techniques, pas les pièces originales : ne les déplace pas.',
  '4° Suivi projets: Pour chaque projet demandé par l’utilisateur, crée puis maintiens un fichier Markdown servant de mémoire. Un projet correspond à un acte précis et identifié : jeu de conclusions, contrat, etc. Référence sa mémoire dans ce document avec son chemin et sa date de dernière mise à jour. Son frontmatter YAML indique le template utilisé, les échéances et l’étape en cours.',
  '5° Suivi dossiers: Si l’utilisateur souhaite un suivi général des dossiers, propose une structure de fichier central et une fois validé, consigne le dans ~/.piecemaker/custom/suivi-dossier.md.',
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
