import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { providerSkillsService } from '@/modules/providers/index.js';

import { createMistralTools } from './tools.js';

test('MCP stdio discovery, invocation and skill masking use the enabled workspace configuration', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'mistral-tools-test-'));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const skillPath = path.join(home, 'SKILL.md');
  await fs.writeFile(skillPath, 'Instructions fictives ZETABIO.');
  t.mock.method(providerSkillsService, 'listProviderSkills', async () => [
    { provider: 'mistral', name: 'enabled-skill', description: 'Actif', command: '/enabled-skill', scope: 'project', sourcePath: skillPath },
    { provider: 'mistral', name: 'disabled-skill', description: 'Masqué', command: '/disabled-skill', scope: 'project', sourcePath: skillPath },
  ]);
  const moduleUrl = (name: string) => JSON.stringify(pathToFileURL(path.resolve('node_modules/@modelcontextprotocol/sdk/dist/esm', name)).href);
  const server = path.join(home, 'fixture.mjs');
  await fs.writeFile(server, `
import {Server} from ${moduleUrl('server/index.js')};
import {StdioServerTransport} from ${moduleUrl('server/stdio.js')};
import {ListToolsRequestSchema,CallToolRequestSchema} from ${moduleUrl('types.js')};
const server=new Server({name:'fixture',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'echo',description:'Preuve fictive',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value']},annotations:{readOnlyHint:true}}]}));
server.setRequestHandler(CallToolRequestSchema,async request=>({content:[{type:'text',text:'MCP-'+request.params.arguments.value}]}));
await server.connect(new StdioServerTransport());
`);
  await fs.writeFile(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: {
    fixture: { command: process.execPath, args: [server] }, disabled: { command: 'does-not-exist', disabled: true },
  } }));
  const toolbox = await createMistralTools(home, [{ name: 'disabled-skill' }], AbortSignal.timeout(20000), home);
  t.after(() => toolbox.close());
  assert.ok(toolbox.tools.has('mcp__fixture__echo'));
  assert.equal(toolbox.tools.get('mcp__fixture__echo')?.readOnly, true);
  assert.ok((await toolbox.tools.get('mcp__fixture__echo')!.execute({ value: 'ZETABIO' })).includes('MCP-ZETABIO'));
  assert.ok(toolbox.instructions.includes('enabled-skill'));
  assert.ok(!toolbox.instructions.includes('disabled-skill'));
  assert.ok(!toolbox.instructions.includes('Serveurs MCP indisponibles'));
  assert.ok((await toolbox.tools.get('skill')!.execute({ name: 'enabled-skill' })).includes('Instructions fictives ZETABIO'));
  await assert.rejects(toolbox.tools.get('skill')!.execute({ name: 'disabled-skill' }), /indisponible/);
  await assert.rejects(toolbox.tools.get('Read')!.execute({ file_path: path.join(home, 'auth.db') }), /identifiants/);
  await fs.writeFile(path.join(home, 'example.txt'), 'Ancien texte.');
  await toolbox.tools.get('Edit')!.execute({ file_path: 'example.txt', old_string: 'Ancien', new_string: 'Nouveau' });
  assert.equal(await fs.readFile(path.join(home, 'example.txt'), 'utf8'), 'Nouveau texte.');
  assert.equal(await toolbox.tools.get('Read')!.execute({ file_path: '~/example.txt' }), 'Nouveau texte.');
  await assert.rejects(toolbox.tools.get('Edit')!.execute({ file_path: 'example.txt', old_string: 'Absent', new_string: 'Erreur' }), /une seule fois/);
});

test('green-shield original and mapping guards apply to SDK reads, edits and shell commands', async t => {
  await fs.mkdir('.tmp', { recursive: true });
  const root = await fs.mkdtemp(path.resolve('.tmp/mistral-protection-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const caseRoot = path.join(root, 'Dossier Exemple');
  const home = path.join(root, 'home');
  await fs.mkdir(caseRoot);
  await fs.mkdir(home);
  for (const file of ['projects.json', 'anonymized-projects.json']) {
    await fs.writeFile(path.join(home, file), JSON.stringify({ version: 1, sources: { test: [caseRoot] } }));
  }
  await fs.writeFile(path.join(caseRoot, 'contrat-fictif.pdf'), '%PDF fictif');
  await fs.writeFile(path.join(caseRoot, 'notes.md'), 'Notes fictives.');
  await fs.writeFile(path.join(caseRoot, 'mapping_default.json'), '{}');
  const previousHome = process.env.PIECEMAKER_HOME;
  process.env.PIECEMAKER_HOME = home;
  t.after(() => { if (previousHome === undefined) delete process.env.PIECEMAKER_HOME; else process.env.PIECEMAKER_HOME = previousHome; });
  t.mock.method(providerSkillsService, 'listProviderSkills', async () => []);
  const toolbox = await createMistralTools(caseRoot, [], AbortSignal.timeout(20000), home);
  t.after(() => toolbox.close());
  await assert.rejects(toolbox.tools.get('Read')!.execute({ file_path: 'contrat-fictif.pdf' }), /protégée/);
  await assert.rejects(toolbox.tools.get('Edit')!.execute({ file_path: 'contrat-fictif.pdf', old_string: 'fictif', new_string: 'modifié' }), /protégée/);
  await assert.rejects(toolbox.tools.get('Write')!.execute({ file_path: 'contrat-fictif.pdf', content: 'modifié' }), /protégée/);
  await assert.rejects(toolbox.tools.get('Read')!.execute({ file_path: 'mapping_default.json' }), /mapping/);
  await assert.rejects(toolbox.tools.get('Bash')!.execute({ command: 'cat contrat-fictif.pdf' }), /protégée/);
  assert.equal(await toolbox.tools.get('Read')!.execute({ file_path: 'notes.md' }), 'Notes fictives.');
});
