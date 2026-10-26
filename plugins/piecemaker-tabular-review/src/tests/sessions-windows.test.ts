import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openSession } from '../server/sessions.js';

const directories: string[] = [];

const NPM_SHIM = [
  '@ECHO off',
  'GOTO start',
  ':find_dp0',
  'SET dp0=%~dp0',
  'EXIT /b',
  ':start',
  'SETLOCAL',
  'CALL :find_dp0',
  '',
  'IF EXIST "%dp0%\\node.exe" (',
  '  SET "_prog=%dp0%\\node.exe"',
  ') ELSE (',
  '  SET "_prog=node"',
  '  SET PATHEXT=%PATHEXT:;.JS;=;%',
  ')',
  '',
  'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\codex-exemple\\cli.js" %*',
  '',
].join('\r\n');

const FAKE_CODEX = `
let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const text = input.includes('Bonjour') && process.argv.includes('--sandbox') ? 'Réponse exemple' : 'entrée inattendue';
  process.stdout.write(text);
});
`;

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('lancement des CLI installées par npm sous Windows', () => {
  it.skipIf(process.platform !== 'win32')('lance un shim .cmd appelé par son nom nu', async () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-shim-'));
    directories.push(bin);
    fs.mkdirSync(path.join(bin, 'node_modules', 'codex-exemple'), { recursive: true });
    fs.writeFileSync(path.join(bin, 'node_modules', 'codex-exemple', 'cli.js'), FAKE_CODEX);
    fs.writeFileSync(path.join(bin, 'codex.cmd'), NPM_SHIM);
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
    environment.Path = bin;
    environment.PIECEMAKER_HOME = bin;

    const session = openSession({
      provider: 'codex',
      model: 'gpt-5',
      mode: 'inline',
      system: 'Consigne "exemple" & suite\nsur deux lignes',
      readableDirectory: bin,
      environment,
      signal: new AbortController().signal,
    });

    await expect(session.send('Bonjour')).resolves.toBe('Réponse exemple');
  });
});
