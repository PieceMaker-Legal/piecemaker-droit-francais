import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { componentLayout, createHost, installRuntimeComponents, scriptsDirectory, supersededPythonDirectories } from './install.mjs';
import { sharedPythonMarker, sharedPythonFingerprint, sharedPythonEntrypoints, sharedPythonProbe, requirementsForPlatform } from './shared-python.mjs';

test('the managed Python runtime no longer installs or probes the replaced Vibe agent', async () => {
  for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64']]) {
    assert.doesNotMatch(await fs.readFile(requirementsForPlatform(platform, arch), 'utf8'), /^mistral-vibe==/m);
  }
  assert.doesNotMatch(sharedPythonProbe, /vibe/);
});

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

test('installing a runtime removes older runtimes and the legacy venv but keeps the previous one', async t => {
  const platform = process.platform === 'win32' ? 'win32' : 'darwin';
  const arch = platform === 'win32' ? 'x64' : 'arm64';
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-prune-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'source');
  const home = path.join(root, 'home');
  const scripts = scriptsDirectory(source);
  const runtimeBin = hash => path.join(home, 'runtime-python', hash.slice(0, 24), 'python', ...(platform === 'win32' ? ['python.exe'] : ['bin', 'python3']));
  const sha256 = 'a'.repeat(64);
  const requirementsSha256 = await sharedPythonFingerprint(platform, arch);
  const python = runtimeBin(sha256);
  const previous = runtimeBin('b'.repeat(64));
  const older = runtimeBin('c'.repeat(64));
  for (const interpreter of [python, previous, older]) {
    await fs.mkdir(path.dirname(interpreter), { recursive: true });
    await fs.writeFile(interpreter, '');
  }
  await fs.writeFile(path.join(path.dirname(python), sharedPythonMarker), JSON.stringify({ format: 1, requirementsSha256 }));
  await fs.mkdir(path.join(home, 'venv', 'bin'), { recursive: true });
  await fs.mkdir(path.join(home, 'python'), { recursive: true });
  await fs.mkdir(scripts, { recursive: true });
  await fs.writeFile(path.join(scripts, 'requirements.txt'), 'markitdown');
  await fs.writeFile(path.join(scripts, 'warmup.py'), '');
  await fs.writeFile(path.join(home, 'config.json'), JSON.stringify({ pythonPath: previous }));
  const host = createHost();
  host.fetch = () => { throw new Error('Unexpected download'); };
  host.run = async () => ({ code: 0, stdout: JSON.stringify({ dependencies: { markitdown: true, pypdf: true } }), stderr: '' });
  const metadata = { repository: 'example/example', releaseTag: 'v1.0.0', assetName: `piecemaker-python-${platform}-${arch}.tar.gz`, sha256, requirementsSha256 };
  await installRuntimeComponents({ sourceDir: source, env: { PIECEMAKER_HOME: home }, host, platform, arch, requirePrebuilt: true, runtimeMetadata: metadata, output: { step() {}, ok() {} } });
  assert.deepEqual((await fs.readdir(path.join(home, 'runtime-python'))).sort(), ['a'.repeat(24), 'b'.repeat(24)]);
  await assert.rejects(fs.access(path.join(home, 'venv')));
  await assert.rejects(fs.access(path.join(home, 'python')));
});

test('the legacy venv survives while it is the previous interpreter', () => {
  const layout = componentLayout({ PIECEMAKER_HOME: '/donnees' }, '/Users/ada');
  const current = path.join('/donnees', 'runtime-python', 'a'.repeat(24), 'python', 'bin', 'python3');
  const legacy = path.join('/donnees', 'venv', 'bin', 'python');
  assert.deepEqual(supersededPythonDirectories(layout, ['a'.repeat(24), 'c'.repeat(24)], [current, legacy]), [path.join('/donnees', 'runtime-python', 'c'.repeat(24))]);
});

test('Windows keeps the configured interpreter whatever the path casing', { skip: process.platform !== 'win32' }, () => {
  const layout = componentLayout({ PIECEMAKER_HOME: 'c:\\Donnees' }, 'c:\\Users\\ada');
  const current = path.join('C:\\DONNEES', 'runtime-python', 'a'.repeat(24), 'python', 'python.exe');
  assert.deepEqual(supersededPythonDirectories(layout, ['a'.repeat(24)], [current]).filter(directory => directory.includes('runtime-python')), []);
});

