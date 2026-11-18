#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readHookPayload } from './lib/hook-io.mjs';

const TOOLS = { read_file: 'Read', write_file: 'Write', edit: 'Edit', search_replace: 'Edit', grep: 'Grep', task: 'Task', 'subagent.spawn': 'Task', 'process.start': 'Bash' };

export function claudeToolName(name) {
  const tool = String(name || '').replace(/^file_system\./, '');
  if (TOOLS[tool]) return TOOLS[tool];
  if (/bash$|^windows_shell$/.test(tool)) return 'Bash';
  const mcp = /^(?:mcp_)?([^.]*legifrance[^._]*)[._](.+)$/i.exec(tool);
  return mcp ? `mcp__${mcp[1]}__${mcp[2]}` : tool;
}

function claudeInput(tool, input) {
  if (tool !== 'Task') return input;
  return { subagent_type: input.agentType ?? input.agent, prompt: input.message ?? input.task };
}

export function vibeAgent(payload) {
  if (!payload?.parent_session_id || !payload.transcript_path) return '';
  let directory = path.dirname(path.dirname(payload.transcript_path));
  for (let depth = 0; depth < 4; depth++) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(directory, 'meta.json'), 'utf8'));
      const link = (meta.child_sessions || []).find((child) => child?.session_id === payload.session_id);
      if (link) return String(link.agent || '');
    } catch {}
    directory = path.dirname(directory);
  }
  return '';
}

export function claudePayload(payload) {
  const tool = claudeToolName(payload.tool_name);
  const input = payload.tool_input || {};
  const post = payload.hook_event_name === 'post_tool';
  return {
    hook_event_name: payload.hook_event_name === 'post_agent' ? 'Stop' : post ? 'PostToolUse' : 'PreToolUse',
    session_id: payload.session_id,
    transcript_path: payload.transcript_path,
    cwd: payload.cwd,
    tool_name: tool,
    tool_input: claudeInput(tool, input),
    agent_type: vibeAgent(payload),
    ...(post ? { tool_response: payload.tool_status === 'success' ? (payload.tool_output ?? payload.tool_output_text) : { success: false, error: payload.tool_error } } : {}),
  };
}

export function vibeResponse(stdout, code, stderr) {
  if (code === 2) return { decision: 'deny', reason: String(stderr || '').trim() || 'Refusé par PieceMaker.' };
  let output;
  try { output = JSON.parse(stdout); } catch { return null; }
  if (output?.decision === 'block') return { decision: 'deny', reason: output.reason || '' };
  const specific = output?.hookSpecificOutput || {};
  if (specific.permissionDecision === 'deny') return { decision: 'deny', reason: specific.permissionDecisionReason || output.systemMessage || '' };
  if (specific.updatedInput) return { hook_specific_output: { tool_input: specific.updatedInput } };
  if (specific.additionalContext) return { hook_specific_output: { additional_context: specific.additionalContext } };
  return null;
}

export function runScript(script, payload, env = process.env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], { cwd: payload.cwd || process.cwd(), env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => resolve({ stdout: '', code: 1, stderr: error.message }));
    child.on('close', (code) => resolve({ stdout, code, stderr }));
    child.stdin.end(JSON.stringify(claudePayload(payload)));
  });
}

export async function vibeDecision(script, payload, env) {
  if (!payload) return null;
  const { stdout, code, stderr } = await runScript(script, payload, env);
  return vibeResponse(stdout, code, stderr);
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const decision = await vibeDecision(path.resolve(process.argv[2] || ''), await readHookPayload(3000));
  if (decision) process.stdout.write(JSON.stringify(decision));
}
