const assert = require('node:assert/strict');
const { mkdir, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pauseInstallJobs, startInstallJob } = require('./admin-routes.cjs');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(read, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await wait(20);
  }
  throw new Error('Condition de test non satisfaite avant le délai maximal.');
}

function processExists(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function fakeRepo() {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'pm-install-pause-'));
  await mkdir(path.join(repoRoot, 'installer', 'bin'), { recursive: true });
  await writeFile(path.join(repoRoot, 'installer', 'bin', 'piecemaker.mjs'), `
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const download = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
writeFileSync(${JSON.stringify(path.join(repoRoot, 'download.pid'))}, String(download.pid));
console.log('model.safetensors : 312 Mo / 1,1 Go');
setInterval(() => {}, 1000);
`);
  return repoRoot;
}

test('la pause arrête l’installateur et ses téléchargements, la reprise relance l’étape', { skip: process.platform === 'win32' }, async (t) => {
  const repoRoot = await fakeRepo();
  t.after(() => rm(repoRoot, { recursive: true, force: true }));

  const job = startInstallJob(repoRoot, 'gliner');
  const downloadPid = Number(await waitFor(() => readFile(path.join(repoRoot, 'download.pid'), 'utf8').catch(() => '')));
  await waitFor(() => job.progress === 'model.safetensors : 312 Mo / 1,1 Go');

  assert.equal(await pauseInstallJobs(), job);
  await waitFor(() => job.state === 'paused');
  await waitFor(() => !processExists(downloadPid));
  assert.equal(job.error, '');

  const resumed = startInstallJob(repoRoot, 'gliner');
  assert.notEqual(resumed, job);
  assert.equal(resumed.state, 'running');
  await pauseInstallJobs();
  await waitFor(() => resumed.state === 'paused');
});

test('la pause sans installation en cours ne renvoie aucun job', async () => {
  assert.equal(await pauseInstallJobs(), null);
});

test('une installation en échec conserve aussi le diagnostic écrit sur stdout', async t => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'pm-install-error-'));
  t.after(() => rm(repoRoot, { recursive: true, force: true }));
  await mkdir(path.join(repoRoot, 'installer', 'bin'), { recursive: true });
  await writeFile(path.join(repoRoot, 'installer', 'bin', 'piecemaker.mjs'), "console.log('Téléchargement du modèle fictif interrompu');process.exitCode=1;");
  const job = startInstallJob(repoRoot, 'gliner');
  await waitFor(() => job.state === 'failed');
  assert.match(job.error, /modèle fictif interrompu/);
});
