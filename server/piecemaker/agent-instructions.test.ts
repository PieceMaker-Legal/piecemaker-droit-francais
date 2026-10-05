import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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

test('creates both files from the template when neither exists', () => withProject(async (root) => {
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['CLAUDE.md', 'AGENTS.md']);
  assert.equal(await read(root, 'CLAUDE.md'), agentInstructionsTemplate(SHARED));
  assert.equal(await read(root, 'AGENTS.md'), agentInstructionsTemplate(SHARED));
  assert.match(await read(root, 'CLAUDE.md'), /^@\/home\/avocat\/\.piecemaker\/CLAUDE\.md\n/);
}));

test('duplicates CLAUDE.md into a missing AGENTS.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'consignes du dossier\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['AGENTS.md']);
  assert.equal(await read(root, 'AGENTS.md'), 'consignes du dossier\n');
}));

test('duplicates AGENTS.md into a missing CLAUDE.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes codex\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['CLAUDE.md']);
  assert.equal(await read(root, 'CLAUDE.md'), 'consignes codex\n');
}));

test('never overwrites existing files', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'a\n');
  await writeFile(path.join(root, 'AGENTS.md'), 'b\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), []);
  assert.equal(await read(root, 'CLAUDE.md'), 'a\n');
  assert.equal(await read(root, 'AGENTS.md'), 'b\n');
}));

test('mirror propagates an edit made on either side of a synchronised pair', () => withProject(async (root) => {
  await ensureAgentInstructionFiles(root, SHARED);
  await mirrorAgentInstructionFiles(root);
  await writeFile(path.join(root, 'CLAUDE.md'), 'édité côté Claude\n');
  await mirrorAgentInstructionFiles(root);
  assert.equal(await read(root, 'AGENTS.md'), 'édité côté Claude\n');
  await writeFile(path.join(root, 'AGENTS.md'), 'édité côté Codex\n');
  await mirrorAgentInstructionFiles(root);
  assert.equal(await read(root, 'CLAUDE.md'), 'édité côté Codex\n');
}));

test('mirror leaves a pair that already diverged untouched', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'consignes Claude\n');
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes Codex\n');
  await mirrorAgentInstructionFiles(root);
  assert.equal(await read(root, 'CLAUDE.md'), 'consignes Claude\n');
  assert.equal(await read(root, 'AGENTS.md'), 'consignes Codex\n');
}));

test('mirror does nothing silently when a file is missing', () => withProject(async (root) => {
  await mirrorAgentInstructionFiles(root);
  await writeFile(path.join(root, 'CLAUDE.md'), 'seul\n');
  await mirrorAgentInstructionFiles(root);
  await assert.rejects(read(root, 'AGENTS.md'));
}));

test('mirror leaves a symlinked pair untouched', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'lien\n');
  await symlink('CLAUDE.md', path.join(root, 'AGENTS.md'));
  await mirrorAgentInstructionFiles(root);
  assert.equal(await read(root, 'AGENTS.md'), 'lien\n');
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
