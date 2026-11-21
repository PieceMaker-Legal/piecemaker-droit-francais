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

const FOLDER_SUIVI_RULE = '5° Suivi dossiers: Les échéances et les dates qui les font courir vont dans un suivi, .piecemaker/<nom>-suivi.json (un fichier par acte ou procédure suivi), vérifié par pm suivi_dossiers verifier ; l’avocat les voit pour tous ses dossiers dans le Matter board de l’onglet Suivi des dossiers, qui donne une carte par fichier : un dossier sans suivi n’y figure pas.';
const SUIVI_RULE = '5° Suivi dossiers: Les échéances et les dates qui les font courir vont dans un suivi <nom>-suivi.json (un par acte ou procédure suivi), rangé sous « suivis » dans la Roadmap.json du dossier, dont pm check donne le chemin (sans brain : .piecemaker/<nom>-suivi.json), vérifié par pm suivi_dossiers verifier. Le suivi ne recopie rien de la base ni de l’index : les parties restent dans la base du dossier, et une date déjà portée par une prémisse de l’index y renvoie (evenements.<nom>.okf). L’avocat voit les suivis de tous ses dossiers dans le Matter board de l’onglet Suivi des dossiers, une carte par suivi.';
const MEMORY_RULE = '4° Suivi projets: Pour chaque projet demandé par l’utilisateur, crée puis maintiens sa mémoire, section « ## Mémoire : <nom> » de l’About.md du dossier, dont pm check donne le chemin (sans brain : .piecemaker/memoires/<nom>.md). Un projet correspond à un acte précis et identifié : jeu de conclusions, contrat, etc. ; <nom> est celui de son raisonnement et de son suivi. La mémoire garde le récit en Markdown, sans frontmatter : stratégie, décisions, consignes de l’avocat, travail fait et à faire. Les échéances vont dans le suivi (5°). L’étape en cours et le document à produire sont réglés par l’avocat sur le tableau de l’onglet Suivi des dossiers ; lis-les avec pm check. pm memoire verifier la contrôle.';
const SKILL_SUIVI_RULE = '5° Suivi dossiers: Les échéances et les dates qui les font courir vont dans un suivi, .piecemaker/<nom>-suivi.json (un fichier par acte ou procédure suivi), vérifié par pm suivi_dossiers verifier (voir la skill piecemaker) ; l’avocat les voit pour tous ses dossiers dans le Matter board de l’onglet Suivi des dossiers, qui donne une carte par fichier : un dossier sans suivi n’y figure pas.';
const OLD_SUIVI_RULES = [
  '5° Suivi dossiers: Les échéances et les dates qui les font courir vont dans un suivi, .piecemaker/<nom>-suivi.json (un fichier par acte ou procédure suivi), vérifié par pm suivi verifier (voir la skill piecemaker) ; l’avocat les voit pour tous ses dossiers dans le Matter board de l’onglet Suivi des dossiers, qui donne une carte par fichier : un dossier sans suivi n’y figure pas.',
  '5° Suivi dossiers: Les échéances et les dates qui les font courir vont dans le suivi du dossier, .piecemaker/suivi.json, vérifié par pm suivi verifier (voir la skill piecemaker) ; l’avocat les voit pour tous ses dossiers dans le Matter board de l’onglet Suivi des dossiers, qui lit ces fichiers : un dossier sans suivi.json n’y figure pas.',
  '5° Suivi dossiers: Les échéances et les dates qui les font courir vont dans le suivi du dossier, .piecemaker/suivi.json, vérifié par pm suivi verifier (voir la skill piecemaker) ; l’avocat les voit pour tous ses dossiers dans le Matter board de l’onglet Échéances, qui lit ces fichiers : un dossier sans suivi.json n’y figure pas.',
  '5° Suivi dossiers: Les échéances et les dates qui les font courir vont dans le suivi du dossier, .piecemaker/suivi.yaml, vérifié par pm suivi verifier (voir la skill piecemaker) ; l’avocat les voit pour tous ses dossiers dans l’onglet Échéances.',
  '5° Suivi dossiers: Les échéances et les dates qui les font courir vont dans le suivi du dossier, .piecemaker/suivi.json, vérifié par pm suivi verifier (voir la skill piecemaker) ; l’avocat les voit pour tous ses dossiers dans le Matter board de l’onglet Échéances.',
];
const FOLDER_MEMORY_RULE = '4° Suivi projets: Pour chaque projet demandé par l’utilisateur, crée puis maintiens sa mémoire, .piecemaker/memoires/<nom>.md. Un projet correspond à un acte précis et identifié : jeu de conclusions, contrat, etc. ; <nom> est celui de son raisonnement et de son suivi. La mémoire garde le récit en Markdown, sans frontmatter : décisions, consignes de l’avocat, travail fait et à faire. Les échéances vont dans le suivi (5°). L’étape en cours et le document à produire sont réglés par l’avocat sur le tableau de l’onglet Suivi des dossiers ; lis-les avec pm check. Une mémoire tenue ailleurs : déplace son récit ici et ses échéances dans le suivi. pm memoire verifier la contrôle.';
const SKILL_MEMORY_RULE = '4° Suivi projets: Pour chaque projet demandé par l’utilisateur, crée puis maintiens sa mémoire, .piecemaker/memoires/<nom>.md. Un projet correspond à un acte précis et identifié : jeu de conclusions, contrat, etc. ; <nom> est celui de son raisonnement et de son suivi. La mémoire garde le récit en Markdown, sans frontmatter : décisions, consignes de l’avocat, travail fait et à faire. Les échéances vont dans le suivi (5°). L’étape en cours et le document à produire sont réglés par l’avocat sur le tableau de l’onglet Suivi des dossiers ; lis-les avec pm check. Une mémoire tenue ailleurs : déplace son récit ici et ses échéances dans le suivi. pm memoire verifier la contrôle (voir la skill piecemaker).';
const OLD_MEMORY_RULE = '4° Suivi projets: Pour chaque projet demandé par l’utilisateur, crée puis maintiens un fichier Markdown servant de mémoire. Un projet correspond à un acte précis et identifié : jeu de conclusions, contrat, etc. Référence sa mémoire dans ce document avec son chemin et sa date de dernière mise à jour. Son frontmatter YAML indique le template utilisé, les échéances et l’étape en cours.';
const GENERAL_RULE = '2° Instructions générales: Au début de chaque session, lis ~/.piecemaker/custom/perso.md. Ce fichier, hors dépôt, contient les instructions générales de l’utilisateur et ses méthodes de travail. S’il manque, propose de le créer ; il commence toujours par la mention « Pour remplir ce document, lire @cold-start-interview.md ». Maintiens-le lorsque l’utilisateur précise ou modifie une consigne générale. 200 lignes max, synthétique.';
const OLD_GENERAL_RULE = '2° Instructions générales: Au début de chaque session, lis ~/.piecemaker/custom/perso.md. Ce fichier, hors dépôt, contient les instructions générales de l’utilisateur, son arborescence habituelle dans ses dossiers, ses méthodes de travail. S’il manque, propose de le créer ; il commence toujours par la mention « Pour remplir ce document, lire @cold-start-interview.md ». Maintiens-le lorsque l’utilisateur précise ou modifie une consigne générale. 200 lignes max, synthétique.';
const FILE_TREE_RULE = '3° Arborescence: Respecte l’arborescence du dossier, enregistrée dans .piecemaker/arborescence.json : l’avocat la règle dans l’index du dossier, tu la lis dans ce fichier ; pour proposer un changement, modifie ce fichier avec l’outil Edit ou Write, jamais par le shell : le hook en fait une proposition, seul l’avocat l’accepte. Un « / » dans un nom crée un sous-dossier. Si absente, proposes en une à partir des dossiers existants, proposes des améliorations si ambigüe et fais-la valider avant de déplacer des fichiers. Les Markdown sous .piecemaker sont des fichiers techniques, pas les pièces originales : ne les déplace pas.';
const TREE_RULE = '3° Arborescence: Respecte l’arborescence, commune à tous les dossiers et enregistrée dans la clé « arborescence » de ~/.piecemaker/ontologie.json : l’avocat la règle dans l’index du dossier, tu la lis avec pm dossier arborescence ; pour proposer un changement, modifie ce fichier avec l’outil Edit ou Write, jamais par le shell : le hook en fait une proposition, seul l’avocat l’accepte. Un « / » dans un nom crée un sous-dossier. Si absente, proposes en une à partir des dossiers existants, proposes des améliorations si ambigüe et fais-la valider avant de déplacer des fichiers. Les Markdown sous .piecemaker sont des fichiers techniques, pas les pièces originales : ne les déplace pas.';
const SKILL_TREE_RULE = '3° Arborescence: Respecte l’arborescence du dossier, enregistrée dans .piecemaker/arborescence.json : l’avocat la règle dans l’index du dossier, tu la lis dans ce fichier ; pour proposer un changement, modifie ce fichier avec l’outil Edit ou Write, jamais par le shell : le hook en fait une proposition, seul l’avocat l’accepte (voir la skill piecemaker). Un « / » dans un nom crée un sous-dossier. Si absente, proposes en une à partir des dossiers existants, proposes des améliorations si ambigüe et fais-la valider avant de déplacer des fichiers. Les Markdown sous .piecemaker sont des fichiers techniques, pas les pièces originales : ne les déplace pas.';
const PROPOSE_TREE_RULE = '3° Arborescence: Respecte l’arborescence du dossier, enregistrée dans .piecemaker/arborescence.json : l’avocat la règle dans l’index du dossier, tu la lis dans ce fichier et tu proposes un changement avec pm dossier arborescence (voir la skill piecemaker), un « / » dans un nom crée un sous-dossier ; seul l’avocat l’accepte. Si absente, proposes en une à partir des dossiers existants, proposes des améliorations si ambigüe et fais-la valider avant de déplacer des fichiers. Les Markdown sous .piecemaker sont des fichiers techniques, pas les pièces originales : ne les déplace pas.';
const REPLACE_TREE_RULE = '3° Arborescence: Respecte l’arborescence du dossier, enregistrée dans .piecemaker/arborescence.json : l’avocat la règle dans l’index du dossier, tu la lis dans ce fichier et tu la remplaces avec pm dossier arborescence (voir la skill piecemaker), un « / » dans un nom crée un sous-dossier. Si absente, proposes en une à partir des dossiers existants, proposes des améliorations si ambigüe et fais-la valider avant de déplacer des fichiers. Les Markdown sous .piecemaker sont des fichiers techniques, pas les pièces originales : ne les déplace pas.';
const PREVIOUS_TREE_RULE = '3° Arborescence: Respecte l’arborescence du dossier, enregistrée dans .piecemaker/arborescence.json : l’avocat la règle dans le Tabular review index, tu la lis ou la remplaces avec pm tabular_review_index arborescence (voir la skill piecemaker), un « / » dans un nom crée un sous-dossier. Si absente, proposes en une à partir des dossiers existants, proposes des améliorations si ambigüe et fais-la valider avant de déplacer des fichiers. Les Markdown sous .piecemaker sont des fichiers techniques, pas les pièces originales : ne les déplace pas.';
const OLD_TREE_RULE = '3° Arborescence: Respecte arborescence convenue dans perso.md. Si absente, proposes en une à partir des dossiers existants, proposes des améliorations si ambigüe et fais-la valider avant de déplacer des fichiers. Les Markdown sous .piecemaker sont des fichiers techniques, pas les pièces originales : ne les déplace pas.';
const TEMPLATE_HEADER = 'Tu es un assistant juridique. Voici les règles :';
const TOOLS_RULE_START = '6° Outils:';
const HELP_LINE = '- Syntaxe d’une commande → pm --help';
const OLD_DELEGATION_LINE = '- Index des pièces → sous-agent index-maker ; raisonnement d’un acte → sous-agent reasoning-maker, puis premise-maker pour les prémisses de son programme Catala ; question de droit → sous-agent research-maker. Lis leur compte rendu et la vérification qui le suit ; relance le sous-agent si une erreur subsiste. Sans sous-agent activé, fais-le toi-même avec le skill.';
const PREVIOUS_DELEGATION_LINE = '- Index des pièces → sous-agent index-maker ; raisonnement d’un acte → sous-agent reasoning-maker, puis premise-maker pour les prémisses de son programme Catala ; question de droit → sous-agent research-maker ; examen complet d’un point de droit dans la jurisprudence → sous-agent deep-research-maker. Lis leur compte rendu et la vérification qui le suit ; relance le sous-agent si une erreur subsiste. Sans sous-agent activé, fais-le toi-même avec le skill.';
const CATALA_DELEGATION_LINE = '- Index des pièces → sous-agent index-maker ; programme Catala d’un acte → sous-agent reasoning-maker, puis premise-maker pour ses prémisses ; question de droit → sous-agent research-maker ; examen complet d’un point de droit dans la jurisprudence → sous-agent deep-research-maker. Lis leur compte rendu et la vérification qui le suit ; relance le sous-agent si une erreur subsiste. Sans sous-agent activé, fais-le toi-même avec le skill.';
const MAKERS_DELEGATION_LINE = '- Index des pièces → sous-agent index-maker ; prémisses d’un programme Catala → sous-agent premise-maker ; question de droit → sous-agent research-maker ; examen complet d’un point de droit dans la jurisprudence → sous-agent deep-research-maker. Lis leur compte rendu et la vérification qui le suit ; relance le sous-agent si une erreur subsiste. Sans sous-agent activé, fais-le toi-même avec le skill.';
const DELEGATION_LINE = '- Question de droit → sous-agent research-maker. Lis son compte rendu et la vérification qui le suit ; relance-le si une erreur subsiste. Sans sous-agent activé, fais-le toi-même avec les outils MCP legifrance.';
const SKILL_PIECEMAKER_LINE = '- Pièces, index, chronologie, base du dossier, conversion, volets, bordereau, tabular review, échéances, raisonnement → skill piecemaker';
const FEATURE_REASONING_LINE = '- Pièces, index, chronologie, base du dossier, conversion, volets, bordereau, tabular review, échéances, raisonnement → outil Feature : quickstart, puis lis les pages qu’il indique';
const PIECEMAKER_LINE = '- Pièces, index, chronologie, base du dossier, conversion, volets, bordereau, tabular review, échéances → outil Feature : quickstart, puis lis les pages qu’il indique';
const TOOLS_RULE_LINES = [
  `${TOOLS_RULE_START} Avant d’agir, charge le skill qui correspond à la demande, puis suis-le.`,
  PIECEMAKER_LINE,
  '- Règle juridique en programme, calcul formel, preuve sur les exceptions → skill catala',
  '- Lire, modifier, annoter ou créer un fichier Word .docx → skill docx-cli',
  '- Rédiger ou relire un acte, un courrier, un document juridique → skill style-redaction-cabinet, puis docx-cli',
  '- Page à regarder ou à utiliser (synthèse visuelle, tableau de bord, suivi, présentation) → outil Artifact : quickstart, puis skill creation-artifacts',
  '- Instruction, gabarit ou skill personnels → skill ajout-de-fonctionnalites',
  '- Textes, jurisprudence, BODACC → outils MCP legifrance, sans skill',
  DELEGATION_LINE,
  HELP_LINE,
];
const DISCRETION_RULE = '7° Discrétion: L’utilisateur ne voit ni commandes ni fichiers techniques. Ne nomme jamais une commande, un outil, une requête, un chemin sous .piecemaker ni un message technique ; dis ce que tu as fait en termes métier (« le suivi est à jour », « le volet Raisonnement est ouvert »). Un échec se dit en clair, avec ce qu’il empêche. Sauf si l’utilisateur le demande.';
const RULE_UPDATES = new Map([
  [FOLDER_SUIVI_RULE, SUIVI_RULE],
  [FOLDER_MEMORY_RULE, MEMORY_RULE],
  ...OLD_SUIVI_RULES.map((rule): [string, string] => [rule, SUIVI_RULE]),
  [OLD_GENERAL_RULE, GENERAL_RULE],
  [OLD_MEMORY_RULE, MEMORY_RULE],
  [OLD_TREE_RULE, TREE_RULE],
  [OLD_DELEGATION_LINE, DELEGATION_LINE],
  [PREVIOUS_DELEGATION_LINE, DELEGATION_LINE],
  [CATALA_DELEGATION_LINE, DELEGATION_LINE],
  [MAKERS_DELEGATION_LINE, DELEGATION_LINE],
  [PREVIOUS_TREE_RULE, TREE_RULE],
  [REPLACE_TREE_RULE, TREE_RULE],
  [PROPOSE_TREE_RULE, TREE_RULE],
  [SKILL_SUIVI_RULE, SUIVI_RULE],
  [SKILL_MEMORY_RULE, MEMORY_RULE],
  [SKILL_TREE_RULE, TREE_RULE],
  [FILE_TREE_RULE, TREE_RULE],
  [SKILL_PIECEMAKER_LINE, PIECEMAKER_LINE],
  [FEATURE_REASONING_LINE, PIECEMAKER_LINE],
]);

