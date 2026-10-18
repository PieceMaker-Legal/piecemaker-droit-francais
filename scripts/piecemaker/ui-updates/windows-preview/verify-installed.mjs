import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const executable = path.resolve(process.argv[2]);
const output = path.resolve(process.env.PIECEMAKER_TEST_OUTPUT);
const product = JSON.parse(await fs.readFile(path.join(path.dirname(executable), 'resources/app.asar.unpacked/product.config.json')));
assert.equal(product.appId, 'legal.piecemaker.testmaj');
assert.equal(product.dataDirectoryName, '.piecemaker-maj-test');
assert.equal(path.basename(executable), 'PieceMakerTestMAJ.exe');
const { runtime } = JSON.parse(await fs.readFile(path.join(output, 'test-runtime.json')));
let log = '';
const controller = spawn(executable, [path.join(output, 'feed.mjs'), executable], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PIECEMAKER_PREVIEW_AUTOMATED: '1', PIECEMAKER_TEST_DEBUG_PORT: '39217' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const capture = (chunk) => { log += chunk; process.stdout.write(chunk); };
controller.stdout.on('data', capture);
controller.stderr.on('data', capture);
async function waitFor(action, name, timeout = 120000) {
  const deadline = Date.now() + timeout;
  let error;
  while (Date.now() < deadline) {
    try { const value = await action(); if (value) return value; } catch (caught) { error = caught; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} timed out: ${error?.message || ''}`);
}
let control;
const post = (action) => fetch(`${control}/${action}`, { method: 'POST', redirect: 'manual' });
async function closeApp() {
  await post('close');
  await waitFor(async () => !(await (await fetch(`${control}/status`)).json()).running, 'Close test application', 30000);
}
async function connectPage() {
  const target = await waitFor(async () => {
    const pages = await (await fetch('http://127.0.0.1:39217/json/list')).json();
    return pages.find((page) => page.type === 'page' && /^http:\/\/(?:localhost|127\.0\.0\.1):/.test(page.url));
  }, 'Packaged application page');
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(JSON.stringify(message.error))); else resolve(message.result);
  };
  return {
    call(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++sequence;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close: () => socket.close(),
  };
}
const state = async () => JSON.parse(await fs.readFile(path.join(os.homedir(), '.piecemaker-maj-test/app-data/ui-updates', runtime, 'state.json')));
async function launch(label, expectedCurrent, expectedPending, banner) {
  await post('start');
  const page = await connectPage();
  try {
    await waitFor(async () => {
      const value = (await page.call('Runtime.evaluate', { expression: '({ready:document.getElementById("root")?.childElementCount>0,text:document.body.innerText})', returnByValue: true })).result?.value;
      const current = await state();
      const active = current.current ? JSON.parse(current.current.payload).sequence : 0;
      const pending = current.pending ? JSON.parse(current.pending.payload).sequence : 0;
      return value?.ready && !current.trial && active === expectedCurrent && pending === expectedPending && (!banner || value.text.includes('TEST MAJ :'));
    }, label);
    if (process.env.PIECEMAKER_EXPECT_BLUE && banner) {
      const result = await page.call('Runtime.evaluate', { expression: `(() => {
        const button = document.getElementById('piecemaker-test-maj-blue');
        if (!button || button.getBoundingClientRect().width < 200 || getComputedStyle(button).backgroundColor !== 'rgb(0, 102, 255)') return false;
        button.click();
        return button.textContent === 'MAJ DISTANTE OK !';
      })()`, returnByValue: true });
      assert.equal(result.result?.value, true, 'Visible blue update button responds to clicks');
    }
    const screenshot = await page.call('Page.captureScreenshot');
    await fs.writeFile(path.join(output, `${label}.png`), Buffer.from(screenshot.data, 'base64'));
    console.log(`PACKAGED PASS ${label}`);
  } finally { page.close(); }
}

try {
  control = await waitFor(() => log.match(/Console de test : (http:\/\/127\.0\.0\.1:39148\/[a-f0-9]+)/)?.[1], 'Local test controller', 10000);
  await launch('01-download', 0, 1, false);
  await closeApp();
  await launch('02-activate', 1, 0, true);
  await post('broken');
  await closeApp();
  await launch('03-stage-broken', 1, 2, true);
  await closeApp();
  await launch('04-rollback', 1, 0, true);
  assert.ok(log.includes('Retour automatique à la dernière interface valide'));
  await closeApp();
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ installed: true, nativeAndServerVerifiedSeparately: true, downloaded: true, activated: true, rollback: true, runtime }, null, 2));
} finally {
  if (control) await closeApp().catch(() => {});
  controller.kill();
  await fs.writeFile(path.join(output, 'verification.log'), log);
}
