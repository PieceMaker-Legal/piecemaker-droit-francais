'use strict';

/**
 * Assemble la réponse de `GET /activation` : MCP et plugins par dossier
 * (inchangés depuis la première version de cette fonctionnalité), plus la
 * bibliothèque de skills/agents et les composants globaux encore à migrer.
 * Ne migre jamais rien lui-même — `adoptGlobalComponent` est un geste
 * explicite de l'utilisateur, jamais une conséquence d'une lecture.
 */
const { listClaudeMcp } = require('./claude-mcp.cjs');
const { listClaudePlugins } = require('./claude-plugins.cjs');
const { listCodexMcp } = require('./codex-mcp.cjs');
const { buildLibrary, listGlobalLeftovers } = require('./library.cjs');

function buildActivationSnapshot(workspacePath, { repoRoot, piecemakerHome, userHome }) {
  return {
    workspacePath,
    claude: {
      mcp: listClaudeMcp(workspacePath, userHome),
      plugins: listClaudePlugins(workspacePath, userHome),
    },
    codex: {
      mcp: listCodexMcp(workspacePath, userHome),
    },
    library: buildLibrary(workspacePath, { repoRoot, piecemakerHome, userHome }),
    globalLeftovers: listGlobalLeftovers(userHome),
  };
}

module.exports = { buildActivationSnapshot };
