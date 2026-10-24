import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

function synthetic(context, values) {
  return new SyntheticModule(Object.keys(values), function () {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context });
}

test('shipped Mac preparation loads without the repository build toolchain and rejects an incomplete bundle before certificates', { skip: process.platform !== 'darwin' }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-installed-mac-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bundle = path.join(root, 'PieceMaker.app');
  const appRoot = path.join(bundle, 'Contents/Resources/app');
  const lib = path.join(appRoot, 'desktop-bootstrap/lib');
  await fs.cp(new URL('.', import.meta.url), lib, { recursive: true, filter: source => !source.endsWith('.test.mjs') && !source.endsWith('/build.mjs') });
  const result = spawnSync(process.execPath, [path.join(lib, 'install.mjs'), '--no-launch', '--no-progress'], {
    encoding: 'utf8',
    env: { ...process.env, PIECEMAKER_SRC_DIR: appRoot, PIECEMAKER_HOME: path.join(root, 'home'), PIECEMAKER_BOOTSTRAP_HOME: path.join(root, 'bootstrap'), PIECEMAKER_PREBUILT_APP_PATH: bundle },
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /Application construite incomplète/);
  assert.equal(await fs.stat(path.join(root, 'home/certs')).then(() => true, () => false), false);
});

async function assertMacPrecompiledPreparation(certificate) {
  const calls = [];
  const env = { ELECTRON_RUN_AS_NODE: '1', PIECEMAKER_PREBUILT_APP_PATH: '/fixture/prebuilt/PieceMaker.app' };
  const context = createContext({
    process: { argv: ['node', 'install.mjs', '--no-progress', ...(certificate === 'skipped' ? ['--no-certificate'] : [])], arch: 'arm64', env, chdir() {} },
    console: { log() {} },
    fetch: async () => ({ ok: true, json: async () => ({ fixture: 'python-metadata' }) }),
  });
  const called = name => async (...args) => { calls.push({ name, args }); return name === 'install' ? '/Applications/PieceMaker.app' : undefined; };
  const mocks = {
    'node:fs/promises': { default: { mkdir: called('mkdir') } },
    './prebuilt-app.mjs': { verifyBuiltApp: called('verify'), verifyMacBundleLinks: called('links') },
    './certificates.mjs': { generateCertificates: called('certificates'), isCaTrusted: () => certificate === 'trusted', signApplication: called('sign'), trustCertificateAuthority: async () => {
      await called('trust')();
      if (certificate === 'failed') throw new Error('fixture trust failure');
      return certificate === 'approved';
    } },
    './place.mjs': { installApplication: called('install'), launchApplication: called('launch'), quitRunningApplication: called('quit') },
    './progress.mjs': { finishProgress() {}, openProgressWindow: called('progress'), settleProgressWindow: async ({ launch }) => launch?.() },
    './ui.mjs': { ui: { step() {}, ok() {}, warn() {}, fail(message) { throw new Error(message); } } },
    './paths.mjs': { IS_MAC: true, IS_WINDOWS: false, PRODUCT_NAME: 'PieceMaker', bootstrapHome: '/fixture/bootstrap', certsDir: '/fixture/certs', releaseTag: 'fixture-release', releaseRepo: 'Example/Product', sourceDir: '/fixture/prebuilt/PieceMaker.app/Contents/Resources/app' },
    '../composants/install.mjs': { installRuntimeComponents: called('python') },
  };
  const entry = new SourceTextModule(await fs.readFile(new URL('./install.mjs', import.meta.url), 'utf8'), {
    context,
    importModuleDynamically: async specifier => {
      assert.notEqual(specifier, './build.mjs');
      const module = synthetic(context, mocks[specifier]);
      await module.link(() => {});
      await module.evaluate();
      return module;
    },
  });
  await entry.link(specifier => synthetic(context, mocks[specifier]));
  await entry.evaluate();
  const signed = certificate === 'trusted' || certificate === 'approved';
  const prompted = certificate !== 'trusted' && certificate !== 'skipped';
  assert.deepEqual(calls.map(call => call.name), ['mkdir', 'links', 'verify', 'certificates', 'python', 'quit', 'install', ...(prompted ? ['trust'] : []), ...(signed ? ['sign'] : []), 'launch']);
  assert.equal(calls.find(call => call.name === 'python').args[0].requirePrebuilt, true);
  assert.equal(calls.find(call => call.name === 'python').args[0].sourceDir, mocks['./paths.mjs'].sourceDir);
  if (signed) assert.equal(calls.find(call => call.name === 'sign').args[0], '/Applications/PieceMaker.app');
  assert.equal(calls.find(call => call.name === 'launch').args[0], '/Applications/PieceMaker.app');
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
}

for (const certificate of ['trusted', 'approved', 'refused', 'failed', 'skipped']) {
  test(`Mac precompiled preparation preserves installation and signing order with certificate ${certificate}`, () => assertMacPrecompiledPreparation(certificate));
}

for (const other of [false, true]) {
  test(`Mac quit detection ignores the embedded bootstrap itself${other ? ' and still detects an installed application' : ''}`, async () => {
    let quits = 0;
    let probes = 0;
    const context = createContext({ process: { pid: 101 }, setTimeout: callback => callback(), Date });
    const mocks = {
      'node:fs/promises': { default: {} },
      'node:path': { default: path },
      './shell.mjs': { capture: () => ({ code: 0, stdout: ++probes === 1 && other ? '101\n202' : '101' }), mustCapture() {}, osascript: () => { quits++; } },
      './ui.mjs': { ui: { step() {}, ok() {} } },
      './paths.mjs': { IS_MAC: true, PRODUCT_NAME: 'PieceMaker', installTargetCandidates() {} },
    };
    const entry = new SourceTextModule(await fs.readFile(new URL('./place.mjs', import.meta.url), 'utf8'), { context });
    await entry.link(specifier => synthetic(context, mocks[specifier]));
    await entry.evaluate();
    await entry.namespace.quitRunningApplication();
    assert.equal(quits, other ? 1 : 0);
  });
}
