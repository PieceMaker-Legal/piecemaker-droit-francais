import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  bundledPythonPath,
  componentLayout,
  dependenciesReady,
  glinerReady,
  installRuntimeComponents,
  mergeRuntimeConfig,
  parsePythonVersion,
  parseStatus,
  pipelineModelsReady,
  pythonIsCompatible,
  pythonTriple,
  runtimeReady,
  scriptsDirectory,
  selectPythonAsset,
  systemPythonCandidates,
  venvPythonPath,
  venvScriptPath,
} from './install.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

function readyStatus() {
  return {
    ready: true,
    gliner2_runtime: { boundary_capable: true },
    dependencies: {
      gliner2: true,
      huggingface_hub: true,
      spacy: true,
      markitdown: true,
      pypdf: true,
    },
    tools: { mineru: true },
  };
}

function memoryHost(files = new Map()) {
  const commands = [];
  return {
    commands,
    files,
    async exists(target) {
      return files.has(target);
    },
    async readFile(target) {
      if (!files.has(target)) throw new Error(`absent ${target}`);
      return files.get(target);
    },
    async writeFile(target, content) {
      files.set(target, content);
    },
    async mkdir() {},
    async rm(target) {
      files.delete(target);
    },
    async run(command, args) {
      commands.push([command, ...args]);
      if (args[0] === '--version') {
        const version = files.get(`version:${command}`) || 'Python 3.9.0';
        return version ? { code: 0, stdout: version, stderr: '' } : { code: 1, stdout: '', stderr: '' };
      }
      if (args.at(-2) === '--status' || args[1] === '--status') {
        const status = files.get('warmup-status');
        return { code: status ? 0 : 1, stdout: status || '', stderr: '' };
      }
      if (args[0] === '-m' && args[1] === 'venv') files.set(args[2] && venvPythonPath(args[2], 'darwin'), '');
      return { code: 0, stdout: '', stderr: '' };
    },
    async fetch() {
      throw new Error('réseau inattendu');
    },
  };
}

test('choisit le Python 3.12 stripped de la bonne architecture', () => {
  const assets = [
    { name: 'cpython-3.12.8+20260901-aarch64-apple-darwin-install_only.tar.gz', browser_download_url: 'https://example/full', digest: 'sha256:aaa' },
    { name: 'cpython-3.12.11+20260901-aarch64-apple-darwin-install_only_stripped.tar.gz', browser_download_url: 'https://example/old', digest: 'sha256:bbb' },
    { name: 'cpython-3.12.12+20260901-aarch64-apple-darwin-install_only_stripped.tar.gz', browser_download_url: 'https://example/arm', digest: 'sha256:ccc' },
    { name: 'cpython-3.12.12+20260901-x86_64-pc-windows-msvc-install_only_stripped.tar.gz', browser_download_url: 'https://example/win', digest: 'sha256:ddd' },
    { name: 'cpython-3.13.1+20260901-aarch64-apple-darwin-install_only_stripped.tar.gz', browser_download_url: 'https://example/313', digest: 'sha256:eee' },
  ];
  assert.equal(selectPythonAsset(assets, 'darwin', 'arm64').browser_download_url, 'https://example/arm');
  assert.equal(selectPythonAsset(assets, 'win32', 'x64').browser_download_url, 'https://example/win');
  assert.equal(selectPythonAsset(assets, 'linux', 'x64'), null);
  assert.equal(pythonTriple('darwin', 'arm64'), 'aarch64-apple-darwin');
  assert.equal(pythonTriple('win32', 'x64'), 'x86_64-pc-windows-msvc');
});

test('accepte Python 3.10 à 3.13, et 3.12 au plus sur Windows', () => {
  assert.deepEqual(parsePythonVersion('Python 3.12.1'), [3, 12]);
  assert.equal(pythonIsCompatible([3, 9], 'darwin'), false);
  assert.equal(pythonIsCompatible([3, 12], 'darwin'), true);
  assert.equal(pythonIsCompatible([3, 13], 'darwin'), true);
  assert.equal(pythonIsCompatible([3, 13], 'win32'), false);
  assert.equal(pythonIsCompatible([3, 14], 'darwin'), false);
  assert.deepEqual(systemPythonCandidates({ PYTHON_PATH: '/opt/python' }, 'darwin'), ['/opt/python', 'python3', 'python']);
});

test('garde le venv déplaçable et la configuration au dossier de données', () => {
  const layout = componentLayout({
    PIECEMAKER_HOME: '/donnees',
    PIECEMAKER_COMPONENTS_HOME: '/opt/composants',
  }, '/Users/ada');
  assert.equal(layout.venvDir, path.join('/opt/composants', 'venv'));
  assert.equal(layout.pythonDir, path.join('/opt/composants', 'python'));
  assert.equal(layout.configFile, path.join('/donnees', 'config.json'));
  assert.equal(layout.mineruConfig, path.join('/Users/ada', 'mineru.json'));
  assert.equal(scriptsDirectory('/src'), path.join('/src', 'server', 'piecemaker', 'vendor', 'websocket-server', 'scripts'));
  assert.equal(venvPythonPath('/v', 'win32'), path.join('/v', 'Scripts', 'python.exe'));
  assert.equal(bundledPythonPath('/p', 'darwin'), path.join('/p', 'bin', 'python3'));
  assert.equal(venvScriptPath('/v', 'mineru-models-download', 'darwin'), path.join('/v', 'bin', 'mineru-models-download'));
});

