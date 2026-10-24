import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

async function runWindowsSource(options) {
  const mutations = [];
  const failures = [];
  const context = createContext({ process: { argv: ['node', 'install.mjs', ...options], env: {}, chdir: () => mutations.push('chdir') }, console: { log() {} } });
  const called = name => async () => { mutations.push(name); return 'C:\\Apps\\PieceMaker'; };
  const mocks = {
    'node:fs/promises': { default: { mkdir: called('mkdir'), writeFile: called('writeFile') } },
    './build.mjs': { buildDesktopApp: called('build'), downloadPrebuiltApp: called('download') },
    './prebuilt-app.mjs': { verifyBuiltApp: called('verify'), verifyMacBundleLinks: called('verify-links') },
    './certificates.mjs': { generateCertificates: called('certificates'), isCaTrusted: () => true, signApplication: called('sign'), trustCertificateAuthority: called('trust') },
    './place.mjs': { createShortcuts: called('shortcuts'), installApplication: called('install'), launchApplication: called('launch'), quitRunningApplication: called('quit'), registerWindowsUninstall: called('registry') },
    './progress.mjs': { finishProgress() {}, openProgressWindow: called('progress'), settleProgressWindow() {} },
    './ui.mjs': { ui: { step() {}, ok() {}, warn() {}, fail: message => failures.push(message) } },
    './paths.mjs': { IS_MAC: false, IS_WINDOWS: true, PRODUCT_NAME: 'PieceMaker', bootstrapHome: 'C:\\Fixture', certsDir: 'C:\\Fixture\\certs', releaseTag: 'v2.0.47', releaseRepo: 'Example/Product', sourceDir: 'C:\\Fixture\\source' },
    '../composants/install.mjs': { installRuntimeComponents: called('components') },
  };
  const synthetic = values => new SyntheticModule(Object.keys(values), function () {
    for (const [name, value] of Object.entries(values)) this.setExport(name, value);
  }, { context });
  const source = await fs.readFile(new URL('./install.mjs', import.meta.url), 'utf8');
  const entry = new SourceTextModule(source, { context, importModuleDynamically: async specifier => {
    const module = synthetic(mocks[specifier]);
    await module.link(() => {});
    await module.evaluate();
    return module;
  } });
  await entry.link(specifier => synthetic(mocks[specifier]));
  await entry.evaluate();
  return { mutations, failures, exitCode: context.process.exitCode };
}

for (const options of [[], ['--build-from-source']]) {
  test(`Windows source entry rejects an installation without NSIS before changing the machine (${options.join(' ') || 'legacy archive'})`, async () => {
    const result = await runWindowsSource(options);
    assert.equal(result.exitCode, 1);
    assert.match(result.failures[0], /installateur Windows NSIS/);
    assert.deepEqual(result.mutations, []);
  });
}