async function launcherFixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pm-entrypoints-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runtime = path.join(root, 'build with spaces');
  const host = createHost();
  const basePython = process.platform === 'win32' ? 'python' : 'python3';
  const created = await host.run(basePython, ['-m', 'venv', runtime], { capture: true });
  assert.equal(created.code, 0, created.stderr);
  const python = path.join(runtime, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const located = await host.run(python, ['-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'], { capture: true });
  assert.equal(located.code, 0, located.stderr);
  const library = located.stdout.trim();
  const metadata = path.join(library, 'example_cli-1.0.dist-info');
  await fs.mkdir(metadata);
  await fs.writeFile(path.join(metadata, 'METADATA'), 'Metadata-Version: 2.1\nName: example-cli\nVersion: 1.0\n');
  await fs.writeFile(path.join(metadata, 'entry_points.txt'), '[console_scripts]\nexample-cli = example_cli:main\n');
  await fs.writeFile(path.join(library, 'example_cli.py'), 'import sys\ndef main():\n    print(sys.executable)\n');
  const launcher = path.join(runtime, process.platform === 'win32' ? 'Scripts/example-cli.exe' : 'bin/example-cli');
  const run = async (code = sharedPythonEntrypoints, interpreter = python) => {
    const result = await host.run(interpreter, ['-c', code], { capture: true });
    assert.equal(result.code, 0, result.stderr);
    return result;
  };
  const execute = async (command = launcher, interpreter = python) => {
    const result = await host.run(command, [], { capture: true });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout.trim(), interpreter);
  };
  return { root, runtime, python, launcher, run, execute };
}

test('Python launchers remain valid without unnecessary mutations', async t => {
  const fixture = await launcherFixture(t);
  await fixture.run();
  await fixture.execute();
  const rejectLauncherMutation = (launcher) => `
import os,sys
launcher = ${JSON.stringify(launcher)}
def reject_mutation(event,args):
    if event == "open" and args[0] == launcher and args[2] & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC):
        raise RuntimeError("Unexpected launcher write")
    if event in ("os.remove","os.chmod") and args[0] == launcher:
        raise RuntimeError("Unexpected launcher mutation")
sys.addaudithook(reject_mutation)
`;
  await t.test('unchanged launchers are neither rewritten nor chmodded', async () => {
    await fixture.run(rejectLauncherMutation(fixture.launcher) + sharedPythonEntrypoints);
  });
  await t.test('Windows launcher ZIP timestamps are deterministic', async () => {
    const simulateWindowsLauncher = process.platform === 'win32' ? '' : `
from pip._vendor.distlib.scripts import ScriptMaker
original_init = ScriptMaker.__init__
def windows_init(self,*args,**kwargs):
    original_init(self,*args,**kwargs)
    self._is_nt = True
    self.set_mode = False
    self._get_launcher = lambda kind: b"MZexample"
ScriptMaker.__init__ = windows_init
`;
    const launcher = process.platform === 'win32' ? fixture.launcher : fixture.launcher + '.exe';
    await fixture.run(simulateWindowsLauncher + sharedPythonEntrypoints);
    await fixture.run(rejectLauncherMutation(launcher) + simulateWindowsLauncher + sharedPythonEntrypoints);
    await fixture.run(`import zipfile; assert zipfile.ZipFile(${JSON.stringify(launcher)}).getinfo("__main__.py").date_time == (1980,1,1,0,0,0)`);
  });
  await t.test('missing, corrupted and non-executable launchers are repaired', async () => {
    await fs.rm(fixture.launcher);
    await fixture.run();
    await fixture.execute();
    await fs.chmod(fixture.launcher, 0o755);
    await fs.writeFile(fixture.launcher, 'invalid launcher');
    await fixture.run();
    await fixture.execute();
    if (process.platform !== 'win32') {
      await fs.chmod(fixture.launcher, 0o644);
      await fixture.run();
      await fixture.execute();
    }
  });
  await t.test('launchers use the relocated interpreter in a path with spaces', async () => {
    const relocated = path.join(fixture.root, 'installed with spaces');
    await fs.rename(fixture.runtime, relocated);
    const python = path.join(relocated, path.relative(fixture.runtime, fixture.python));
    const launcher = path.join(relocated, path.relative(fixture.runtime, fixture.launcher));
    await fixture.run(sharedPythonEntrypoints, python);
    await fixture.execute(launcher, python);
    assert.equal((await fs.readFile(launcher)).includes(Buffer.from(fixture.python)), false);
  });
});