test('fusionne la configuration sans effacer les autres clés', () => {
  const merged = mergeRuntimeConfig({ mikePiiPort: 4111 }, { pythonPath: '/venv/bin/python', venvPath: '/venv' });
  assert.deepEqual(merged, { mikePiiPort: 4111, pythonPath: '/venv/bin/python', venvPath: '/venv' });
  assert.equal(dependenciesReady(readyStatus()), true);
  assert.equal(glinerReady({ ready: true, gliner2_runtime: { boundary_capable: false } }), false);
  assert.equal(runtimeReady(readyStatus()), true);
  assert.equal(runtimeReady({ ...readyStatus(), tools: { mineru: false } }), false);
  assert.deepEqual(parseStatus('avertissement\n{"ready":true}'), { ready: true });
});

test('l\'installeur Electron ne lance les composants que par une ligne', () => {
  const source = fs.readFileSync(path.join(root, '..', 'lib', 'install.mjs'), 'utf8');
  assert.deepEqual(source.match(/composants\/install\.mjs/g), ['composants/install.mjs']);
  assert.equal(source.includes('composants/'), true);
});

test('échoue avant tout téléchargement si les scripts sont absents', async () => {
  const host = memoryHost();
  await assert.rejects(
    installRuntimeComponents({
      sourceDir: '/src',
      env: {},
      homeDir: '/Users/ada',
      platform: 'darwin',
      arch: 'arm64',
      host,
      output: { step() {}, ok() {} },
    }),
    /Scripts Python introuvables/,
  );
  assert.equal(host.commands.length, 0);
});

test('réutilise un environnement déjà complet et enregistre son interpréteur', async () => {
  const env = { PIECEMAKER_HOME: '/donnees', PIECEMAKER_COMPONENTS_HOME: '/opt/composants' };
  const layout = componentLayout(env, '/Users/ada');
  const scripts = scriptsDirectory('/src');
  const python = venvPythonPath(layout.venvDir, 'darwin');
  const files = new Map([
    [path.join(scripts, 'requirements.txt'), ''],
    [path.join(scripts, 'warmup.py'), ''],
    [python, ''],
    [`version:${python}`, 'Python 3.12.1'],
    ['warmup-status', JSON.stringify(readyStatus())],
    [layout.mineruConfig, JSON.stringify({ 'models-dir': { pipeline: '/models/pipeline' } })],
    ['/models/pipeline', ''],
    [layout.configFile, JSON.stringify({ mikePiiPort: 4111 })],
  ]);
  const host = memoryHost(files);
  await installRuntimeComponents({
    sourceDir: '/src',
    env,
    homeDir: '/Users/ada',
    platform: 'darwin',
    arch: 'arm64',
    host,
    output: { step() {}, ok() {} },
  });
  assert.equal(host.commands.some((command) => command.includes('pip')), false);
  const config = JSON.parse(files.get(layout.configFile));
  assert.equal(config.mikePiiPort, 4111);
  assert.equal(config.pythonPath, python);
  assert.equal(config.venvPath, layout.venvDir);
});

test('installe les bibliothèques, MinerU et le modèle quand l\'environnement est vide', async () => {
  const env = { PIECEMAKER_HOME: '/donnees' };
  const layout = componentLayout(env, '/Users/ada');
  const scripts = scriptsDirectory('/src');
  const files = new Map([
    [path.join(scripts, 'requirements.txt'), 'markitdown\n'],
    [path.join(scripts, 'warmup.py'), ''],
    ['version:python3', 'Python 3.12.4'],
  ]);
  let warmupCalls = 0;
  const host = memoryHost(files);
  const baseRun = host.run.bind(host);
  host.run = async (command, args, options) => {
    const result = await baseRun(command, args, options);
    if (args.includes('--status')) {
      warmupCalls += 1;
      if (warmupCalls < 3) return { code: 1, stdout: '', stderr: '' };
      return { code: 0, stdout: JSON.stringify(readyStatus()), stderr: '' };
    }
    return result;
  };
  await installRuntimeComponents({
    sourceDir: '/src',
    env,
    homeDir: '/Users/ada',
    platform: 'darwin',
    arch: 'arm64',
    host,
    output: { step() {}, ok() {} },
  });
  const flat = host.commands.map((command) => command.join(' '));
  assert.ok(flat.some((line) => line.includes('pip install --upgrade -r')));
  assert.ok(flat.some((line) => line.includes('mineru[pipeline,vlm]==2.7.6')));
  assert.ok(flat.some((line) => line.includes('mineru-models-download -s huggingface -m pipeline')));
  assert.ok(flat.some((line) => line.endsWith('warmup.py')));
  assert.equal(JSON.parse(files.get(layout.configFile)).pythonPath, venvPythonPath(layout.venvDir, 'darwin'));
});

test('ignore un dossier de modèles MinerU déclaré mais absent', async () => {
  const host = memoryHost(new Map([
    ['/Users/ada/mineru.json', JSON.stringify({ 'models-dir': { pipeline: '/absent' } })],
  ]));
  assert.equal(await pipelineModelsReady(host, '/Users/ada/mineru.json'), false);
});
