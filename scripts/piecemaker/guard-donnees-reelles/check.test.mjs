import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  addTerms,
  createMatcher,
  readList,
  scanClaudeToolUse,
  scanRevisions,
  scanText,
} from './check.mjs';

const CHECK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check.mjs');

function temporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'guard-donnees-'));
}

function matcherFor(terms, mode = 'fold') {
  const file = path.join(temporaryDirectory(), 'hashes.json');
  addTerms(terms, mode, file);
  return { matcher: createMatcher(readList(file)), file };
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function repositoryWithRemoteBase() {
  const cwd = temporaryDirectory();
  git(cwd, 'init', '-q', '-b', 'main');
  git(cwd, 'config', 'user.email', 'test@example.com');
  git(cwd, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(cwd, 'a.txt'), 'texte neutre\n');
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', 'base');
  git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  return cwd;
}

function commitFile(cwd, name, content, message) {
  fs.writeFileSync(path.join(cwd, name), content);
  git(cwd, 'add', '.');
  git(cwd, 'commit', '-q', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

test('détecte un terme multi-mots sans tenir compte des accents ni de la casse', () => {
  const { matcher } = matcherFor(['Zorglub Quimby']);
  assert.equal(matcher('Contact : zörglub QUIMBY, Paris'), true);
  assert.equal(matcher('Zorglub seul'), false);
  assert.equal(matcher('Quimby seul'), false);
});

test('le mode exact distingue les accents', () => {
  const { matcher } = matcherFor(['Fénelon'], 'exact');
  assert.equal(matcher('Fénelon'), true);
  assert.equal(matcher('Fenelon'), false);
});

test('un terme noyé dans un jeton plus long n’est pas détecté', () => {
  const { matcher } = matcherFor(['zorglub']);
  assert.equal(matcher('integrity sha512-AbCzorglubXyZ0=='), false);
  assert.equal(matcher('zorglub-quimby'), true);
});

test('le fichier de hachages ne contient aucun texte en clair', () => {
  const { file } = matcherFor(['Zorglub Quimby', 'Fénelon']);
  const raw = fs.readFileSync(file, 'utf8').toLowerCase();
  assert.equal(raw.includes('zorglub'), false);
  assert.equal(raw.includes('quimby'), false);
  assert.equal(raw.includes('nelon'), false);
});

test('scanText donne le numéro de ligne sans révéler le terme', () => {
  const { matcher } = matcherFor(['zorglub']);
  const findings = scanText('a\nb zorglub\nc', 'fichier.txt', matcher);
  assert.deepEqual(findings, [{ label: 'fichier.txt', line: 2 }]);
});

test('le hook Claude bloque une écriture dans le dépôt et ignore le reste', () => {
  const { matcher } = matcherFor(['zorglub']);
  const projectDir = temporaryDirectory();
  const inside = { tool_name: 'Write', cwd: projectDir, tool_input: { file_path: path.join(projectDir, 'x.ts'), content: 'const a = "zorglub";' } };
  const outside = { tool_name: 'Write', cwd: projectDir, tool_input: { file_path: path.join(os.tmpdir(), 'x.ts'), content: 'zorglub' } };
  const edit = { tool_name: 'Edit', cwd: projectDir, tool_input: { file_path: 'x.ts', old_string: 'a', new_string: 'zorglub' } };
  const multi = { tool_name: 'MultiEdit', cwd: projectDir, tool_input: { file_path: 'x.ts', edits: [{ old_string: 'a', new_string: 'zorglub' }] } };
  const namedFile = { tool_name: 'Write', cwd: projectDir, tool_input: { file_path: path.join(projectDir, 'zorglub.md'), content: 'neutre' } };
  assert.equal(scanClaudeToolUse(inside, matcher).length, 1);
  assert.equal(scanClaudeToolUse(outside, matcher).length, 0);
  assert.equal(scanClaudeToolUse(edit, matcher).length, 1);
  assert.equal(scanClaudeToolUse(multi, matcher).length, 1);
  assert.equal(scanClaudeToolUse(namedFile, matcher).length, 1);
});

test('le hook Claude contrôle les commandes git d’écriture seulement', () => {
  const { matcher } = matcherFor(['zorglub']);
  const commit = { tool_name: 'Bash', tool_input: { command: 'git commit -m "feat: zorglub"' } };
  const other = { tool_name: 'Bash', tool_input: { command: 'echo zorglub' } };
  assert.equal(scanClaudeToolUse(commit, matcher).length, 1);
  assert.equal(scanClaudeToolUse(other, matcher).length, 0);
});

test('scanRevisions repère un message, une ligne ajoutée et un chemin, mais pas une suppression ni un lockfile', async () => {
  const { matcher } = matcherFor(['zorglub']);
  const cwd = repositoryWithRemoteBase();
  const original = process.cwd();
  process.chdir(cwd);
  try {
    const messageSha = commitFile(cwd, 'b.txt', 'neutre\n', 'fix: zorglub');
    assert.equal((await scanRevisions([messageSha, '--not', '--remotes=origin'], matcher)).length, 1);
    git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

    const lineSha = commitFile(cwd, 'c.txt', 'ligne zorglub\n', 'chore: neutre');
    assert.equal((await scanRevisions([lineSha, '--not', '--remotes=origin'], matcher)).length, 1);
    git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

    const removalSha = commitFile(cwd, 'c.txt', 'ligne neutre\n', 'chore: retrait');
    assert.equal((await scanRevisions([removalSha, '--not', '--remotes=origin'], matcher)).length, 0);
    git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

    const lockSha = commitFile(cwd, 'package-lock.json', '{"zorglub": 1}\n', 'chore: lock');
    assert.equal((await scanRevisions([lockSha, '--not', '--remotes=origin'], matcher)).length, 0);
    git(cwd, 'update-ref', 'refs/remotes/origin/main', 'HEAD');

    const pathSha = commitFile(cwd, 'zorglub.txt', 'neutre\n', 'chore: chemin');
    assert.equal((await scanRevisions([pathSha, '--not', '--remotes=origin'], matcher)).length, 1);
  } finally {
    process.chdir(original);
  }
});

test('pre-push refuse un push contenant un terme et accepte un push neutre', () => {
  const { file } = matcherFor(['zorglub']);
  const cwd = repositoryWithRemoteBase();
  const base = git(cwd, 'rev-parse', 'HEAD');
  const clean = commitFile(cwd, 'b.txt', 'neutre\n', 'feat: neutre');
  const dirty = commitFile(cwd, 'c.txt', 'zorglub\n', 'feat: autre');
  const run = (sha) => spawnSync('node', [CHECK, 'pre-push', 'origin'], {
    cwd,
    input: `refs/heads/main ${sha} refs/heads/main ${base}\n`,
    env: { ...process.env, GUARD_HASH_FILE: file },
    encoding: 'utf8',
  });
  assert.equal(run(clean).status, 0);
  const refused = run(dirty);
  assert.equal(refused.status, 1);
  assert.equal(refused.stderr.toLowerCase().includes('zorglub'), false);
});

test('add enregistre des termes hachés par la ligne de commande', () => {
  const file = path.join(temporaryDirectory(), 'hashes.json');
  const result = spawnSync('node', [CHECK, 'add', '-'], {
    input: 'zorglub\nQuimby Frobnitz\n',
    env: { ...process.env, GUARD_HASH_FILE: file },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  assert.equal(readList(file).terms.length, 2);
  assert.equal(fs.readFileSync(file, 'utf8').toLowerCase().includes('frobnitz'), false);
});
