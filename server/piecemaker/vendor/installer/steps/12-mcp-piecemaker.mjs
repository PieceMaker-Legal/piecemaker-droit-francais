/**
 * Étape 12 — retire le serveur MCP « piecemaker » de Claude Code
 * (portée user). Les outils du dossier passent par le skill
 * Skill-PieceMaker (`scripts/pm`).
 */

import { log } from '../lib/ui.mjs';
import { commandExists, run, runCapture } from '../lib/platform.mjs';

export const meta = {
  id: '12-mcp-piecemaker',
  label: 'Retrait MCP piecemaker',
  description: 'Retire de Claude Code le serveur MCP piecemaker, remplacé par le skill Skill-PieceMaker',
};

const SERVER_NAME = 'piecemaker';

function dependencies(overrides = {}) {
  return {
    commandExists,
    runCapture,
    run,
    log,
    ...overrides,
  };
}

function existingRegistration(ops) {
  const result = ops.runCapture('claude', ['mcp', 'get', SERVER_NAME]);
  return { present: result.code === 0 };
}

export async function install(ctx, overrides = {}) {
  const ops = dependencies(overrides);
  if (!ops.commandExists('claude', ['--version'])) {
    return {
      status: 'skipped',
      note: 'CLI "claude" introuvable — rien à retirer.',
    };
  }

  const existing = existingRegistration(ops);
  if (!existing.present) {
    ops.log.ok(`Serveur MCP « ${SERVER_NAME} » déjà absent de Claude Code.`);
    return { status: 'done', note: '' };
  }

  if (ctx.dryRun) {
    ops.log.info(`[simulation] retrait du serveur MCP « ${SERVER_NAME} »`);
    return { status: 'skipped', note: 'Mode simulation — aucune modification effectuée.' };
  }

  const removed = await ops.run('claude', ['mcp', 'remove', SERVER_NAME, '-s', 'user']);
  if (removed !== 0) {
    return {
      status: 'failed',
      note: `Impossible de retirer le serveur MCP. À la main : claude mcp remove ${SERVER_NAME} -s user`,
    };
  }
  ops.log.ok(`Serveur MCP « ${SERVER_NAME} » retiré (skill Skill-PieceMaker).`);
  return { status: 'done', note: '' };
}

export async function check(_ctx, overrides = {}) {
  const ops = dependencies(overrides);
  if (!ops.commandExists('claude', ['--version'])) {
    return { status: 'skipped', note: 'CLI "claude" introuvable.' };
  }
  const existing = existingRegistration(ops);
  if (existing.present) {
    return { status: 'failed', note: `Serveur MCP « ${SERVER_NAME} » encore enregistré dans Claude Code.` };
  }
  return { status: 'done', note: '' };
}
