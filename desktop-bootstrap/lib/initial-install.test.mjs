import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('Windows initial bootstrap uses the verified installer and embedded Node without sources or a system toolchain', { skip: process.platform !== 'win32' }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-bootstrap-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5 }));
  const app = path.join(root, 'local/Programs/PieceMaker');
  const scripts = path.join(app, 'resources/app.asar.unpacked/desktop-bootstrap/lib');
  fs.mkdirSync(scripts, { recursive: true });
  fs.copyFileSync(process.execPath, path.join(app, 'PieceMaker.exe'));
  const report = path.join(root, 'preparation.json');
  fs.writeFileSync(path.join(scripts, 'prepare-installed.mjs'), `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(report)}, JSON.stringify({args:process.argv.slice(2),runAsNode:process.env.ELECTRON_RUN_AS_NODE,root:process.env.PIECEMAKER_SRC_DIR}));`);
  const hash = crypto.createHash('sha256').update('fixture-installer').digest('hex');
  const script = fileURLToPath(new URL('../install.ps1', import.meta.url));
  const quote = value => `'${value.replaceAll("'", "''")}'`;
  const harness = path.join(root, 'harness.ps1');
  fs.writeFileSync(harness, `
$ErrorActionPreference = 'Stop'
function Invoke-RestMethod {
  return @{ tag_name = 'v2.0.37'; assets = @(
    @{ name = 'piecemaker-droit-francais-desktop-2.0.37-win-x64.exe'; browser_download_url = 'https://example.test/setup' },
    @{ name = 'piecemaker-droit-francais-desktop-2.0.37-win-x64.exe.sha256'; browser_download_url = 'https://example.test/checksum' }
  ) }
}
function Invoke-WebRequest {
  param($Uri, $OutFile, [switch]$UseBasicParsing)
  if ($Uri -eq 'https://example.test/setup') { [IO.File]::WriteAllText($OutFile, 'fixture-installer'); return }
  if ($Uri -eq 'https://example.test/checksum') { return @{ Content = $env:FIXTURE_CHECKSUM } }
  throw "Unexpected network: $Uri"
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
  if ($FilePath -notlike '*-win-x64.exe' -or $ArgumentList -ne '/S' -or $WindowStyle -ne 'Hidden') { throw 'Unexpected process' }
  return @{ ExitCode = 0 }
}
& ${quote(script)} --no-launch --no-certificate
if ($env:ELECTRON_RUN_AS_NODE -ne 'original') { throw 'RunAsNode environment was not restored' }
`);
  const run = checksum => spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', harness], {
    encoding: 'utf8', windowsHide: true, timeout: 30000,
    env: { ...process.env, LOCALAPPDATA: path.join(root, 'local'), PIECEMAKER_BOOTSTRAP_HOME: path.join(root, 'bootstrap'), PIECEMAKER_TAG: 'v2.0.37', ELECTRON_FORCE_OWN_SERVER: '', ELECTRON_RUN_AS_NODE: 'original', FIXTURE_CHECKSUM: checksum },
  });
  const valid = run(hash);
  assert.equal(valid.status, 0, valid.stderr);
  const prepared = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert.equal(prepared.runAsNode, '1');
  assert.deepEqual(prepared.args, ['--no-launch', '--no-certificate']);
  assert.equal(prepared.root, path.join(app, 'resources/app.asar.unpacked'));
  assert.equal(fs.existsSync(path.join(root, 'bootstrap/src')), false);
  fs.unlinkSync(report);
  const invalid = run('0'.repeat(64));
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /integrite/);
  assert.equal(fs.existsSync(report), false);
});
