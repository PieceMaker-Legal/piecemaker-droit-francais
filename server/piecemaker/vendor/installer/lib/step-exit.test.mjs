import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('a partial component installation returns a failure exit code to the application', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-step-result-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const installer = path.join(root, 'installer');
  await fs.cp(new URL('./', import.meta.url), path.join(installer, 'lib'), { recursive: true });
  await fs.mkdir(path.join(installer, 'bin'));
  await fs.mkdir(path.join(installer, 'steps'));
  const entry = path.join(installer, 'bin', 'piecemaker.mjs');
  await fs.copyFile(new URL('../bin/piecemaker.mjs', import.meta.url), entry);
  for (const [status, expected] of [['done', 0], ['partial', 1], ['failed', 1]]) {
    await fs.writeFile(path.join(installer, 'steps', '01-example.mjs'), `export const meta={id:'01-example',label:'Composant fictif'};export async function install(){return {status:${JSON.stringify(status)},note:'Modèle fictif absent'};}`);
    const result = spawnSync(process.execPath, [entry, '--step', '01-example'], { encoding: 'utf8', timeout: 30000, env: { ...process.env, PIECEMAKER_HOME: path.join(root, 'home'), PIECEMAKER_YES: '1' } });
    assert.equal(result.status, expected, result.stderr + result.stdout);
    const state = JSON.parse(await fs.readFile(path.join(root, 'home', 'state.json'), 'utf8'));
    assert.equal(state.steps['01-example'].status, status);
  }
});
