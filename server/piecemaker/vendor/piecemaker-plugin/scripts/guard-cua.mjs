#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';

const CUA_TOOL = /^(mcp__cua_repl__)?js(_reset)?$/;

export function cuaDecision(payload) {
  if (!payload || !CUA_TOOL.test(String(payload.tool_name || ''))) return null;
  const reason = 'Lecture et pilotage de l’écran (cua_repl) sont interdits : ils gonflent le contexte avec l’arbre '
    + 'd’accessibilité complet de l’application. Vérifiez l’interface par les outils texte (fichiers du dossier, '
    + 'journaux, MCP PieceMaker) et ne manipulez jamais la fenêtre de l’avocat.';
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    systemMessage: reason,
  };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) runHook(async () => cuaDecision(await readHookPayload(3000)), { timeoutMs: 5000 }).catch(() => noop());
