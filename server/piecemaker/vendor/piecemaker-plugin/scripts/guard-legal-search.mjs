#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { noop, readHookPayload, runHook } from './lib/hook-io.mjs';

const SEARCH_TOOL = /^mcp__.*legifrance.*__Search_/;
const AGENT_FILES = [path.join('.claude', 'agents', 'research-maker.md'), path.join('.codex', 'agents', 'research-maker.toml'), path.join('.vibe', 'agents', 'research-maker.toml')];
const RESEARCH_AGENT = /(^|:)research-maker$/;

function researchMakerInstalled(cwd, home) {
  return [home, cwd].filter(Boolean).some((root) => AGENT_FILES.some((file) => fs.existsSync(path.join(root, file))));
}

export function searchDecision(payload, { home = os.homedir() } = {}) {
  if (!payload || !SEARCH_TOOL.test(String(payload.tool_name || ''))) return null;
  if (RESEARCH_AGENT.test(String(payload.agent_type || ''))) return null;
  if (!researchMakerInstalled(payload.cwd, home)) return null;
  const reason = 'Recherche Légifrance réservée au sous-agent research-maker ; pour examiner tout un point de droit, '
    + 'préparez une tabular review en mode recherche (Feature quickstart intent=review). Déléguez la question, '
    + 'puis relisez chaque source qu’il cite avec consulter_article ou consulter_decision. (essai carte)';
  return {
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
    systemMessage: reason,
  };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) runHook(async () => searchDecision(await readHookPayload(3000)), { timeoutMs: 5000 }).catch(() => noop());
