import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { installHermesPieceMaker } from './runtime.js';

test('Hermes installs its plugin once and binds commands to the launching instance', async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-hermes-'));
  const previous = { ...process.env };
  try {
    const executable = path.join(temporary, 'hermes.mjs');
    const calls = path.join(temporary, 'calls.jsonl');
    fs.writeFileSync(executable, `import fs from 'node:fs'; fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2)) + '\\n');`);
    process.env.HERMES_HOME = path.join(temporary, 'hermes');
    process.env.CLOUDCLI_HOME = path.join(temporary, 'application');
    process.env.HERMES_CLI_PATH = `${process.execPath} ${executable} acp`;
    process.env.SERVER_PORT = '3003';
    const received: unknown[][] = [];
    const runtime = { run: async (...args: unknown[]) => { received.push(args); return 'done'; } };
    const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    installHermesPieceMaker(runtime as never, applicationRoot);
    await runtime.run('claude', 'hello', {}, {});
    assert.equal(fs.existsSync(calls), false);
    await runtime.run('hermes', 'hello', { cwd: '/dossier-fictif' }, {});
    await runtime.run('hermes', 'again', { cwd: '/autre-dossier-fictif' }, {});
    assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line)), [['plugins', 'enable', 'piecemaker']]);
    const plugin = path.join(process.env.HERMES_HOME, 'plugins/piecemaker');
    assert.ok(fs.existsSync(path.join(plugin, 'skills/piecemaker/SKILL.md')));
    assert.ok(fs.existsSync(path.join(process.env.HERMES_HOME, 'scripts/piecemaker-rappels.py')));
    const directory = path.join(plugin, 'bindings');
    const binding = JSON.parse(fs.readFileSync(path.join(directory, fs.readdirSync(directory)[0]), 'utf8'));
    assert.equal(binding.home, process.env.CLOUDCLI_HOME);
    assert.deepEqual(binding.projects, ['/dossier-fictif', '/autre-dossier-fictif']);
    assert.equal(binding.pid, process.pid);
    assert.equal(received.length, 3);
  } finally {
    process.env = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
