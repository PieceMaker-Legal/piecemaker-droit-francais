import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildSupportReport, maskUserPaths } from './report.js';
import { PREVIOUS_SUPPORT_LOG_FILE, SUPPORT_LOG_FILE } from './log.js';

const logScript = path.join(import.meta.dirname, 'log.ts');

function runLoggedProcess(directory: string, version: string, message: string) {
  const script = `import { startSupportLog } from ${JSON.stringify(logScript)}; startSupportLog(${JSON.stringify(directory)}, ${JSON.stringify(version)}); console.error(${JSON.stringify(message)});`;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('the support log keeps everything since the update and moves older lines aside', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-logs-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  runLoggedProcess(directory, '2.0.53', 'erreur avant la mise à jour');
  runLoggedProcess(directory, '2.0.54', 'premier démarrage après la mise à jour');
  runLoggedProcess(directory, '2.0.54', '\u001b[36msecond démarrage\u001b[0m');
  const current = fs.readFileSync(path.join(directory, SUPPORT_LOG_FILE), 'utf8');
  const previous = fs.readFileSync(path.join(directory, PREVIOUS_SUPPORT_LOG_FILE), 'utf8');
  assert.match(current, /\[error\] premier démarrage après la mise à jour/);
  assert.match(current, /\[error\] second démarrage\n/);
  assert.doesNotMatch(current, /avant la mise à jour/);
  assert.match(previous, /PieceMaker 2\.0\.53/);
  assert.match(previous, /erreur avant la mise à jour/);
});

test('the report hides the home folder and the account name, on Windows paths too', () => {
  assert.equal(
    maskUserPaths('C:\\Users\\jdupont\\.local\\bin\\vibe.exe et C:/Users/jdupont/x, jdupont connecté', 'C:\\Users\\jdupont', 'jdupont'),
    '~\\.local\\bin\\vibe.exe et ~/x, <utilisateur> connecté',
  );
});

test('the report holds the description, the Mistral diagnostic and the log, then goes through pseudonymisation', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-logs-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.writeFileSync(path.join(directory, SUPPORT_LOG_FILE), '2026-10-19T10:00:00.000Z [error] [Mistral] Vibe n’a pas pu démarrer\n');
  const report = await buildSupportReport('Le chat Mistral ne répond pas pour Jean Dupont', {
    logDirectory: directory,
    version: '2.0.54',
    anonymizerStatus: () => ({ enabled: true, reason: 'running', listening: true }),
    pseudonymize: (text) => text.replaceAll('Jean Dupont', '[PERSONNE_1]'),
  });
  assert.match(report, /Le chat Mistral ne répond pas pour \[PERSONNE_1\]/);
  assert.doesNotMatch(report, /Jean Dupont/);
  assert.match(report, /PieceMaker 2\.0\.54/);
  assert.match(report, /Vibe utilisé par le chat :/);
  assert.match(report, /Vibe n’a pas pu démarrer/);
  assert.match(report, /Proxy d’anonymisation : actif/);
});
