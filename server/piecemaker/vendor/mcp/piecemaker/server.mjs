#!/usr/bin/env node
/**
 * Serveur MCP « piecemaker » — outil de conversion exposé
 * à Claude Code (et à tout client MCP) sans passer
 * par du texte injecté dans un CLAUDE.md.
 *
 * Chaque outil lance le binaire `piecemaker` en sous-processus plutôt que
 * d'importer les modules internes : c'est ce qui garantit l'absence de
 * dérive entre la commande shell documentée et l'outil MCP — même analyse
 * d'arguments, même localisation de dossier, une seule implémentation
 * (voir `installer/bin/piecemaker.mjs`).
 *
 * La commande lancée ici (`conversion --json`) court-circuite le bandeau, la
 * vérification de mise à jour et le menu interactif. Elle confie le travail au
 * serveur applicatif déjà lancé (application de bureau ou `piecemaker`) et ne
 * démarre un serveur que si aucun ne répond.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { runSql } from '../../installer/lib/conversion-client.mjs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/** Racine du dépôt, déduite de l'emplacement de ce fichier (mcp/piecemaker/). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLI_PATH = path.join(REPO_ROOT, 'installer', 'bin', 'piecemaker.mjs');

/**
 * Lance réellement le binaire `piecemaker` et capture sa sortie. Isolé dans
 * sa propre fonction pour rester injectable dans les tests — aucun test ne
 * doit dépendre de ce chemin d'exécution réel pour ses assertions.
 */
function spawnPiecemaker(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => {
      resolve({ code: 1, stdout, stderr: stderr || error.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

/**
 * Exécute une commande `piecemaker <args>` et rend `{ code, stdout, stderr }`.
 * `execFn` est injectable par les tests, pour ne jamais avoir à lancer un
 * vrai sous-processus.
 */
export function runPiecemakerCommand(args, { cwd = process.cwd(), execFn = spawnPiecemaker } = {}) {
  return execFn(args, cwd);
}

/**
 * Transforme le résultat du sous-processus en réponse d'outil MCP.
 *
 * Le CLI n'écrit pas toujours ses erreurs sur stderr (`log.error` écrit sur
 * stdout, voir `installer/lib/ui.mjs`) : on retient stderr s'il dit quelque
 * chose, sinon on retombe sur stdout, jamais sur un message vide. Sur succès,
 * stdout est renvoyé tel quel.
 */
export function toToolResult(result) {
  if (result.code !== 0) {
    const message = (result.stderr && result.stderr.trim())
      || (result.stdout && result.stdout.trim())
      || `Échec de la commande piecemaker (code de sortie ${result.code}).`;
    return { isError: true, content: [{ type: 'text', text: message }] };
  }
  return { content: [{ type: 'text', text: result.stdout }] };
}

// --- Construction des arguments, un constructeur pur par outil -----------
//
// Chaque fonction reproduit exactement une ligne du tableau du plan : même
// commande, mêmes options, dans le même ordre. `dossier` doit déjà être
// résolu (jamais undefined) par l'appelant — voir `resolveDossier` ci-dessous.

export function conversionArgs({ dossier, pieces, force }) {
  const args = ['conversion', '--json', '--case', dossier];
  for (const piece of pieces || []) args.push(piece);
  if (force) args.push('--force');
  return args;
}

/** Dossier ciblé par un appel d'outil : celui demandé, sinon la session en cours. */
export function resolveDossier(dossier) {
  return dossier && String(dossier).trim() ? dossier : process.cwd();
}

const DOSSIER_SCHEMA = z.string()
  .optional()
  .describe('Chemin absolu du dossier juridique ciblé. Par défaut, le répertoire de la session Claude Code en cours.');

const SQL_DESCRIPTION = [
  'SQL libre (SQLite) sur la base PieceMaker ; noms réels masqués.',
  "dossier() = dossier courant ; dossier('nom ou début d'id') = un autre.",
  "piecemaker_nodes(project_id, id, kind, label, doc_date, aliases_json, data_json) : kind 'document' = pièce (doc_date AAAA-MM-JJ ; data_json.nature, .localisation) ; sinon personne, société, coordonnée (data_json.partySide, .position, .legalForm).",
  "piecemaker_links(project_id, from_node_id, to_node_id, relation) : 'mentions' = la pièce cite l'entité.",
  'piecemaker_citations(project_id, from_node_id, to_node_id, relation, texte, piece_id, source) : extraits qui justifient un lien, autant que voulu ; source = pièce (piece_id) ou référence libre.',
  'Dates automatiques. Renommer une pièce = UPDATE de son label (AAAA-MM-JJ_titre).',
].join('\n');

/**
 * Construit le serveur MCP et y enregistre les outils. Séparé de
 * `main()` pour rester testable sans jamais brancher de transport stdio.
 */
export function createServer({ execFn, sqlFn = runSql } = {}) {
  const server = new McpServer({ name: 'piecemaker', version: '1.0.0' });
  const run = (args, dossier) => runPiecemakerCommand(args, { cwd: dossier, execFn });

  server.registerTool('conversion', {
    description: 'Convertit les pièces du dossier en Markdown ET les scanne pour détecter les données '
      + 'personnelles (GLiNER), en une seule passe — les deux ne sont pas séparables. Opération longue : '
      + 'plusieurs minutes selon le nombre et la taille des pièces. Un seul scan PieceMaker tourne à la fois, '
      + 'tous dossiers confondus ; si un autre est déjà en cours, cet outil échoue au lieu d\'attendre.',
    inputSchema: {
      dossier: DOSSIER_SCHEMA,
      pieces: z.array(z.string()).optional()
        .describe('Noms ou chemins relatifs des pièces à convertir. Par défaut, toutes les pièces pas encore prêtes.'),
      force: z.boolean().optional().describe('Reconvertit et rescanne même les pièces déjà prêtes.'),
    },
    annotations: {
      title: 'Conversion et pseudonymisation des pièces',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ dossier, pieces, force }) => {
    const resolved = resolveDossier(dossier);
    const result = await run(conversionArgs({ dossier: resolved, pieces, force }), resolved);
    return toToolResult(result);
  });

  server.registerTool('sql', {
    description: SQL_DESCRIPTION,
    inputSchema: {
      requete: z.string(),
    },
    annotations: {
      title: 'SQL sur la base PieceMaker',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, async ({ requete }) => {
    try {
      const resultat = await sqlFn({ requete, cwd: process.cwd() });
      return { content: [{ type: 'text', text: resultat }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

const isMainModule = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMainModule) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
