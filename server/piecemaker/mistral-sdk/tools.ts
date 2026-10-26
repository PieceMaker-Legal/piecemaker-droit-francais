import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Tool } from '@mistralai/mistralai/models/components';

import { providerSkillsService } from '@/modules/providers/index.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { readJson, readToml } from '../library/provider-connectors.js';
import { normalizeProviderConnector } from '../library/connector-installation.js';

export async function createMistralTools(cwd: string, disabledSkills: unknown, signal: AbortSignal, userHome = os.homedir()) {
  const clients: Client[] = [];
  const tools = new Map<string, { name: string; definition: Tool; readOnly: boolean; execute(input: Record<string, unknown>): Promise<string> }>();
  const failures: string[] = [];
  const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));
  const guardScripts = [
    'server/piecemaker/vendor/piecemaker-plugin/scripts/protect-originals.mjs',
    'server/piecemaker/vendor/installer/assets/claude-hooks/piecemaker-guard-secrets.mjs',
  ].map(file => path.join(applicationRoot, file));

  const run = (command: string, args: string[], input?: string, shell = false) => new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env }, shell, signal, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    let error = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 2000000) child.kill('SIGTERM'); });
    child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-20000); });
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(error || `Commande arrêtée (${code}).`));
      else resolve(output);
    });
    child.stdin.end(input);
  });

  const guard = async (toolName: string, input: Record<string, unknown>) => {
    for (const script of guardScripts) {
      const result = await run(process.execPath, [script], JSON.stringify({ tool_name: toolName, tool_input: input, cwd }));
      if (!result.trim()) continue;
      const decision = JSON.parse(result).hookSpecificOutput;
      if (decision?.permissionDecision === 'deny') throw new Error(decision.permissionDecisionReason || 'Accès refusé par la protection PieceMaker.');
    }
  };

  const add = (name: string, description: string, properties: Record<string, unknown>, required: string[], readOnly: boolean, execute: (input: Record<string, unknown>) => Promise<string>) => {
    tools.set(name, { name, readOnly, execute, definition: { type: 'function', function: {
      name, description, parameters: { type: 'object', properties, required, additionalProperties: false },
    } } });
  };
  const text = (input: Record<string, unknown>, key: string) => {
    if (typeof input[key] !== 'string') throw new Error(`Paramètre requis : ${key}`);
    return input[key] as string;
  };
  const target = async (input: Record<string, unknown>) => {
    const file = path.resolve(cwd, text(input, 'file_path').replace(/^~(?=$|[/\\])/, userHome));
    const canonical = await fs.realpath(file).catch(() => file);
    const database = process.env.DATABASE_PATH;
    if ((database && canonical.startsWith(database)) || /(?:^|[\\/])(?:auth\.json|credentials\.json|auth\.db)(?:$|-)/i.test(canonical)) {
      throw new Error('Les identifiants de connexion ne sont pas accessibles à l’agent.');
    }
    return file;
  };
  const string = { type: 'string' };
  add('Read', 'Lire un fichier texte. Les pièces originales protégées et secrets sont refusés.', { file_path: string }, ['file_path'], true, async input => {
    const file = await target(input);
    await guard('Read', { file_path: file });
    const info = await fs.stat(file);
    if (info.size > 1000000) throw new Error('Fichier trop volumineux : utilisez Bash pour une lecture ciblée.');
    return fs.readFile(file, 'utf8');
  });
  add('Write', 'Écrire un fichier texte complet.', { file_path: string, content: string }, ['file_path', 'content'], false, async input => {
    const file = await target(input);
    await guard('Read', { file_path: file });
    await guard('Write', { ...input, file_path: file });
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text(input, 'content'), 'utf8');
    return 'Fichier enregistré.';
  });
  add('Edit', 'Remplacer un texte présent une seule fois dans un fichier.', { file_path: string, old_string: string, new_string: string }, ['file_path', 'old_string', 'new_string'], false, async input => {
    const file = await target(input);
    await guard('Read', { file_path: file });
    await guard('Edit', { ...input, file_path: file });
    const content = await fs.readFile(file, 'utf8');
    const old = text(input, 'old_string');
    if (!old || content.split(old).length !== 2) throw new Error('Le texte à remplacer doit être présent une seule fois.');
    await fs.writeFile(file, content.replace(old, () => text(input, 'new_string')), 'utf8');
    return 'Modification enregistrée.';
  });
  add('Bash', 'Exécuter une commande dans le dossier courant (shell Windows ou Unix selon le poste).', { command: string }, ['command'], false, async input => {
    const command = text(input, 'command');
    await guard('Bash', { command });
    return run(command, [], undefined, true);
  });

  const disabled = new Set(Array.isArray(disabledSkills) ? disabledSkills.map(item => String(item?.name).toLowerCase()) : []);
  const skills = (await providerSkillsService.listProviderSkills('mistral', { workspacePath: cwd }))
    .filter(skill => !disabled.has(skill.name.toLowerCase()));
  if (skills.length) add('skill', 'Charger les instructions complètes d’un skill disponible. Suivre ses instructions et résoudre ses fichiers relatifs depuis son dossier.', {
    name: { type: 'string', enum: skills.map(skill => skill.name) },
  }, ['name'], true, async input => {
    const skill = skills.find(item => item.name === text(input, 'name'));
    if (!skill) throw new Error('Skill indisponible dans ce dossier.');
    await guard('Read', { file_path: skill.sourcePath });
    return `Dossier du skill : ${path.dirname(skill.sourcePath)}\n\n${await fs.readFile(skill.sourcePath, 'utf8')}`;
  });

  const configs = new Map<string, Record<string, unknown>>();
  for (const directory of [path.join(userHome, '.vibe'), path.join(cwd, '.vibe')]) {
    const config = readToml(path.join(directory, 'config.toml'));
    for (const server of Array.isArray(config.mcp_servers) ? config.mcp_servers : []) {
      if (server && typeof server.name === 'string') configs.set(server.name, server);
    }
  }
  for (const [name, server] of Object.entries(readJson(path.join(cwd, '.mcp.json')).mcpServers ?? {})) {
    if (!configs.has(name) && server && typeof server === 'object') configs.set(name, server as Record<string, unknown>);
  }
  const settings = { ...readJson(path.join(cwd, '.claude', 'settings.json')), ...readJson(path.join(cwd, '.claude', 'settings.local.json')) };
  const disabledServers = new Set(Array.isArray(settings.disabledMcpServers) ? settings.disabledMcpServers : []);
  try {
    for (const [name, raw] of configs) {
      signal.throwIfAborted();
      if (raw.enabled === false || raw.disabled === true || disabledServers.has(name)) continue;
      const config = normalizeProviderConnector(raw);
      if (!config) { failures.push(`${name} : configuration invalide`); continue; }
      let client = new Client({ name: 'piecemaker-mistral-sdk', version: '1.0.0' });
      clients.push(client);
      try {
        if (config.transport === 'stdio') {
          await client.connect(new StdioClientTransport({
            command: config.command!, args: config.args, cwd,
            env: { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), ...config.env },
            stderr: 'ignore',
          }), { timeout: 15000, signal });
        } else {
          const url = new URL(config.url!);
          const requestInit = { headers: config.headers };
          try {
            await client.connect(new StreamableHTTPClientTransport(url, { requestInit }), { timeout: 15000, signal });
          } catch {
            await client.close();
            client = new Client({ name: 'piecemaker-mistral-sdk', version: '1.0.0' });
            clients.push(client);
            await client.connect(new SSEClientTransport(url, { requestInit }), { timeout: 15000, signal });
          }
        }
        let cursor: string | undefined;
        do {
          const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 15000, signal });
          for (const tool of page.tools) {
            const toolName = `mcp__${name}__${tool.name}`;
            const apiName = /^[a-zA-Z0-9_-]{1,64}$/.test(toolName) ? toolName : `${toolName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 48)}_${createHash('sha256').update(toolName).digest('hex').slice(0, 10)}`;
            tools.set(apiName, {
              name: toolName,
              readOnly: tool.annotations?.readOnlyHint === true,
              definition: { type: 'function', function: { name: apiName, description: `${toolName}\n${tool.description ?? ''}`, parameters: tool.inputSchema } },
              execute: async input => {
                await guard(toolName, input);
                const result = await client.callTool({ name: tool.name, arguments: input }, undefined, { timeout: 120000, signal });
                if (result.isError) throw new Error(JSON.stringify(result));
                return JSON.stringify(result);
              },
            });
          }
          cursor = page.nextCursor;
        } while (cursor);
      } catch (error) {
        await client.close();
        failures.push(`${name} : ${error instanceof Error ? error.message : 'connexion impossible'}`);
      }
    }
  } catch (error) {
    await Promise.allSettled(clients.map(client => client.close()));
    throw error;
  }

  return {
    tools,
    instructions: `Skills disponibles (charger avec skill avant utilisation) :\n${skills.map(skill => `${skill.name} : ${skill.description}`).join('\n')}\n${failures.length ? `Serveurs MCP indisponibles :\n${failures.join('\n')}` : ''}`,
    close: async () => { await Promise.allSettled(clients.map(client => client.close())); },
  };
}
