import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ensureRuntimeComponents } from '../../../../desktop-bootstrap/overlay/electron-piecemaker/runtime-components.mjs';
import { configureRuntimeEnvironment } from '../../../../desktop-bootstrap/overlay/electron-piecemaker/asar-runtime.mjs';

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
const runtimeManifest = JSON.parse(await fs.readFile(path.join(root, 'runtime-components.json'), 'utf8'));
const runtime = await ensureRuntimeComponents({
  manifest: runtimeManifest,
  cacheRoot: path.join(directory, 'runtime-components'),
  assetDir: path.join(path.dirname(executable), 'resources', 'validation-assets'),
});
const sdkEnvironment = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
configureRuntimeEnvironment({ packedRoot: root.replace(/\.unpacked$/, ''), physicalRoot: root, moduleRoots: runtime.moduleRoots, environment: sdkEnvironment });
const sdkProbe = pathToFileURL(path.join(root, 'electron-piecemaker/validation-sdk-probe.mjs')).href;
const sdkVerification = JSON.parse(execFileSync(executable, ['--input-type=module', '-e', `const {verifyMistralSdk}=await import(${JSON.stringify(sdkProbe)});console.log(JSON.stringify(await verifyMistralSdk(${JSON.stringify(root)})));`], {
  env: sdkEnvironment, encoding: 'utf8', timeout: 30000,
}));
assert.equal(sdkVerification.tools, true);
await fs.writeFile(path.join(output, 'mistral-sdk-verification.json'), JSON.stringify(sdkVerification, null, 2));
const buildMetadata = JSON.parse(await fs.readFile(path.join(root, 'electron-piecemaker/validation-build.json'), 'utf8'));
assert.equal(buildMetadata.revision, process.env.GITHUB_SHA);
assert.equal(buildMetadata.provider, 'mistral-sdk');
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
let debugPort = 39218;
async function start() {
  const port = debugPort++;
  child = spawn(executable, [`--remote-debugging-port=${port}`], { env: { ...process.env, PIECEMAKER_VALIDATION_DIAGNOSTICS: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const capture = (chunk) => { log += chunk; process.stdout.write(chunk); };
  child.on('exit', (code, signal) => capture(`[Validation] process exit ${code} ${signal}\n`));
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  const target = await waitFor(async () => {
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) })).json();
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
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Interface command timed out: ${method}`)); }, 20000);
        pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
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
  const mistralAccount = await evaluate(page, `(async () => {
    const headers = { Authorization: 'Bearer ' + localStorage.getItem('auth-token') };
    const status = await fetch('/api/piecemaker/mistral-sdk/provider-status', { headers });
    const value = await status.json();
    const check = await fetch('/api/piecemaker/mistral-sdk/auth/check', { method: 'POST', headers });
    return { statusCode: status.status, installed: value.data?.installed, authenticated: value.data?.authenticated, method: value.data?.method, checkStatus: check.status };
  })()`);
  assert.deepEqual(mistralAccount, { statusCode: 200, installed: true, authenticated: false, method: 'browser', checkStatus: 401 });
  await fs.writeFile(path.join(output, 'mistral-sdk-verification.json'), JSON.stringify({ ...sdkVerification, accountSettingsApi: true, connectionRequired: true }, null, 2));
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
  let gliner;
  let lastGlinerState = '';
  const glinerStarted = Date.now();
  while (Date.now() - glinerStarted < 1200000) {
    const state = await evaluate(page, `(async () => {
      const headers = { Authorization: 'Bearer ' + localStorage.getItem('auth-token') };
      const [configuration, installation] = await Promise.all([
        fetch('/api/piecemaker/configuration', { headers }),
        fetch('/api/piecemaker/configuration/install', { headers }),
      ]);
      if (!configuration.ok || !installation.ok) throw Error('GLiNER status unavailable');
      return { component: (await configuration.json()).components.gliner, installation: await installation.json() };
    })()`);
    await fs.writeFile(path.join(output, 'gliner-installation-state.json'), JSON.stringify(state, null, 2));
    const progress = JSON.stringify(state);
    if (progress !== lastGlinerState) console.log(`[Validation GLiNER] ${progress}`);
    lastGlinerState = progress;
    const job = state.installation.jobs.find(job => job.component === 'gliner');
    if (job?.state === 'failed') throw new Error(`Automatic GLiNER installation failed: ${job.error}`);
    if (state.component?.installed) { gliner = state.component; break; }
    if (job?.state === 'done') throw new Error(`GLiNER installation reported success but its library or pinned model is missing: ${job.progress}`);
    if (!job && Date.now() - glinerStarted > 120000) throw new Error('Automatic GLiNER installation did not start.');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.ok(gliner?.installed, 'Automatic GLiNER library and model installation timed out.');
  const pythonConfig = JSON.parse(await fs.readFile(path.join(clientComponents, 'config.json')));
  const glinerScripts = path.join(root, 'server/piecemaker/vendor/websocket-server/scripts/presidio-gliner');
  const glinerProbe = [
    'from gliner2 import GLiNER2',
    'from model_config import gliner_snapshot_directory',
    'model = GLiNER2.from_pretrained(gliner_snapshot_directory(), local_files_only=True, map_location="cpu")',
    'result = model.extract_entities("Jean Dupont lives in Paris.", ["person", "location"])',
    'assert isinstance(result.get("entities"), dict), result',
    'print("GLINER_LOCAL_INFERENCE_PASS")',
  ].join('\n');
  const glinerOutput = execFileSync(pythonConfig.pythonPath, ['-c', glinerProbe], {
    cwd: glinerScripts, encoding: 'utf8', timeout: 300000,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  assert.match(glinerOutput, /GLINER_LOCAL_INFERENCE_PASS/);
  execFileSync(pythonConfig.pythonPath, ['-m', 'unittest', 'discover', '-s', 'server/piecemaker/vendor/mcp/legifrance/tests', '-p', 'test_justice_maintenance.py'], { stdio: 'inherit', timeout: 30000 });
  await fs.writeFile(path.join(output, 'gliner-verification.json'), JSON.stringify({ installed: gliner.installed, model: gliner.model, localInference: true }, null, 2));
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
  assert.equal(await evaluate(page, 'setTimeout(() => window.piecemakerDesktop.uninstall(), 100); true'), true);
  page.close();
  await waitFor(async () => {
    try { await fs.access(executable); return false; } catch (error) { if (error.code === 'ENOENT') return child.exitCode !== null; throw error; }
  }, 'Native validation uninstaller', 90000);
  assert.equal(await fs.readFile(preserved, 'utf8'), 'untouched');
  await fs.access(path.join(directory, 'app-data/auth.db'));
  const installerName = (await fs.readdir(output)).find(name => /^PieceMaker-Validation-.*\.exe$/.test(name));
  assert.ok(installerName, 'Validation installer required for reinstall');
  execFileSync(path.join(output, installerName), ['/S', `/D=${path.dirname(executable)}`], { stdio: 'inherit', timeout: 120000 });
  await fs.access(executable);
  page = await start();
  await waitFor(() => evaluate(page, 'document.getElementById("root")?.childElementCount > 0 && Boolean(localStorage.getItem("auth-token"))'), 'Authenticated interface after native reinstall');
  await waitFor(async () => { const value = await evaluate(page, statusExpression); return value.enabled && value.listening; }, 'Proxy after native reinstall');
  await stop(page);
  await fs.writeFile(path.join(output, 'installation-verification.json'), JSON.stringify({ installed: true, initialInterface: true, remoteChannelEmbedded: config.feed, updateNotPublished: true, accountCreated: true, sessionRetained: true, authenticatedInterfaceRendered: true, onboardingCompletedThroughUI: true, localCertificateGenerated: true, localCertificateTrusted: true, certificateConsentPreapprovedOnDisposableRunner: true, glinerInstalled: gliner.installed, glinerLocalInference: true, anonymizerActive: status.enabled && restarted.enabled, nativeUninstallVerified: true, productionDataUntouched: true, runtime: config.runtime }, null, 2));
  await fs.writeFile(path.join(output, 'reinstallation-verification.json'), JSON.stringify({ nativeReinstall: true, sessionRetained: true, proxyActive: true, productionDataUntouched: await fs.readFile(preserved, 'utf8') === 'untouched' }, null, 2));
  console.log('FULL INSTALLATION PASS: embedded remote channel, SDK tools, fresh local CA, active proxy, account, restart and native reinstall; no UI update published.');
} finally {
  if (page && child?.exitCode === null) {
    await evaluate(page, '({url:location.href,text:document.body.innerText,buttons:[...document.querySelectorAll("button")].map(b=>({text:b.innerText,disabled:b.disabled}))})').then((value) => fs.writeFile(path.join(output, 'interface-diagnostic.json'), JSON.stringify(value, null, 2))).catch(() => {});
  }
  if (page && child?.exitCode === null) await stop(page).catch(() => {});
  await fs.writeFile(path.join(output, 'installation-verification.log'), log);
}
process.exit(0);
