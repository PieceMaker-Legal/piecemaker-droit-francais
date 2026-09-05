'use strict';

/**
 * Routes de l'activation par dossier (MCP, plugins, bibliothèque de skills
 * et d'agents). `repoRoot`, `piecemakerHome` et `userHome` sont injectés par
 * `router.cjs`, à l'image de `protection/routes.cjs`.
 */
const { ActivationError } = require('./errors.cjs');
const { resolveWorkspacePath } = require('./paths.cjs');
const { toggleClaudeMcp } = require('./claude-mcp.cjs');
const { toggleClaudePlugin } = require('./claude-plugins.cjs');
const { toggleCodexMcp } = require('./codex-mcp.cjs');
const { buildActivationSnapshot } = require('./snapshot.cjs');
const { installLibraryComponent, adoptGlobalComponent } = require('./library.cjs');

function respondError(response, error) {
  const status = error instanceof ActivationError ? error.status : 400;
  response.status(status).json({ error: error.message || 'Requête invalide.' });
}

function toggleMcpOrPlugin({ workspacePath, userHome, assistant, family, id, enabled }) {
  if (typeof id !== 'string' || !id) throw new ActivationError(400, '« id » est requis.');
  if (assistant === 'claude' && family === 'mcp') return toggleClaudeMcp(workspacePath, userHome, id, enabled);
  if (assistant === 'claude' && family === 'plugin') return toggleClaudePlugin(workspacePath, userHome, id, enabled);
  if (assistant === 'codex' && family === 'mcp') return toggleCodexMcp(workspacePath, userHome, id, enabled);
  throw new ActivationError(400, 'Combinaison « assistant »/« family » invalide pour cette route.');
}

function createActivationRouter({ repoRoot, piecemakerHome, userHome }) {
  const express = require('express');
  const router = express.Router();

  router.get('/activation', (request, response) => {
    try {
      const workspacePath = resolveWorkspacePath(request.query.workspacePath);
      response.json(buildActivationSnapshot(workspacePath, { repoRoot, piecemakerHome, userHome }));
    } catch (error) {
      respondError(response, error);
    }
  });

  router.post('/activation/toggle', (request, response) => {
    try {
      const workspacePath = resolveWorkspacePath(request.body?.workspacePath);
      const { assistant, family, id, enabled } = request.body || {};
      if (assistant !== 'claude' && assistant !== 'codex') {
        throw new ActivationError(400, '« assistant » doit valoir « claude » ou « codex ».');
      }
      if (family !== 'mcp' && family !== 'plugin') {
        throw new ActivationError(400, 'Cette route ne gère que « mcp » et « plugin » ; utilisez « /activation/library » pour les skills et agents.');
      }
      if (typeof enabled !== 'boolean') {
        throw new ActivationError(400, '« enabled » doit être un booléen.');
      }
      const item = toggleMcpOrPlugin({ workspacePath, userHome, assistant, family, id, enabled });
      response.json({ ok: true, item });
    } catch (error) {
      respondError(response, error);
    }
  });

  router.post('/activation/library', (request, response) => {
    try {
      const workspacePath = resolveWorkspacePath(request.body?.workspacePath);
      const { assistant, family, id, installed } = request.body || {};
      if (assistant !== 'claude' && assistant !== 'codex') {
        throw new ActivationError(400, '« assistant » doit valoir « claude » ou « codex ».');
      }
      if (family !== 'skill' && family !== 'agent') {
        throw new ActivationError(400, '« family » doit valoir « skill » ou « agent ».');
      }
      if (typeof installed !== 'boolean') {
        throw new ActivationError(400, '« installed » doit être un booléen.');
      }
      const item = installLibraryComponent({ workspacePath, assistant, family, id, installed, repoRoot, piecemakerHome, userHome });
      response.json({ ok: true, item });
    } catch (error) {
      respondError(response, error);
    }
  });

  router.post('/activation/library/adopt', (request, response) => {
    try {
      const { assistant, family, id } = request.body || {};
      if (assistant !== 'claude' && assistant !== 'codex') {
        throw new ActivationError(400, '« assistant » doit valoir « claude » ou « codex ».');
      }
      if (family !== 'skill' && family !== 'agent') {
        throw new ActivationError(400, '« family » doit valoir « skill » ou « agent ».');
      }
      const result = adoptGlobalComponent({ assistant, family, id, userHome, piecemakerHome });
      response.json({ ok: true, ...result });
    } catch (error) {
      respondError(response, error);
    }
  });

  return router;
}

module.exports = { createActivationRouter };
