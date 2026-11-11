#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';

const SEARCH_TOOL = /^mcp__.*legifrance.*__Search_/;
const AGENT_FILE = path.join('.claude', 'agents', 'research-maker.md');

function researchMakerInstalled(cwd, home) {
  return [home, cwd].filter(Boolean).some((root) => fs.existsSync(path.join(root, AGENT_FILE)));
}

export function searchDecision(payload, { home = os.homedir() } = {}) {
  if (!payload || !SEARCH_TOOL.test(String(payload.tool_name || ''))) return null;
  if (payload.agent_id || payload.agent_type) return null;
  if (!researchMakerInstalled(payload.cwd, home)) return null;
  const reason = 'Recherche Légifrance réservée au sous-agent research-maker. Déléguez-lui la question, '
    + 'puis relisez chaque source qu’il cite avec consulter_article ou consulter_decision.';
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    systemMessage: reason,
  };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) runHook(async () => searchDecision(await readHookPayload(3000)), { timeoutMs: 5000 }).catch(() => noop());
