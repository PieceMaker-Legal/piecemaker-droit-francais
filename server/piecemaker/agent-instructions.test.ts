import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { agentInstructionsTemplate, ensureAgentInstructionFiles, startAgentInstructionsMigration } from './agent-instructions.js';

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
const CLAUDE_IMPORTS = `@AGENTS.md\n@${SHARED}\n`;

test('creates AGENTS.md from the template and a CLAUDE.md that imports it', () => withProject(async (root) => {
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['CLAUDE.md', 'AGENTS.md']);
  assert.equal(await read(root, 'AGENTS.md'), agentInstructionsTemplate());
  assert.doesNotMatch(await read(root, 'AGENTS.md'), /^@/m);
  assert.equal(await read(root, 'CLAUDE.md'), CLAUDE_IMPORTS);
}));

test('moves a lone CLAUDE.md into AGENTS.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'consignes du dossier\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['AGENTS.md']);
  assert.equal(await read(root, 'AGENTS.md'), 'consignes du dossier\n');
  assert.equal(await read(root, 'CLAUDE.md'), CLAUDE_IMPORTS);
}));

test('adds the import next to an existing AGENTS.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes codex\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['CLAUDE.md']);
  assert.equal(await read(root, 'AGENTS.md'), 'consignes codex\n');
  assert.equal(await read(root, 'CLAUDE.md'), CLAUDE_IMPORTS);
}));

test('AGENTS.md wins over a CLAUDE.md that diverged', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'consignes Claude\n');
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes Codex\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), []);
  assert.equal(await read(root, 'AGENTS.md'), 'consignes Codex\n');
  assert.equal(await read(root, 'CLAUDE.md'), CLAUDE_IMPORTS);
}));

test('keeps Claude-specific lines written below the import', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes codex\n');
  await writeFile(path.join(root, 'CLAUDE.md'), `${CLAUDE_IMPORTS}\nPropre à Claude\n`);
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), []);
  assert.equal(await read(root, 'CLAUDE.md'), `${CLAUDE_IMPORTS}\nPropre à Claude\n`);
}));

test('adds the shared import to a CLAUDE.md that only imports AGENTS.md, keeping its own lines', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes codex\n');
  await writeFile(path.join(root, 'CLAUDE.md'), '@AGENTS.md\n\nPropre à Claude\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), []);
  assert.equal(await read(root, 'CLAUDE.md'), `${CLAUDE_IMPORTS}\nPropre à Claude\n`);
  assert.equal(await read(root, 'AGENTS.md'), 'consignes codex\n');
}));

test('never overwrites an existing AGENTS.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'parties, juridiction, échéances\n');
  await ensureAgentInstructionFiles(root, SHARED);
  await ensureAgentInstructionFiles(root, SHARED);
  assert.equal(await read(root, 'AGENTS.md'), 'parties, juridiction, échéances\n');
}));

test('leaves the shared import out of an AGENTS.md moved from CLAUDE.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), `@${SHARED}\n\nconsignes du dossier\n`);
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['AGENTS.md']);
  assert.equal(await read(root, 'AGENTS.md'), '\nconsignes du dossier\n');
  assert.equal(await read(root, 'CLAUDE.md'), CLAUDE_IMPORTS);
}));

test('never copies the import into AGENTS.md itself', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), '@AGENTS.md\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['AGENTS.md']);
  assert.equal(await read(root, 'AGENTS.md'), agentInstructionsTemplate());
}));

test('replaces a CLAUDE.md symlink with the import without touching AGENTS.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes\n');
  await symlink('AGENTS.md', path.join(root, 'CLAUDE.md'));
  await ensureAgentInstructionFiles(root, SHARED);
  assert.ok((await lstat(path.join(root, 'CLAUDE.md'))).isFile());
  assert.equal(await read(root, 'CLAUDE.md'), CLAUDE_IMPORTS);
  assert.equal(await read(root, 'AGENTS.md'), 'consignes\n');
}));

test('leaves an AGENTS.md symlinked to CLAUDE.md untouched', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'lien\n');
  await symlink('CLAUDE.md', path.join(root, 'AGENTS.md'));
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), []);
  assert.equal(await read(root, 'CLAUDE.md'), 'lien\n');
}));

test('the migration converts existing CLAUDE.md files and hands each project to the callback once', () => withProject(async (root) => {
  const withClaude = path.join(root, 'avec');
  const without = path.join(root, 'sans');
  await mkdir(withClaude);
  await mkdir(without);
  await writeFile(path.join(withClaude, 'CLAUDE.md'), 'consignes\n');
  const seen: string[] = [];
  const stop = startAgentInstructionsMigration(() => [withClaude, without, path.join(root, 'absent')], SHARED, (projectRoot) => seen.push(projectRoot));
  try {
    assert.deepEqual(seen, [withClaude, without]);
    for (let attempt = 0; attempt < 100 && (await read(withClaude, 'CLAUDE.md')) !== CLAUDE_IMPORTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(await read(withClaude, 'CLAUDE.md'), CLAUDE_IMPORTS);
    assert.equal(await read(withClaude, 'AGENTS.md'), 'consignes\n');
    await assert.rejects(read(without, 'CLAUDE.md'));
  } finally {
    stop();
  }
}));
