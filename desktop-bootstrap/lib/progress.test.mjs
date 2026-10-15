import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  PISTE_LINKS,
  finishProgress,
  installerWindowCommand,
  noteProgress,
  openProgressWindow,
  progressWindowEnabled,
  settleProgressWindow,
} from './progress.mjs';
import { ui } from './ui.mjs';

function temporaryEnvFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-progress-')), '.env');
}

async function open(options = {}) {
  const url = await openProgressWindow({
    version: 'v2.0.1',
    launch: false,
    envFile: temporaryEnvFile(),
    validate: async ({ clientId }) => (clientId === 'bon' ? { ok: true } : { ok: false, message: 'refusé' }),
    ...options,
  });
  return {
    url,
    state: () => fetch(`${url}state`).then((response) => response.json()),
    post: (route, body) => fetch(`${url}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((response) => response.json()),
  };
}

test('PIECEMAKER_NO_PROGRESS désactive la fenêtre', () => {
  const previous = process.env.PIECEMAKER_NO_PROGRESS;
  process.env.PIECEMAKER_NO_PROGRESS = '1';
  assert.equal(progressWindowEnabled(), false);
  if (previous === undefined) delete process.env.PIECEMAKER_NO_PROGRESS;
  else process.env.PIECEMAKER_NO_PROGRESS = previous;
});

test("l'état initial est servi sur 127.0.0.1 derrière un jeton", async () => {
  const window = await open();
  assert.match(window.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/$/);
  const current = await window.state();
  assert.equal(current.state, 'running');
  assert.equal(current.version, 'v2.0.1');
  assert.equal(current.step, 'Démarrage…');
  assert.equal(current.piste.offered, true);
  assert.equal(current.piste.configured, false);
  const withoutToken = await fetch(new URL('/state', window.url));
  assert.equal(withoutToken.status, 404);
  await settleProgressWindow();
});

test('la page, le logo et les captures PISTE sont servis', async () => {
  const window = await open();
  const page = await fetch(window.url);
  const html = await page.text();
  assert.match(html, /Accès Légifrance/);
  assert.match(html, /Une seule chose à faire à la fois/);
  assert.match(html, /J'ai créé mon compte/);
  assert.match(html, /Voir un exemple de l'écran/);
  assert.equal(html.includes("Le site de l'État s'ouvre"), false);
  assert.equal(html.includes('Règles du mot de passe'), false);
  assert.equal(html.includes('L\'État ouvre Légifrance et Judilibre par le portail PISTE'), false);
  for (const asset of ['logo.png', 'piste/inscription.png', 'piste/cgu.png', 'piste/apps.png', 'piste/environnement.png', 'piste/api.png']) {
    const response = await fetch(`${window.url}${asset}`);
    assert.equal(response.status, 200, asset);
    assert.equal(response.headers.get('content-type'), 'image/png');
  }
  const favicon = await fetch(`${window.url}favicon.ico`);
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get('content-type'), 'image/x-icon');
  assert.equal((await fetch(`${window.url}piste/..%2F..%2Fpiste.mjs`)).status, 404);
  await settleProgressWindow();
});

test("une mise à jour ne propose pas le guide PISTE", async () => {
  const window = await open({ offerPiste: false });
  assert.equal((await window.state()).piste.offered, false);
  await settleProgressWindow();
});

test('ui.step fait avancer la barre sans atteindre la fin', async () => {
  const window = await open();
  ui.step('Compilation du client et du serveur…');
  ui.ok('Client compilé.');
  for (let index = 0; index < 20; index += 1) noteProgress({ step: `Étape ${index}`, increment: true });
  const current = await window.state();
  assert.equal(current.step, 'Étape 19');
  assert.ok(current.current < current.total);
  finishProgress({ ok: true, message: 'PieceMaker est installé.' });
  const done = await window.state();
  assert.equal(done.state, 'done');
  assert.equal(done.current, done.total);
  await settleProgressWindow();
});

test("un échec conserve le message d'erreur", async () => {
  const window = await open();
  ui.step("Construction de l'application Electron…");
  finishProgress({ ok: false, error: 'electron-builder a échoué (code 1).' });
  const current = await window.state();
  assert.equal(current.state, 'failed');
  assert.equal(current.error, 'electron-builder a échoué (code 1).');
  assert.equal(current.step, 'Installation interrompue');
  await settleProgressWindow();
});

test("des identifiants refusés ne sont pas enregistrés, des identifiants valides le sont", async () => {
  const envFile = temporaryEnvFile();
  const window = await open({ envFile });
  assert.deepEqual(await window.post('piste', { clientId: 'faux', clientSecret: 'x' }), { ok: false, message: 'refusé' });
  assert.equal(fs.existsSync(envFile), false);
  assert.deepEqual(await window.post('piste', { clientId: '  bon ', clientSecret: ' secret\n' }), { ok: true });
  assert.match(fs.readFileSync(envFile, 'utf8'), /^LEGIFRANCE_CLIENT_ID=bon\nLEGIFRANCE_CLIENT_SECRET=secret\nLEGIFRANCE_ENV=production\n$/);
  assert.equal((await window.state()).piste.configured, true);
  await settleProgressWindow();
});

test("seuls les liens PISTE connus peuvent être ouverts", async () => {
  const window = await open();
  assert.deepEqual(await window.post('open', { link: 'https://exemple.fr' }), { ok: false });
  assert.ok(Object.values(PISTE_LINKS).every((link) => link.startsWith('https://piste.gouv.fr/')));
  await settleProgressWindow();
});

test("sans fenêtre, la fin de l'installation n'attend pas la configuration PISTE", async () => {
  await open();
  finishProgress({ ok: true });
  const started = Date.now();
  await settleProgressWindow();
  assert.ok(Date.now() - started < 1_000);
});

test('sans fenêtre, PieceMaker est ouvert automatiquement', async () => {
  await open();
  finishProgress({ ok: true });
  let launches = 0;
  await settleProgressWindow({ launch: () => { launches += 1; } });
  assert.equal(launches, 1);
});

test("après un échec, PieceMaker n'est pas proposé", async () => {
  const window = await open();
  await window.state();
  finishProgress({ ok: false, error: 'échec' });
  let launches = 0;
  await settleProgressWindow({ pollMs: 20, launch: () => { launches += 1; } });
  assert.equal(launches, 0);
});

test("avec la fenêtre, l'ouverture de PieceMaker attend la configuration PISTE puis le clic", async () => {
  const window = await open();
  await window.state();
  finishProgress({ ok: true });
  let launches = 0;
  let settled = false;
  const settling = settleProgressWindow({ pollMs: 20, launch: () => { launches += 1; } }).then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal((await window.state()).launch.offered, true);
  await window.post('piste/skip', { skipped: true });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(settled, false);
  assert.equal(launches, 0);
  assert.deepEqual(await window.post('launch'), { ok: true });
  assert.deepEqual(await window.post('launch'), { ok: false });
  await settling;
  assert.equal(launches, 1);
});

test("Windows ouvre une fenêtre native, pas Edge", { skip: process.platform !== 'win32' }, () => {
  const command = installerWindowCommand('http://127.0.0.1:1/token/');
  assert.equal(path.basename(command[0]), 'installer-window.exe');
  assert.equal(fs.existsSync(command[0]), true);
  assert.ok(command[1].some((argument) => String(argument).endsWith('piecemaker.ico')));
  assert.ok(!JSON.stringify(command).toLowerCase().includes('msedge'));
  assert.ok(!JSON.stringify(command).includes('logo-windows.ico'));
});

test('la fin attend la configuration PISTE tant que la fenêtre interroge l’installateur', async () => {
  const window = await open();
  await window.state();
  finishProgress({ ok: true });
  let settled = false;
  const settling = settleProgressWindow({ pollMs: 20 }).then(() => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(settled, false);
  await window.post('piste/skip', { skipped: true });
  await settling;
  assert.equal(settled, true);
});
