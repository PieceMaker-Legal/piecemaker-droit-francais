import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';

const executable = path.resolve(process.argv[2]);
const output = path.resolve(process.env.PIECEMAKER_TEST_OUTPUT);
const root = path.join(path.dirname(executable), 'resources/app.asar.unpacked');
const directory = path.join(os.homedir(), '.piecemaker-validation');
const product = JSON.parse(await fs.readFile(path.join(root, 'product.config.json')));
assert.equal(product.appId, 'legal.piecemaker.validation');
assert.equal(product.dataDirectoryName, '.piecemaker-validation');
assert.equal(path.basename(executable), 'PieceMakerValidation.exe');
const config = JSON.parse(await fs.readFile(path.join(root, 'electron-piecemaker/ui-update-runtime.json')));
assert.equal(config.feed, `https://github.com/PieceMaker-Legal/piecemaker-droit-francais/releases/download/validation-ui-${config.runtime}`);
assert.equal((await fetch(`${config.feed}/ui-update.json`)).status, 404, 'Step 2 must not be published yet');
let child;
let log = '';
const clientComponents = path.join(directory, 'components');
const certificateModule = path.join(root, 'desktop-bootstrap/lib/certificates.mjs');
execFileSync(executable, ['--input-type=module', '-e', `const {generateCertificates}=await import(${JSON.stringify(new URL('file:///' + certificateModule.replaceAll('\\', '/')).href)});await generateCertificates();`], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PIECEMAKER_HOME: clientComponents }, stdio: 'inherit', timeout: 120000,
});
for (const certificate of [path.join(root, 'desktop-bootstrap/certs/piecemaker-publisher.cer'), path.join(clientComponents, 'certs/piecemaker-ca.crt')]) {
  execFileSync('certutil.exe', ['-f', '-addstore', 'Root', certificate], { stdio: 'inherit', timeout: 30000 });
}
execFileSync('certutil.exe', ['-f', '-addstore', 'TrustedPublisher', path.join(root, 'desktop-bootstrap/certs/piecemaker-publisher.cer')], { stdio: 'inherit', timeout: 30000 });
async function waitFor(action, name, timeout = 240000) {
  const deadline = Date.now() + timeout;
  let error;
  while (Date.now() < deadline) {
    try { const value = await action(); if (value) return value; } catch (caught) { error = caught; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${name} timed out: ${error?.message || ''}\n${log.slice(-12000)}`);
}
async function start() {
  child = spawn(executable, ['--remote-debugging-port=39218'], { env: { ...process.env, PIECEMAKER_VALIDATION_DIAGNOSTICS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const capture = (chunk) => { log += chunk; process.stdout.write(chunk); };
  child.on('exit', (code, signal) => capture(`[Validation] process exit ${code} ${signal}\n`));
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const target = await waitFor(async () => {
    const pages = await (await fetch('http://127.0.0.1:39218/json/list', { signal: AbortSignal.timeout(3000) })).json();
    return pages.find((page) => page.type === 'page' && /^http:\/\/(?:localhost|127\.0\.0\.1):/.test(page.url));
  }, 'Installed full application');
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
async function evaluate(page, expression) {
  const result = await page.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result?.value;
}
async function stop(page) {
  page.close();
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p=Get-Process -Id ${child.pid} -ErrorAction SilentlyContinue; if($p){[void]$p.CloseMainWindow()}`]);
  await waitFor(() => child.exitCode !== null, 'Close full application', 30000);
}
let page;
try {
  page = await start();
  await waitFor(() => evaluate(page, 'document.getElementById("root")?.childElementCount > 0'), 'Initial interface');
  assert.equal(await evaluate(page, 'Boolean(document.getElementById("piecemaker-test-maj-blue"))'), false);
  const registered = await evaluate(page, `(async () => {
    const response = await fetch('/api/auth/register', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({username:'validation-exemple',password:'EssaiFictif2026!'}) });
    const value = await response.json();
    if (!response.ok || !value.token) throw Error('Test registration failed');
    localStorage.setItem('auth-token',value.token);
    const git = await fetch('/api/user/git-config', {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+value.token},body:JSON.stringify({gitName:'Jean Dupont',gitEmail:'jean.dupont@example.test'})});
    if (!git.ok) throw Error('Fictitious Git configuration failed');
    return value.success;
  })()`);
  assert.equal(registered, true);
  await page.call('Page.reload');
  const statusExpression = `(async () => {
    const token = localStorage.getItem('auth-token');
    const response = await fetch('/api/piecemaker/anonymizer/status',{headers:{Authorization:'Bearer '+token}});
    if (!response.ok) throw Error('Anonymizer status failed');
    return response.json();
  })()`;
  const status = await waitFor(async () => { const value = await evaluate(page, statusExpression); return value.enabled && value.listening && value; }, 'Active anonymization proxy');
  await waitFor(() => evaluate(page, 'document.getElementById("gitName")?.value === "Jean Dupont" && ![...document.querySelectorAll("button")].at(-1)?.disabled'), 'First-run Git configuration interface');
  await fs.writeFile(path.join(output, '00-onboarding.png'), Buffer.from((await page.call('Page.captureScreenshot')).data, 'base64'));
  await evaluate(page, '[...document.querySelectorAll("button")].at(-1).click()');
  await waitFor(() => evaluate(page, '!document.getElementById("gitName") && [...document.querySelectorAll("button")].length >= 3 && ![...document.querySelectorAll("button")].at(-1)?.disabled'), 'First-run provider connections interface');
  await evaluate(page, '[...document.querySelectorAll("button")].at(-1).click()');
  await waitFor(() => evaluate(page, `(async () => {
    const response=await fetch('/api/user/onboarding-status',{headers:{Authorization:'Bearer '+localStorage.getItem('auth-token')}});
    return (await response.json()).hasCompletedOnboarding;
  })()`), 'First-run setup completed through the interface');
  await waitFor(() => evaluate(page, 'document.querySelectorAll("button").length >= 3 && !document.querySelector("input[autocomplete=username]")'), 'Usable authenticated interface');
  await fs.writeFile(path.join(output, '01-installed.png'), Buffer.from((await page.call('Page.captureScreenshot')).data, 'base64'));
  const caFile = path.join(directory, 'components/certs/piecemaker-ca.crt');
  const localCA = new X509Certificate(await fs.readFile(caFile));
  const buildCA = new X509Certificate(await fs.readFile(path.join(process.env.PIECEMAKER_HOME, 'certs/piecemaker-ca.crt')));
  assert.notEqual(localCA.fingerprint256, buildCA.fingerprint256, 'The client CA must be generated on this installation');
  const trusted = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$t=(Get-Content -LiteralPath '${path.join(directory, 'components/certs/thumbprints.json').replaceAll("'", "''")}'|ConvertFrom-Json).ca; if(Test-Path "Cert:\\CurrentUser\\Root\\$t"){'yes'}`], { encoding: 'utf8' });
  assert.equal(trusted.trim(), 'yes');
  await stop(page);
  page = await start();
  await waitFor(() => evaluate(page, 'document.getElementById("root")?.childElementCount > 0 && Boolean(localStorage.getItem("auth-token"))'), 'Authenticated restart');
  const restarted = await waitFor(async () => { const value = await evaluate(page, statusExpression); return value.enabled && value.listening && value; }, 'Proxy after restart');
  const state = JSON.parse(await fs.readFile(path.join(directory, 'app-data/ui-updates', config.runtime, 'state.json')).catch((error) => { if (error.code === 'ENOENT') return '{"highest":0}'; throw error; }));
  assert.equal(state.highest, 0);
  assert.ok(!state.current && !state.pending && !state.trial);
  await waitFor(() => evaluate(page, 'document.querySelectorAll("button").length >= 3 && !document.querySelector("input[autocomplete=username]")'), 'Usable authenticated interface after restart');
  await fs.writeFile(path.join(output, '02-restarted.png'), Buffer.from((await page.call('Page.captureScreenshot')).data, 'base64'));
  const preserved = path.join(os.homedir(), '.piecemaker-droit-francais', 'validation-sentinel.txt');
  await fs.mkdir(path.dirname(preserved), { recursive: true });
  await fs.writeFile(preserved, 'untouched');
  const uninstall = await evaluate(page, 'window.piecemakerDesktop.uninstall()');
  assert.equal(uninstall.scheduled, true);
  page.close();
  await waitFor(async () => {
    try { await fs.access(executable); return false; } catch (error) { if (error.code === 'ENOENT') return child.exitCode !== null; throw error; }
  }, 'Native validation uninstaller', 90000);
  assert.equal(await fs.readFile(preserved, 'utf8'), 'untouched');
  await fs.access(path.join(directory, 'app-data/auth.db'));
  await fs.writeFile(path.join(output, 'installation-verification.json'), JSON.stringify({ installed: true, initialInterface: true, remoteChannelEmbedded: config.feed, updateNotPublished: true, accountCreated: true, sessionRetained: true, authenticatedInterfaceRendered: true, onboardingCompletedThroughUI: true, localCertificateGenerated: true, localCertificateTrusted: true, certificateConsentPreapprovedOnDisposableRunner: true, anonymizerActive: status.enabled && restarted.enabled, nativeUninstallVerified: true, productionDataUntouched: true, runtime: config.runtime }, null, 2));
  console.log('FULL INSTALLATION PASS: embedded remote channel, fresh local CA, active proxy, account and restart; no UI update published.');
} finally {
  if (page && child?.exitCode === null) await stop(page).catch(() => {});
  await fs.writeFile(path.join(output, 'installation-verification.log'), log);
}
