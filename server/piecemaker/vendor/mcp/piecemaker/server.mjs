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
import fs from 'node:fs';
import { runSql, runTabularReview } from '../../installer/lib/conversion-client.mjs';
import { CASSATION_MATIERES, chronologieSql, COLUMN_FORMATS, PREMIERE_INSTANCE_TYPES, RESEARCH_SOURCES, REVIEW_FOLDER, reviewFile, VOLETS } from './volets.mjs';
import { describeOpenPanels, openPanelsFile, waitForOpenPanel } from './volets-ouverts.mjs';
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
export function createServer({ execFn, sqlFn = runSql, tabularFn = runTabularReview, openPanelsPath = openPanelsFile(), openPanelsTimeoutMs = 8000 } = {}) {
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

  server.registerTool('afficher', {
    description: 'Affiche à l’avocat, dans un volet de PieceMaker à côté du chat, un fichier du dossier '
      + '(fichier), la vue générale ou la chronologie du dossier, ou une tabular review. '
      + 'Sans effet hors de l’application PieceMaker.',
    inputSchema: {
      fichier: z.string().optional().describe('Chemin du fichier, relatif au dossier ou absolu.'),
      volet: z.enum(VOLETS).optional().describe('Volet à ouvrir quand aucun fichier n’est donné.'),
      review: z.string().optional().describe('Avec volet tabular-review : fichier JSON de la review (tabular_review, action lister).'),
    },
    annotations: {
      title: 'Afficher dans un volet PieceMaker',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async ({ fichier, volet, review }) => {
    if (fichier) {
      const resolved = path.resolve(process.cwd(), fichier);
      if (!fs.existsSync(resolved)) return { isError: true, content: [{ type: 'text', text: `Fichier introuvable : ${fichier}` }] };
      const opened = await waitForOpenPanel({ cwd: process.cwd(), tab: 'files', document: resolved }, openPanelsPath, openPanelsTimeoutMs);
      if (!opened) return { isError: true, content: [{ type: 'text', text: 'Le fichier n’a pas été ouvert dans PieceMaker.' }] };
      return { content: [{ type: 'text', text: `Affiché dans le volet de lecture : ${fichier}` }] };
    }
    if (!volet) return { isError: true, content: [{ type: 'text', text: 'Indiquez un fichier ou un volet.' }] };
    const target = volet === 'tabular-review'
      ? { tab: 'plugin:piecemaker-tabular-review', review: review ? path.basename(review) : undefined }
      : { tab: 'plugin:piecemaker-dossier', view: volet === 'chronologie' ? 'chronology' : 'general' };
    const opened = await waitForOpenPanel({ cwd: process.cwd(), ...target }, openPanelsPath, openPanelsTimeoutMs);
    if (!opened) return { isError: true, content: [{ type: 'text', text: `Le volet ${volet} n’a pas été ouvert dans PieceMaker.` }] };
    return { content: [{ type: 'text', text: `Volet affiché : ${volet}${review ? ` (${path.basename(review)})` : ''}` }] };
  });

  server.registerTool('chronologie', {
    description: 'Chronologie des pièces du dossier, affichée à l’avocat dans le volet Dossier. '
      + 'lister : id, date, libellé et nature de chaque pièce, par date. '
      + 'modifier : change la date (AAAA-MM-JJ, vide pour l’effacer) ou le libellé d’une pièce ; '
      + 'changer le libellé (AAAA-MM-JJ_titre) renomme aussi le fichier.',
    inputSchema: {
      action: z.enum(['lister', 'modifier']),
      dossier: z.string().optional().describe('Nom ou début d’id d’un autre dossier. Par défaut, le dossier de la session.'),
      piece: z.string().optional().describe('Id de la pièce à modifier (colonne id de lister).'),
      date: z.string().optional(),
      libelle: z.string().optional(),
    },
    annotations: {
      title: 'Chronologie du dossier',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async (input) => {
    try {
      const resultat = await sqlFn({ requete: chronologieSql(input), cwd: process.cwd() });
      return { content: [{ type: 'text', text: resultat }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });

  server.registerTool('tabular_review', {
    description: 'Tabular reviews du dossier, affichées à l’avocat dans le volet Tabular Review. '
      + 'lister : analyses et projets non lancés. '
      + `ouvrir : affiche une analyse (fichier ; contenu dans « ${REVIEW_FOLDER}/<fichier> ») ou un projet. `
      + 'documents : documents analysables. modeles : liste, ou questions d’un modele. enregistrer_modele : crée, ou modifie modele. '
      + 'preparer : crée ou complète (projet) un projet, que l’avocat vérifie et lance. '
      + 'lancer : seulement sur accord explicite de l’avocat dans le chat.',
    inputSchema: {
      action: z.enum(['lister', 'ouvrir', 'documents', 'modeles', 'enregistrer_modele', 'preparer', 'lancer']),
      dossier: DOSSIER_SCHEMA,
      fichier: z.string().optional(),
      projet: z.string().optional().describe('Id d’un projet non lancé.'),
      mode: z.enum(['analyse', 'recherche']).optional().describe('analyse : documents du dossier ; recherche : décisions Légifrance et Judilibre.'),
      nom: z.string().optional(),
      modele: z.string().optional().describe('Id ou nom d’un modèle.'),
      description: z.string().optional(),
      questions: z.array(z.object({
        nom: z.string().optional(),
        consigne: z.string(),
        format: z.enum(COLUMN_FORMATS).optional(),
        etiquettes: z.array(z.string()).optional(),
      })).optional().describe('Avec modele dans preparer : ajoutées à ses questions.'),
      documents: z.array(z.string()).optional().describe('Chemins relatifs de documents ou de dossiers (tous leurs documents).'),
      recherche: z.object({
        query: z.string(),
        sources: z.array(z.enum(RESEARCH_SOURCES)),
        matieres: z.array(z.enum(CASSATION_MATIERES)).describe('Obligatoire pour cassation.'),
        publicationBulletin: z.enum(['TOUS', 'PUBLIE', 'INEDIT']),
        sieges: z.array(z.string()).describe('Cours d’appel : PARIS, VERSAILLES, AIX-PROVENCE…'),
        publicationConseilEtat: z.enum(['TOUS', 'PUBLIE', 'NON_PUBLIE']),
        villesCaa: z.array(z.string()),
        publicationCaa: z.enum(['TOUS', 'PUBLIE', 'NON_PUBLIE']),
        typesPremiereInstance: z.array(z.enum(PREMIERE_INSTANCE_TYPES)).describe('Obligatoire pour premiere_instance.'),
        dateDebut: z.string().describe('AAAA-MM-JJ'),
        dateFin: z.string().describe('AAAA-MM-JJ'),
        dispositifOnly: z.boolean(),
      }).partial().optional(),
      ia: z.enum(['claude', 'codex', 'mistral']).optional(),
      modele_ia: z.string().optional(),
    },
    annotations: {
      title: 'Tabular Review',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  }, async ({ action, dossier, fichier, ...input }) => {
    const resolved = path.resolve(resolveDossier(dossier));
    try {
      if (action === 'ouvrir') {
        const name = input.projet ? undefined : reviewFile(resolved, fichier);
        const opened = await waitForOpenPanel({
          cwd: resolved,
          tab: 'plugin:piecemaker-tabular-review',
          review: name,
        }, openPanelsPath, openPanelsTimeoutMs);
        if (!opened) return { isError: true, content: [{ type: 'text', text: 'Le volet Tabular Review n’a pas été ouvert dans PieceMaker.' }] };
        if (input.projet) return { content: [{ type: 'text', text: `Projet affiché dans le volet Tabular Review : ${input.projet}` }] };
        return { content: [{ type: 'text', text: `Analyse affichée dans le volet Tabular Review. Contenu : « ${REVIEW_FOLDER}/${name} ».` }] };
      }
      const result = await tabularFn({ ...input, action, project: resolved });
      return { content: [{ type: 'text', text: Array.isArray(result) && action === 'documents' ? result.join('\n') : JSON.stringify(result) }] };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] };
    }
  });

  server.registerTool('volets_ouverts', {
    description: 'Volets de PieceMaker ouverts par l’avocat à côté du chat : outils (Fichiers, Dossier et sa chronologie, '
      + 'Analyse tabulaire et le tableau affiché, Bibliothèque, Bordereau…), document affiché et dernier volet ouvert. '
      + 'À appeler quand l’avocat parle de « ce tableau », « ce document », « ici » sans préciser.',
    inputSchema: {},
    annotations: {
      title: 'Volets ouverts',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  }, async () => ({ content: [{ type: 'text', text: describeOpenPanels() }] }));

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
