import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { agentInstructionsTemplate, ensureAgentInstructionFiles, mirrorAgentInstructionFiles, startAgentInstructionsMirror } from './agent-instructions.js';

const SHARED = '/home/avocat/.piecemaker/CLAUDE.md';

async function withProject(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-instructions-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const read = (root: string, name: string) => readFile(path.join(root, name), 'utf8');

const isLinkToAgents = async (root: string) => (await lstat(path.join(root, 'CLAUDE.md'))).isSymbolicLink()
  && (await readlink(path.join(root, 'CLAUDE.md'))) === 'AGENTS.md';

test('creates AGENTS.md from the template and links CLAUDE.md to it', () => withProject(async (root) => {
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['CLAUDE.md', 'AGENTS.md']);
  assert.equal(await read(root, 'AGENTS.md'), agentInstructionsTemplate(SHARED));
  assert.ok(await isLinkToAgents(root));
  assert.match(await read(root, 'CLAUDE.md'), /^@\/home\/avocat\/\.piecemaker\/CLAUDE\.md\n/);
}));

test('moves a lone CLAUDE.md into AGENTS.md once mirrored', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'consignes du dossier\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['AGENTS.md']);
  await mirrorAgentInstructionFiles(root);
  assert.equal(await read(root, 'AGENTS.md'), 'consignes du dossier\n');
  assert.ok(await isLinkToAgents(root));
}));

test('links a missing CLAUDE.md to an existing AGENTS.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes codex\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['CLAUDE.md']);
  assert.ok(await isLinkToAgents(root));
  assert.equal(await read(root, 'CLAUDE.md'), 'consignes codex\n');
}));

test('AGENTS.md wins over a CLAUDE.md that already diverged', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'consignes Claude\n');
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes Codex\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), []);
  await mirrorAgentInstructionFiles(root);
  assert.ok(await isLinkToAgents(root));
  assert.equal(await read(root, 'CLAUDE.md'), 'consignes Codex\n');
}));

test('an edit that replaced the CLAUDE.md link is kept in AGENTS.md', () => withProject(async (root) => {
  await ensureAgentInstructionFiles(root, SHARED);
  await mirrorAgentInstructionFiles(root);
  await rm(path.join(root, 'CLAUDE.md'));
  await writeFile(path.join(root, 'CLAUDE.md'), 'édité côté Claude\n');
  await mirrorAgentInstructionFiles(root);
  assert.equal(await read(root, 'AGENTS.md'), 'édité côté Claude\n');
  assert.ok(await isLinkToAgents(root));
}));

test('AGENTS.md wins when both sides changed after the link broke', () => withProject(async (root) => {
  await ensureAgentInstructionFiles(root, SHARED);
  await mirrorAgentInstructionFiles(root);
  await rm(path.join(root, 'CLAUDE.md'));
  await writeFile(path.join(root, 'CLAUDE.md'), 'édité côté Claude\n');
  await writeFile(path.join(root, 'AGENTS.md'), 'édité côté Codex\n');
  await mirrorAgentInstructionFiles(root);
  assert.equal(await read(root, 'CLAUDE.md'), 'édité côté Codex\n');
  assert.ok(await isLinkToAgents(root));
}));

test('inverts an AGENTS.md that links to CLAUDE.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'lien\n');
  await symlink('CLAUDE.md', path.join(root, 'AGENTS.md'));
  await mirrorAgentInstructionFiles(root);
  assert.ok((await lstat(path.join(root, 'AGENTS.md'))).isFile());
  assert.equal(await read(root, 'AGENTS.md'), 'lien\n');
  assert.ok(await isLinkToAgents(root));
}));

test('replaces a CLAUDE.md that imports AGENTS.md with the link', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes codex\n');
  await writeFile(path.join(root, 'CLAUDE.md'), '@AGENTS.md\n');
  await mirrorAgentInstructionFiles(root);
  assert.ok(await isLinkToAgents(root));
  assert.equal(await read(root, 'AGENTS.md'), 'consignes codex\n');
}));

test('never copies an AGENTS.md import into AGENTS.md itself', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), '@AGENTS.md\n');
  await ensureAgentInstructionFiles(root, SHARED);
  assert.equal(await read(root, 'AGENTS.md'), agentInstructionsTemplate(SHARED));
}));

test('mirror does nothing silently when a file is missing', () => withProject(async (root) => {
  await mirrorAgentInstructionFiles(root);
  await writeFile(path.join(root, 'CLAUDE.md'), 'seul\n');
  await mirrorAgentInstructionFiles(root);
  await assert.rejects(read(root, 'AGENTS.md'));
}));

test('the watch loop hands each project to the callback once', () => withProject(async (root) => {
  const seen: string[] = [];
  const stop = startAgentInstructionsMirror(() => [root], (projectRoot) => seen.push(projectRoot));
  try {
    assert.deepEqual(seen, [path.resolve(root)]);
  } finally {
    stop();
  }
}));
