#!/usr/bin/env node
/**
 * Serveur MCP « piecemaker » — conversion des pièces et fiches du dossier
 * (personnes, sociétés…) exposées à Claude Code, Codex et Mistral Vibe (et à
 * tout client MCP) sans passer par du texte injecté dans un CLAUDE.md.
 *
 * Chaque outil lance le binaire `piecemaker` en sous-processus plutôt que
 * d'importer les modules internes : c'est ce qui garantit l'absence de
 * dérive entre la commande shell documentée et l'outil MCP — même analyse
 * d'arguments, même localisation de dossier, une seule implémentation
 * (voir `installer/bin/piecemaker.mjs`).
 *
 * Les commandes lancées ici (`conversion --json`, `personne --json`) court-circuitent le bandeau, la
 * vérification de mise à jour et le menu interactif. Elle confie le travail au
 * serveur applicatif déjà lancé (application de bureau ou `piecemaker`) et ne
 * démarre un serveur que si aucun ne répond.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
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

export function rechercherPersonneArgs({ dossier, recherche, type, limite }) {
  const args = ['personne', '--json', '--case', dossier];
  if (type) args.push('--type', type);
  if (limite) args.push('--limite', String(limite));
  if (recherche && String(recherche).trim()) args.push(String(recherche).trim());
  return args;
}

export function modifierPersonneArgs({ dossier, personne, champs }) {
  return ['personne', '--json', '--case', dossier, String(personne).trim(), '--champs', JSON.stringify(champs)];
}

/** Dossier ciblé par un appel d'outil : celui demandé, sinon la session en cours. */
export function resolveDossier(dossier) {
  return dossier && String(dossier).trim() ? dossier : process.cwd();
}

const DOSSIER_SCHEMA = z.string()
  .optional()
  .describe('Chemin absolu du dossier juridique ciblé. Par défaut, le répertoire de la session en cours.');

/** Types de fiches consultables ; les pièces (`document`) n'en font pas partie. */
const ENTITY_KINDS = ['person', 'company', 'address', 'iban', 'phone', 'email', 'url', 'siren', 'other'];

/**
 * Construit le serveur MCP et y enregistre les outils. Séparé de
 * `main()` pour rester testable sans jamais brancher de transport stdio.
 */
export function createServer({ execFn } = {}) {
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

  server.registerTool('rechercher_personne', {
    description: 'Cherche une personne du dossier — physique ou morale — ou une autre fiche (adresse, IBAN, '
      + 'téléphone, e-mail, SIREN…) par nom, variante ou code de pseudonymisation, et rend sa fiche complète : '
      + 'tous les champs enregistrés, les variantes du nom et les fiches liées (société dirigée, SIREN…). '
      + 'Sans recherche, liste les fiches du dossier. Les pièces qui la mentionnent ne sont pas incluses.',
    inputSchema: {
      dossier: DOSSIER_SCHEMA,
      recherche: z.string().optional()
        .describe('Nom, variante ou code (ex. « CLIENT_DEMANDEUR_PERSONNE_PHYSIQUE_01 »). Vide : toutes les fiches.'),
      type: z.enum(ENTITY_KINDS).optional()
        .describe('Limite la recherche à un type : person (personne physique), company (personne morale), address, iban, phone, email, url, siren, other.'),
      limite: z.number().int().min(1).max(50).optional().describe('Nombre maximal de fiches rendues (20 par défaut).'),
    },
    annotations: {
      title: 'Fiche d\'une personne du dossier',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ dossier, recherche, type, limite }) => {
    const resolved = resolveDossier(dossier);
    const result = await run(rechercherPersonneArgs({ dossier: resolved, recherche, type, limite }), resolved);
    return toToolResult(result);
  });

  server.registerTool('modifier_personne', {
    description: 'Ajoute ou modifie des champs de la fiche d\'une personne (ou d\'une autre fiche) du dossier : '
      + 'profession, date de naissance, qualité, coordonnées… Les champs non cités sont conservés. La fiche est '
      + 'désignée par son code de pseudonymisation ou par un nom exact ; un nom partagé par plusieurs fiches est '
      + 'refusé. Les champs code, originalCode, category, partySide, position, legalForm et systemRole '
      + 'déterminent le code de pseudonymisation : ils se modifient dans l\'onglet Dossier.',
    inputSchema: {
      dossier: DOSSIER_SCHEMA,
      personne: z.string().min(1).describe('Code de pseudonymisation (de préférence) ou nom exact de la fiche.'),
      champs: z.record(z.string(), z.any())
        .describe('Champs à ajouter ou remplacer, ex. { "profession": "Médecin", "dateNaissance": "1970-01-02" }. Aucune valeur null.'),
    },
    annotations: {
      title: 'Compléter la fiche d\'une personne du dossier',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ dossier, personne, champs }) => {
    const resolved = resolveDossier(dossier);
    const result = await run(modifierPersonneArgs({ dossier: resolved, personne, champs }), resolved);
    return toToolResult(result);
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
