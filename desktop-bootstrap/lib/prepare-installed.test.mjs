import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

for (const certificate of ['trusted', 'approved', 'refused', 'skipped', 'failed']) {
  test(`Windows installed preparation preserves certificate checks and components with certificate ${certificate}`, async () => {
    const calls = [];
    const called = name => async () => { calls.push(name); };
    const context = createContext({ process: { argv: ['node'], env: { LOCALAPPDATA: 'C:\\Fixture' } }, console: { log() {} } });
    const mocks = {
      'node:fs/promises': { default: { readFile: async file => {
        assert.equal(file, path.join('C:\\Fixture\\app', 'runtime-components.json'));
        calls.push('manifest');
        return '{}';
      } } },
      'node:path': { default: path },
      'node:url': { fileURLToPath },
      './certificates.mjs': {
        generateCertificates: called('generate'),
        importPublisherCertificate: () => calls.push('publisher'),
        isCaTrusted: () => { calls.push('check'); return certificate === 'trusted'; },
        trustCertificateAuthority: async () => {
          calls.push('trust');
          if (certificate === 'failed') throw new Error('fixture trust failure');
          return certificate === 'approved';
        },
      },
      '../composants/install.mjs': { installRuntimeComponents: called('python') },
      '../../electron-piecemaker/runtime-components.mjs': { ensureRuntimeComponents: called('providers') },
      './paths.mjs': { sourceDir: 'C:\\Fixture\\app' },
    };
    const entry = new SourceTextModule(await fs.readFile(new URL('./prepare-installed.mjs', import.meta.url), 'utf8'), { context });
    await entry.link(specifier => new SyntheticModule(Object.keys(mocks[specifier]), function () {
      for (const [name, value] of Object.entries(mocks[specifier])) this.setExport(name, value);
    }, { context }));
    await entry.evaluate();
    const preparation = entry.namespace.prepareInstalledDesktop({ skipCertificateTrust: certificate === 'skipped' });
    if (certificate === 'failed') {
      await assert.rejects(preparation, /fixture trust failure/);
      assert.deepEqual(calls, ['generate', 'publisher', 'check', 'trust']);
      return;
    }
    await preparation;
    assert.deepEqual(calls, [
      'generate', 'publisher',
      ...(certificate === 'skipped' ? [] : ['check']),
      ...(['approved', 'refused'].includes(certificate) ? ['trust'] : []),
      'manifest', 'providers', 'python',
    ]);
  });
}
