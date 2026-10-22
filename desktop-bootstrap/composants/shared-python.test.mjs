import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHost, installRuntimeComponents, scriptsDirectory } from './install.mjs';
import { sharedPythonMarker, sharedPythonFingerprint, sharedPythonEntrypoints } from './shared-python.mjs';

for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64']]) {
  test(`${platform}: managed releases replace legacy Python and reuse the verified runtime without pip`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-shared-test-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const source = path.join(root, 'source');
    const home = path.join(root, 'home with spaces');
    const scripts = scriptsDirectory(source);
    const sha256 = 'a'.repeat(64);
    const requirementsSha256 = await sharedPythonFingerprint(platform, arch);
    const runtime = path.join(home, 'runtime-python', sha256.slice(0, 24), 'python');
    const python = platform === 'win32' ? path.join(runtime, 'python.exe') : path.join(runtime, 'bin', 'python3');
    await fs.mkdir(scripts, { recursive: true });
    await fs.mkdir(path.dirname(python), { recursive: true });
    await fs.writeFile(python, '');
    await fs.writeFile(path.join(path.dirname(python), sharedPythonMarker), JSON.stringify({ format: 1, requirementsSha256 }));
    await fs.writeFile(path.join(scripts, 'requirements.txt'), 'markitdown');
    await fs.writeFile(path.join(scripts, 'warmup.py'), '');
    const metadata = { repository: 'example/example', releaseTag: 'v1.0.0', assetName: `piecemaker-python-${platform}-${arch}.tar.gz`, sha256, requirementsSha256 };
    if (platform === 'win32') await fs.writeFile(path.join(source, 'python-runtime.json'), JSON.stringify(metadata));
    await fs.writeFile(path.join(home, 'config.json'), JSON.stringify({ pythonPath: '/legacy/python', venvPath: '/legacy', setting: true }));
    const host = createHost();
    const calls = [];
    host.fetch = () => { throw new Error('Unexpected download'); };
    host.run = async (command, args) => {
      calls.push([command, ...args]);
      assert.equal(command, python);
      assert.ok(!args.includes('pip'));
      return { code: 0, stdout: JSON.stringify({ dependencies: { markitdown: true, pypdf: true } }), stderr: '' };
    };
    const options = { sourceDir: source, env: { PIECEMAKER_HOME: home }, host, platform, arch, requirePrebuilt: true, runtimeMetadata: platform === 'darwin' ? metadata : undefined, output: { step() {}, ok() {} } };
    await assert.rejects(installRuntimeComponents({ ...options, runtimeMetadata: { ...metadata, assetName: 'wrong-platform.tar.gz' } }), /Metadonnees Python invalides/);
    await installRuntimeComponents(options);
    const config = JSON.parse(await fs.readFile(path.join(home, 'config.json')));
    assert.equal(config.pythonPath, python);
    assert.equal(config.pythonRuntime.kind, 'shared');
    assert.equal(config.setting, true);
    assert.ok(calls.some(call => call.includes(sharedPythonEntrypoints)));
    await installRuntimeComponents(options);
    await fs.writeFile(path.join(path.dirname(python), sharedPythonMarker), JSON.stringify({ format: 1, requirementsSha256: 'b'.repeat(64) }));
    await assert.rejects(installRuntimeComponents(options), /Unexpected download/);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(home, 'config.json'))), config);
  });
}