export function agentInstructionsTemplate(): string {
  return [
  TEMPLATE_HEADER,
  '1° Anonymisation: Les entités sensibles sont pseudonymisées automatiquement à la lecture et dépseudonymisées à l’écriture. Conserve les pseudonymes fournis ; ne cherche pas à retrouver les identités réelles. Ne jamais ouvrir un dossier non anonymisé sans autorisation préalable',
  GENERAL_RULE,
  TREE_RULE,
  MEMORY_RULE,
  SUIVI_RULE,
  DISCRETION_RULE,
  ...TOOLS_RULE_LINES,
].join('\n');
}

const withToolsRule = (content: string) => {
  const lines = content.split(/\r?\n/);
  if (!lines.includes(TEMPLATE_HEADER) || lines.some((line) => line.startsWith(TOOLS_RULE_START))) return content;
  const lineEnd = content.includes('\r\n') ? '\r\n' : '\n';
  const rule = TOOLS_RULE_LINES.join(lineEnd);
  return content.endsWith('\n') ? content + rule + lineEnd : content + lineEnd + rule;
};

const withDelegationRule = (content: string) => {
  const lines = content.split('\n');
  const bare = lines.map((line) => line.replace(/\r$/, ''));
  const anchor = bare.indexOf(HELP_LINE);
  if (!bare.includes(TEMPLATE_HEADER) || bare.includes(DELEGATION_LINE) || anchor < 0) return content;
  lines.splice(anchor, 0, DELEGATION_LINE + (lines[anchor].endsWith('\r') ? '\r' : ''));
  return lines.join('\n');
};

const refreshRules = async (agentsPath: string) => {
  const content = await readFile(agentsPath, 'utf8');
  const next = withDelegationRule(withToolsRule(content.split('\n').map((line) => {
    const updated = RULE_UPDATES.get(line.replace(/\r$/, ''));
    const current = updated ?? line.replace(/\r$/, '');
    const ending = line.endsWith('\r') ? '\r' : '';
    return current === SUIVI_RULE && !content.includes(DISCRETION_RULE) ? `${current}${ending}\n${DISCRETION_RULE}${ending}` : updated ? updated + ending : line;
  }).join('\n')));
  if (next !== content) await writeFile(agentsPath, next);
};

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
  if (hasAgents) await refreshRules(agentsPath);
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
