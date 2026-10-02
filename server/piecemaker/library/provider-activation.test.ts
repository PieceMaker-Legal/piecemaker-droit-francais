import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

import { installLibraryRuntime } from './runtime.js';
import { createLibraryStore } from './store.js';

const require = createRequire(import.meta.url);
const TOML = require('@iarna/toml') as { parse(value: string): Record<string, unknown> };

const PROVIDERS = ['claude', 'codex', 'cursor', 'mistral', 'opencode', 'grok'] as const;
type ProviderId = (typeof PROVIDERS)[number];

function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-library-provider-'));
  const home = path.join(root, 'home');
  const workspace = path.join(root, 'case');
  const skillDir = path.join(home, '.claude/skills/review');
  const agentFile = path.join(home, '.claude/agents/review.md');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(path.dirname(agentFile), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: review\ndescription: Relire.\n---\nInstructions privées.');
  fs.writeFileSync(path.join(skillDir, 'table-columns.yaml'), 'columns:\n  - name: Date\n');
  fs.writeFileSync(agentFile, '---\nname: review-agent\ndescription: Agent.\n---\nRôle privé.');
  const store = createLibraryStore(path.join(home, '.piecemaker'));
  t.after(() => { store.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { workspace, skillDir, agentFile, store };
}

function skillTarget(workspace: string, provider: ProviderId, name: string) {
  const roots: Record<ProviderId, string[] | null> = {
    claude: ['.claude', 'skills'],
    codex: ['.agents', 'skills'],
    cursor: ['.cursor', 'skills'],
    mistral: ['.agents', 'skills'],
    opencode: ['.opencode', 'skills'],
    grok: ['.grok', 'skills'],
  };
  const root = roots[provider];
  return root ? path.join(workspace, ...root, name) : null;
}

function agentTarget(workspace: string, provider: ProviderId, name: string) {
  const roots: Record<ProviderId, { folder: string[]; extension: string } | null> = {
    claude: { folder: ['.claude', 'agents'], extension: '.md' },
    codex: { folder: ['.codex', 'agents'], extension: '.toml' },
    cursor: null,
    mistral: { folder: ['.vibe', 'agents'], extension: '.toml' },
    opencode: { folder: ['.opencode', 'agent'], extension: '.md' },
    grok: { folder: ['.grok', 'agents'], extension: '.md' },
  };
  const root = roots[provider];
  return root ? path.join(workspace, ...root.folder, `${name}${root.extension}`) : null;
}

function objectRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readJson(filePath: string) {
  if (!fs.existsSync(filePath)) return {};
  return objectRecord(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

function mcpState(workspace: string, provider: ProviderId, name: string) {
  if (provider === 'mistral') {
    const filePath = path.join(workspace, '.vibe', 'config.toml');
    const parsed = fs.existsSync(filePath) ? objectRecord(TOML.parse(fs.readFileSync(filePath, 'utf8'))) : {};
    const server = (Array.isArray(parsed.mcp_servers) ? parsed.mcp_servers : []).map(objectRecord).find((entry) => entry.name === name);
    return { native: true as const, enabled: Boolean(server), config: server };
  }
  if (provider === 'claude') {
    const servers = objectRecord(readJson(path.join(workspace, '.mcp.json')).mcpServers);
    const disabled = readJson(path.join(workspace, '.claude', 'settings.local.json')).disabledMcpServers;
    const blocked = Array.isArray(disabled) && disabled.includes(name);
    return { native: true as const, enabled: Boolean(servers[name]) && !blocked, config: servers[name] };
  }
  if (provider === 'codex') {
    const parsed = fs.existsSync(path.join(workspace, '.codex', 'config.toml'))
      ? objectRecord(TOML.parse(fs.readFileSync(path.join(workspace, '.codex', 'config.toml'), 'utf8')))
      : {};
    const server = objectRecord(objectRecord(parsed.mcp_servers)[name]);
    return { native: true as const, enabled: Boolean(Object.keys(server).length) && server.enabled !== false, config: server };
  }
  if (provider === 'cursor') {
    const server = objectRecord(objectRecord(readJson(path.join(workspace, '.cursor', 'mcp.json')).mcpServers)[name]);
    return { native: true as const, enabled: Boolean(Object.keys(server).length) && server.disabled !== true, config: server };
  }
  if (provider === 'grok') {
    const filePath = path.join(workspace, '.grok', 'config.toml');
    const parsed = fs.existsSync(filePath) ? objectRecord(TOML.parse(fs.readFileSync(filePath, 'utf8'))) : {};
    const server = objectRecord(objectRecord(parsed.mcp_servers)[name]);
    return { native: true as const, enabled: Boolean(Object.keys(server).length) && server.enabled !== false, config: server };
  }
  const server = objectRecord(objectRecord(readJson(path.join(workspace, 'opencode.json')).mcp)[name]);
  return { native: true as const, enabled: Boolean(Object.keys(server).length) && server.enabled !== false, config: server };
}

async function injectedCommand(store: ReturnType<typeof createLibraryStore>, provider: ProviderId, workspace: string) {
  let command = '';
  const runtime = {
    run: async (_provider: string, value: string, _options?: { cwd?: string }, _writer?: { send: (value: unknown) => void }) => { command = value; },
    getRunner: (next: string) => (value: string, options: { cwd?: string }, writer: { send: (value: unknown) => void }) => runtime.run(next, value, options, writer),
  };
  const sessions = { fetchHistory: async () => ({ messages: [] }) };
  installLibraryRuntime(runtime, sessions as never, store);
  await runtime.getRunner(provider)('Relire', { cwd: workspace }, { send() {} });
  return command;
}

for (const provider of PROVIDERS) {
  test(`skill activation reaches ${provider}`, async (t) => {
    const { store, workspace, skillDir } = fixture(t);
    const id = store.importFile(path.join(skillDir, 'SKILL.md'), 'skill');
    store.setEnabled(workspace, id, true);
    const target = skillTarget(workspace, provider, 'review');
    if (target) {
      assert.equal(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8'), store.document(id).content);
      assert.equal(fs.readFileSync(path.join(target, 'table-columns.yaml'), 'utf8'), 'columns:\n  - name: Date\n');
    } else {
      assert.equal(fs.existsSync(path.join(workspace, '.mistral')), false);
    }
    assert.match(await injectedCommand(store, provider, workspace), /Instructions privées/);
    store.setEnabled(workspace, id, false);
    if (target) assert.equal(fs.existsSync(target), false);
    assert.equal(await injectedCommand(store, provider, workspace), 'Relire');
  });

  test(`agent activation reaches ${provider}`, async (t) => {
    const { store, workspace, agentFile } = fixture(t);
    const id = store.importFile(agentFile, 'agent');
    store.setEnabled(workspace, id, true);
    const target = agentTarget(workspace, provider, 'review-agent');
    if (target) {
      const content = fs.readFileSync(target, 'utf8');
      if (provider === 'codex') {
        assert.match(content, /developer_instructions = /);
        assert.match(content, /Rôle privé/);
      } else if (provider === 'mistral') {
        assert.deepEqual(TOML.parse(content), { display_name: 'review-agent', description: 'Agent.', agent_type: 'subagent', instructions: 'Rôle privé.' });
      } else {
        assert.equal(content, store.document(id).content);
      }
    } else {
      assert.equal(fs.existsSync(path.join(workspace, provider === 'cursor' ? '.cursor/agents' : '.mistral')), false);
    }
    assert.match(await injectedCommand(store, provider, workspace), /Instructions de rôle/);
    store.setEnabled(workspace, id, false);
    if (target) assert.equal(fs.existsSync(target), false);
    assert.equal(await injectedCommand(store, provider, workspace), 'Relire');
  });

  test(`mcp activation reaches ${provider}`, (t) => {
    const { store, workspace } = fixture(t);
    const id = store.importConnector({
      name: 'registre-public',
      description: 'https://registre-public.com/api/mcp',
      config: { transport: 'http', url: 'https://registre-public.com/api/mcp' },
      source: 'piecemaker:default:registre-public',
    });
    store.setEnabled(workspace, id, true);
    const enabled = mcpState(workspace, provider, 'registre-public');
    if (enabled.native) {
      assert.equal(enabled.enabled, true);
      assert.equal(JSON.stringify(enabled.config).includes('registre-public.com/api/mcp'), true);
    } else {
      assert.equal(fs.existsSync(path.join(workspace, '.mistral')), false);
    }
    store.setEnabled(workspace, id, false);
    const disabled = mcpState(workspace, provider, 'registre-public');
    if (disabled.native) assert.equal(disabled.enabled, false);
  });

  test(`plugin activation reaches ${provider}`, async (t) => {
    const { store, workspace, skillDir, agentFile } = fixture(t);
    const skillId = store.importFile(path.join(skillDir, 'SKILL.md'), 'skill');
    const agentId = store.importFile(agentFile, 'agent');
    const mcpId = store.importConnector({
      name: 'legifrance',
      description: 'python3',
      config: { transport: 'stdio', command: 'python3', args: ['server.py'] },
      source: '/plugins/legal/.mcp.json#legifrance',
      namespace: 'legal@market',
    });
    store.upsertCollection({
      id: 'legal@market',
      name: 'Legal',
      description: '',
      source: '/plugins/legal',
      entries: [
        { entryId: skillId, rootPath: 'skills/review' },
        { entryId: agentId, rootPath: 'agents/review.md' },
        { entryId: mcpId, rootPath: 'mcp/legifrance.json' },
      ],
      files: [],
    });
    store.setCollectionEnabled(workspace, 'legal@market', true);
    const skillPath = skillTarget(workspace, provider, 'review');
    if (skillPath) assert.ok(fs.existsSync(path.join(skillPath, 'SKILL.md')));
    const agentPath = agentTarget(workspace, provider, 'review-agent');
    if (agentPath) assert.ok(fs.existsSync(agentPath));
    const mcp = mcpState(workspace, provider, 'legifrance');
    if (mcp.native) {
      assert.equal(mcp.enabled, true);
      assert.equal(JSON.stringify(mcp.config).includes('python3'), true);
    } else {
      assert.equal(fs.existsSync(path.join(workspace, '.mistral')), false);
    }
    const injected = await injectedCommand(store, provider, workspace);
    assert.match(injected, /Skill : review/);
    assert.match(injected, /Instructions de rôle : review-agent/);
    assert.match(injected, /Rôle privé/);
    store.setCollectionEnabled(workspace, 'legal@market', false);
    if (skillPath) assert.equal(fs.existsSync(skillPath), false);
    if (agentPath) assert.equal(fs.existsSync(agentPath), false);
    if (mcp.native) assert.equal(mcpState(workspace, provider, 'legifrance').enabled, false);
    assert.equal(await injectedCommand(store, provider, workspace), 'Relire');
  });
}
