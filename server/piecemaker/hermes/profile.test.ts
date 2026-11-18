import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { preparePieceMakerHermesProfile, readRappels, selectPieceMakerHermesProfile, writeRappels } from './profile.js';

const applicationRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const withProfile = async (body: (home: string) => Promise<void>) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-hermes-profile-'));
  const previous = { ...process.env };
  try {
    process.env.HERMES_HOME = path.join(temporary, 'profiles/piecemaker');
    process.env.PIECEMAKER_HERMES_PROFILE = 'piecemaker';
    await body(process.env.HERMES_HOME);
  } finally {
    process.env = previous;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
};

test('the dedicated Hermes profile is cloned once, outside the user profile, with memory off', async () => withProfile(async (home) => {
  const calls: Array<{ args: string[]; home: string | undefined }> = [];
  const run = async (args: string[], env: NodeJS.ProcessEnv = process.env) => {
    calls.push({ args, home: env.HERMES_HOME });
    if (args[0] === 'profile') {
      fs.mkdirSync(path.join(home, 'memories'), { recursive: true });
      fs.writeFileSync(path.join(home, 'config.yaml'), 'model: fictif\n');
      fs.writeFileSync(path.join(home, 'memories/MEMORY.md'), 'Fait du dossier Exemple');
      fs.writeFileSync(path.join(home, 'memories/USER.md'), 'Profil copié');
    }
    return { stdout: '', stderr: '' };
  };

  await preparePieceMakerHermesProfile(applicationRoot, run);
  assert.deepEqual(calls.map((call) => call.args), [
    ['profile', 'create', 'piecemaker', '--clone'],
    ['config', 'set', 'memory.memory_enabled', 'false'],
    ['config', 'set', 'memory.user_profile_enabled', 'false'],
  ]);
  assert.equal(calls[0].home, undefined, 'the profile is created from the root, not inside itself');
  assert.equal(calls[1].home, home);
  assert.equal(fs.readFileSync(path.join(home, 'memories/MEMORY.md'), 'utf8'), '');
  assert.equal(fs.readFileSync(path.join(home, 'memories/USER.md'), 'utf8'), '');
  assert.ok(fs.existsSync(path.join(home, 'scripts/piecemaker-rappels.py')));

  calls.length = 0;
  await preparePieceMakerHermesProfile(applicationRoot, run);
  assert.deepEqual(calls.map((call) => call.args[0]), ['config', 'config'], 'no second clone');
}));

test('a « piecemaker » profile not created by PieceMaker is left untouched', async () => withProfile(async (home) => {
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'config.yaml'), 'model: personnel\n');
  const calls: string[][] = [];
  await assert.rejects(preparePieceMakerHermesProfile(applicationRoot, async (args) => { calls.push(args); return { stdout: '', stderr: '' }; }), /n’a pas été créé par PieceMaker/);
  assert.deepEqual(calls, []);
}));

test('daily reminders replace the previous job and run the script without a model', async () => withProfile(async (home) => {
  fs.mkdirSync(path.join(home, 'cron'), { recursive: true });
  const jobs = path.join(home, 'cron/jobs.json');
  fs.writeFileSync(jobs, JSON.stringify({ jobs: [{ id: 'ancien', name: 'piecemaker-rappels', schedule: { kind: 'cron', expr: '0 8 * * *' }, deliver: 'telegram' }, { id: 'autre', name: 'perso' }] }));
  assert.deepEqual(readRappels(), { actif: true, heure: '08:00', destination: 'telegram' });

  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    if (args[1] === 'remove') fs.writeFileSync(jobs, JSON.stringify({ jobs: [{ id: 'autre', name: 'perso' }] }));
    if (args[1] === 'create') fs.writeFileSync(jobs, JSON.stringify({ jobs: [{ id: 'autre', name: 'perso' }, { id: 'nouveau', name: 'piecemaker-rappels', schedule: { kind: 'cron', expr: args[2] }, deliver: 'signal' }] }));
    return { stdout: '', stderr: '' };
  };
  assert.deepEqual(await writeRappels({ actif: true, heure: '07:30', destination: 'signal' }, run), { actif: true, heure: '07:30', destination: 'signal' });
  assert.deepEqual(calls, [
    ['cron', 'remove', 'ancien'],
    ['cron', 'create', '30 7 * * *', '--name', 'piecemaker-rappels', '--no-agent', '--script', 'piecemaker-rappels.py', '--deliver', 'signal', '--failure-deliver', 'local'],
  ]);

  calls.length = 0;
  assert.deepEqual(await writeRappels({ actif: false }, run), { actif: false, heure: null, destination: null });
  assert.deepEqual(calls, [['cron', 'remove', 'nouveau']]);
  await assert.rejects(writeRappels({ actif: true, heure: '25:00' }, run), /HH:MM/);
  await assert.rejects(writeRappels({ actif: true, destination: 'telegram; rm' }, run), /destination/);
}));

test('PieceMaker selects its own profile unless the user chose a Hermes home', () => {
  const previous = { ...process.env };
  try {
    delete process.env.HERMES_HOME;
    delete process.env.PIECEMAKER_HERMES_PROFILE;
    assert.equal(selectPieceMakerHermesProfile(), true);
    assert.equal(process.env.HERMES_HOME, path.join(os.homedir(), '.hermes/profiles/piecemaker'));
    process.env.HERMES_HOME = '/hermes-choisi';
    delete process.env.PIECEMAKER_HERMES_PROFILE;
    assert.equal(selectPieceMakerHermesProfile(), false);
    assert.equal(process.env.HERMES_HOME, '/hermes-choisi');
  } finally {
    process.env = previous;
  }
});
