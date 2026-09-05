/**
 * Chemins et traversal du dossier : validation, défense et copie/déplacement sûrs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  resolveWorkspacePath,
  validateComponentId,
  safeChildPath,
  copyComponent,
  moveComponent,
  removeIfExists,
} = require('./paths.cjs');
const { ActivationError } = require('./errors.cjs');

test('resolveWorkspacePath valide et résout un chemin absolu vers un dossier existant', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-paths-'));
  const resolved = resolveWorkspacePath(root);
  assert.equal(resolved, fs.realpathSync(root));

  assert.throws(
    () => resolveWorkspacePath(''),
    (error) => error instanceof ActivationError && error.status === 400,
  );
  assert.throws(
    () => resolveWorkspacePath('relative/path'),
    (error) => error instanceof ActivationError && error.status === 400,
  );
  assert.throws(
    () => resolveWorkspacePath('/nonexistent/path'),
    (error) => error instanceof ActivationError && error.status === 400,
  );
  const file = path.join(root, 'file.txt');
  fs.writeFileSync(file, 'content');
  assert.throws(
    () => resolveWorkspacePath(file),
    (error) => error instanceof ActivationError && error.status === 400,
  );
});

test('validateComponentId rejette les identifiants vides, .. et . et contenant / ou \\', () => {
  assert.doesNotThrow(() => validateComponentId('valid-skill-id'));
  assert.throws(
    () => validateComponentId(''),
    (error) => error instanceof ActivationError && error.status === 400,
  );
  assert.throws(
    () => validateComponentId('.'),
    (error) => error instanceof ActivationError && error.status === 400,
  );
  assert.throws(
    () => validateComponentId('..'),
    (error) => error instanceof ActivationError && error.status === 400,
  );
  assert.throws(
    () => validateComponentId('a/b'),
    (error) => error instanceof ActivationError && error.status === 400,
  );
  assert.throws(
    () => validateComponentId('a\\b'),
    (error) => error instanceof ActivationError && error.status === 400,
  );
});

test('safeChildPath rejette les traversals comme ../../evil, a/b, .., .', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-safe-'));

  assert.doesNotThrow(() => safeChildPath(root, 'valid-id'));
  assert.throws(
    () => safeChildPath(root, '../../etc'),
    (error) => error instanceof ActivationError && error.status === 400,
  );
  assert.throws(
    () => safeChildPath(root, 'a/b'),
    (error) => error instanceof ActivationError && error.status === 400,
  );
  assert.throws(
    () => safeChildPath(root, '..'),
    (error) => error instanceof ActivationError && error.status === 400,
  );
  assert.throws(
    () => safeChildPath(root, '.'),
    (error) => error instanceof ActivationError && error.status === 400,
  );
});

test('safeChildPath with suffix rejette aussi les traversals', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-suffix-'));

  assert.doesNotThrow(() => safeChildPath(root, 'valid-id', '.md'));
  assert.throws(
    () => safeChildPath(root, '../../evil', '.md'),
    (error) => error instanceof ActivationError && error.status === 400,
  );
});

test('copyComponent copie un fichier ou un dossier récursivement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-copy-'));
  const sourceDir = path.join(root, 'source');
  const sourceFile = path.join(sourceDir, 'file.txt');
  fs.mkdirSync(sourceDir);
  fs.writeFileSync(sourceFile, 'content');

  const targetFile = path.join(root, 'target', 'file.txt');
  copyComponent(sourceFile, targetFile, { isDirectory: false });
  assert.equal(fs.readFileSync(targetFile, 'utf8'), 'content');

  const targetDir = path.join(root, 'target-dir');
  const sourceNestedFile = path.join(sourceDir, 'nested.txt');
  fs.writeFileSync(sourceNestedFile, 'nested');
  copyComponent(sourceDir, targetDir, { isDirectory: true });
  assert.equal(fs.readFileSync(path.join(targetDir, 'nested.txt'), 'utf8'), 'nested');
});

test('copyComponent écrase une copie antérieure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-overwrite-'));
  const source = path.join(root, 'source.txt');
  const target = path.join(root, 'target.txt');

  fs.writeFileSync(source, 'v1');
  fs.writeFileSync(target, 'old');
  copyComponent(source, target, { isDirectory: false });
  assert.equal(fs.readFileSync(target, 'utf8'), 'v1');

  fs.writeFileSync(source, 'v2');
  copyComponent(source, target, { isDirectory: false });
  assert.equal(fs.readFileSync(target, 'utf8'), 'v2');
});

test('moveComponent déplace un fichier ou un dossier', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-move-'));
  const source = path.join(root, 'source.txt');
  const target = path.join(root, 'subdir', 'target.txt');

  fs.writeFileSync(source, 'content');
  moveComponent(source, target, { isDirectory: false });
  assert.equal(fs.readFileSync(target, 'utf8'), 'content');
  assert.equal(fs.existsSync(source), false);
});

test('removeIfExists supprime un fichier ou un dossier récursivement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-remove-'));
  const dir = path.join(root, 'to-remove');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'file.txt'), 'content');

  removeIfExists(dir);
  assert.equal(fs.existsSync(dir), false);

  removeIfExists(path.join(root, 'nonexistent'));
  assert.equal(fs.existsSync(path.join(root, 'nonexistent')), false);
});
