import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const require = createRequire(import.meta.url);
const hasElectronBuilder = (() => {
  try {
    require.resolve('builder-util-runtime');
    return true;
  } catch {
    return false;
  }
})();

test('Windows initial bootstrap uses the verified installer and embedded Node without sources or a system toolchain', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-bootstrap-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const app = path.join(root, 'local/Programs/@piecemaker-legalpiecemaker-desktop');
  const scripts = path.join(app, 'resources/app.asar.unpacked/desktop-bootstrap/lib');
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(app, 'PieceMaker.exe'));
  const report = path.join(root, 'preparation.json');
  fs.writeFileSync(path.join(scripts, 'prepare-installed.mjs'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({args:process.argv.slice(2),runAsNode:process.env.ELECTRON_RUN_AS_NODE,root:process.env.PIECEMAKER_SRC_DIR,assets:process.env.PIECEMAKER_PREBUILT_ASSET_DIR,prefetched:fs.readdirSync(process.env.PIECEMAKER_PREBUILT_ASSET_DIR)}));`);
  const hash = crypto.createHash('sha256').update('fixture-installer').digest('hex');
  const pythonHash = crypto.createHash('sha256').update('fixture-python').digest('hex');
  const componentHash = crypto.createHash('sha256').update('fixture-components').digest('hex');
  const glinerRevision = '59894c087cb2923b01f337d4ee72f6ff84d5bdd6';
  const glinerHash = crypto.createHash('sha256').update('fixture-gliner').digest('hex');
  const glinerName = `piecemaker-gliner-${glinerRevision}.tar.gz`;
  const script = fileURLToPath(new URL('../install.ps1', import.meta.url));
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const harness = path.join(root, 'harness.ps1');
  fs.writeFileSync(harness, `
$ErrorActionPreference = 'Stop'
function Invoke-RestMethod {
  return @{ tag_name = 'v2.0.37'; assets = @(
    @{ name = 'piecemaker-droit-francais-desktop-2.0.37-win-x64.exe'; browser_download_url = 'https://example.test/setup' },
    @{ name = 'piecemaker-droit-francais-desktop-2.0.37-win-x64.exe.sha256'; browser_download_url = 'https://example.test/checksum' },
    @{ name = 'piecemaker-python-win32-x64.tar.gz'; browser_download_url = 'https://example.test/python' },
    @{ name = 'piecemaker-python-win32-x64.tar.gz.sha256'; browser_download_url = 'https://example.test/python-checksum' },
    @{ name = 'piecemaker-runtime-components-win32-x64-${componentHash}.tar.gz'; browser_download_url = 'https://example.test/components' },
    @{ name = 'piecemaker-runtime-components-win32-x64-${componentHash}.tar.gz.sha256'; browser_download_url = 'https://example.test/components-checksum' },
    @{ name = '${glinerName}'; browser_download_url = 'https://example.test/gliner' },
    @{ name = '${glinerName}.sha256'; browser_download_url = 'https://example.test/gliner-checksum' }
  ) }
}
function Invoke-WebRequest {
  param($Uri, $OutFile, [switch]$UseBasicParsing)
  if ($Uri -eq 'https://example.test/setup') { [IO.File]::WriteAllText($OutFile, 'fixture-installer'); return }
  if ($Uri -eq 'https://example.test/checksum') { return @{ Content = [Text.Encoding]::ASCII.GetBytes($env:FIXTURE_CHECKSUM) } }
  if ($Uri -eq 'https://example.test/python') { [IO.File]::WriteAllText($OutFile, 'fixture-python'); return }
  if ($Uri -eq 'https://example.test/python-checksum') { return @{ Content = [Text.Encoding]::ASCII.GetBytes($env:FIXTURE_PYTHON_CHECKSUM) } }
  if ($Uri -eq 'https://example.test/components') { [IO.File]::WriteAllText($OutFile, 'fixture-components'); return }
  if ($Uri -eq 'https://example.test/components-checksum') { return @{ Content = [Text.Encoding]::ASCII.GetBytes($env:FIXTURE_COMPONENT_CHECKSUM) } }
  if ($Uri -eq 'https://example.test/gliner') { [IO.File]::WriteAllText($OutFile, 'fixture-gliner'); return }
  if ($Uri -eq 'https://example.test/gliner-checksum') { return @{ Content = [Text.Encoding]::ASCII.GetBytes($env:FIXTURE_GLINER_CHECKSUM) } }
  throw "Unexpected network: $Uri"
}
function Wait-Process { param($Id) }
function Get-ItemProperty {
  param($LiteralPath, $ErrorAction)
  if ($LiteralPath -ne 'HKCU:\\Software\\be668065-da35-5797-91d0-75b4725f56f1') { throw "Unexpected registry key: $LiteralPath" }
  if ($env:FIXTURE_INSTALL_LOCATION) { return @{ InstallLocation = $env:FIXTURE_INSTALL_LOCATION } }
  return $null
}
function Start-Process {
  param($FilePath, $ArgumentList, $WindowStyle, [switch]$Wait, [switch]$PassThru, $RedirectStandardOutput, $RedirectStandardError)
  if ($FilePath -like '*PieceMaker.exe') {
    if ($WindowStyle -ne 'Hidden' -or -not $Wait -or -not $PassThru) { throw 'Preparation must wait for the embedded runtime' }
    $prepareFile = $ArgumentList[0].Trim('"')
    $prepareOptions = @($ArgumentList | Select-Object -Skip 1)
    & $FilePath $prepareFile @prepareOptions
    return @{ ExitCode = $LASTEXITCODE }
  }
  if ($FilePath -notlike '*-win-x64.exe' -or $ArgumentList -ne '/S' -or $WindowStyle -ne 'Hidden' -or $Wait) { throw 'Unexpected process' }
  return @{ Id = 4242; ExitCode = 0; HasExited = $true }
}
& ${quote(script)} --no-launch --no-certificate
if ($env:ELECTRON_RUN_AS_NODE -ne 'original') { throw 'RunAsNode environment was not restored' }
`);
  const run = (checksum, installLocation = '') => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: {
      ...process.env,
      LOCALAPPDATA: path.join(root, 'local'),
      PIECEMAKER_BOOTSTRAP_HOME: path.join(root, 'bootstrap'),
      PIECEMAKER_TAG: 'v2.0.37',
      ELECTRON_FORCE_OWN_SERVER: '',
      ELECTRON_RUN_AS_NODE: 'original',
      FIXTURE_CHECKSUM: checksum,
      FIXTURE_PYTHON_CHECKSUM: pythonHash,
      FIXTURE_COMPONENT_CHECKSUM: componentHash,
      FIXTURE_GLINER_CHECKSUM: glinerHash,
      FIXTURE_INSTALL_LOCATION: installLocation,
    },
  });
  const valid = run(hash);
  assert.equal(valid.status, 0, valid.stderr);
  const prepared = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(prepared.runAsNode, '1');
  assert.deepEqual(prepared.args, ['--no-launch', '--no-certificate']);
  assert.equal(prepared.root, path.join(app, 'resources/app.asar.unpacked'));
  const prefetched = path.join(root, 'bootstrap/prebuilt/v2.0.37');
  assert.equal(prepared.assets, prefetched);
  assert.deepEqual(prepared.prefetched.sort(), ['piecemaker-python-win32-x64.tar.gz', `piecemaker-runtime-components-win32-x64-${componentHash}.tar.gz`]);
  assert.deepEqual(fs.readdirSync(path.join(root, 'bootstrap')).filter(name => /prebuilt|src|toolchain|\.exe$/.test(name)), []);
  fs.unlinkSync(report);
  const relocated = path.join(root, 'elsewhere/PieceMaker');
  fs.cpSync(app, relocated, { recursive: true });
  const moved = run(hash, relocated);
  assert.equal(moved.status, 0, moved.stderr);
  assert.equal(JSON.parse(fs.readFileSync(report, 'utf8')).root, path.join(relocated, 'resources/app.asar.unpacked'));
  fs.unlinkSync(report);
  const invalid = run('0'.repeat(64));
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /integrite/);
  assert.equal(fs.existsSync(report), false);
});

test('the Windows bootstrap shows the Légifrance guide after the first install only', () => {
  const script = fs.readFileSync(new URL('../install.ps1', import.meta.url), 'utf8');
  assert.match(script, /finish-install\.mjs/);
  assert.match(script, /if \(\$args -notcontains '--no-launch'\)/);
});

test('the Windows bootstrap looks for the app where electron-builder installs it', { skip: !hasElectronBuilder && 'electron-builder is not installed' }, async () => {
  const { UUID } = await import('builder-util-runtime');
  const { sanitizeFileName } = await import('builder-util/out/filename.js');
  const script = fs.readFileSync(new URL('../install.ps1', import.meta.url), 'utf8');
  const product = JSON.parse(fs.readFileSync(new URL('../../product.config.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
  const guid = UUID.v5(product.appId, UUID.parse('50e065bc-3134-11e6-9bab-38c9862bdaf3'));
  assert.ok(script.includes(`'HKCU:\\Software\\${guid}'`), guid);
  assert.ok(script.includes(`'Programs\\${sanitizeFileName(`${manifest.name}-desktop`)}'`));
  assert.ok(script.includes(`Join-Path $appDir '${product.shortName}.exe'`));
});
