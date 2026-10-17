import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import crossSpawn from 'cross-spawn';

import { MistralProviderAuth } from '@/modules/providers/list/mistral/mistral-auth.provider.js';
import {
  currentVibeCliHost,
  findVibeApiKey,
  findVibeBinDirectory,
  isVibeInstalled,
  resolveVibeExecutable,
  vibeEnvFilePath,
  windowsCredentialProbeScript,
  type VibeCliHost,
} from '@/shared/vibe-cli.js';

type SpawnCall = { command: string; args: string[]; options: Record<string, unknown> };
type SpawnAnswer = { status?: number | null; stdout?: string; error?: Error; throws?: boolean };

type FakeHostOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  files?: Record<string, string>;
  answer?: (call: SpawnCall) => SpawnAnswer;
};

function fakeHost({
  platform = 'darwin',
  env = {},
  files = {},
  answer = () => ({ status: 1 }),
}: FakeHostOptions = {}) {
  const homedir = platform === 'win32' ? 'C:\\Users\\jean' : '/Users/jean';
  const calls: SpawnCall[] = [];
  const host: VibeCliHost = {
    platform,
    env,
    homedir,
    existsSync: (filePath) => filePath in files,
    readFileSync: (filePath) => {
      if (!(filePath in files)) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return files[filePath];
    },
    spawnSync: ((command: string, args: string[], options: Record<string, unknown>) => {
      const call = { command, args, options };
      calls.push(call);
      const result = answer(call);
      if (result.throws) {
        throw new Error('spawn exploded');
      }
      return { status: result.status ?? null, stdout: result.stdout ?? '', error: result.error };
    }) as unknown as VibeCliHost['spawnSync'],
    keyringServices: ['ai.mistral.vibe', 'vibe'],
  };
  return { host, calls };
}

test('without a uv install folder, vibe is looked up on the PATH', () => {
  const { host } = fakeHost();
  assert.equal(findVibeBinDirectory(host), null);
  assert.equal(resolveVibeExecutable(host), 'vibe');
});

test('on macOS and Linux, the uv default folder ~/.local/bin is found', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    const { host } = fakeHost({ platform, files: { '/Users/jean/.local/bin/vibe': '' } });
    assert.equal(findVibeBinDirectory(host), '/Users/jean/.local/bin');
    assert.equal(resolveVibeExecutable(host), '/Users/jean/.local/bin/vibe');
  }
});

test('on Windows, vibe.exe is found in %USERPROFILE%\\.local\\bin', () => {
  const { host } = fakeHost({ platform: 'win32', files: { 'C:\\Users\\jean\\.local\\bin\\vibe.exe': '' } });
  assert.equal(findVibeBinDirectory(host), 'C:\\Users\\jean\\.local\\bin');
  assert.equal(resolveVibeExecutable(host), 'C:\\Users\\jean\\.local\\bin\\vibe.exe');
});

test('on Windows, a vibe without .exe is not mistaken for the uv executable', () => {
  const { host } = fakeHost({ platform: 'win32', files: { 'C:\\Users\\jean\\.local\\bin\\vibe': '' } });
  assert.equal(resolveVibeExecutable(host), 'vibe');
});

test('UV_TOOL_BIN_DIR, then XDG_BIN_HOME, then XDG_DATA_HOME/../bin win over ~/.local/bin', () => {
  const everywhere = {
    '/opt/uv-tools/vibe': '',
    '/Users/jean/xdg-bin/vibe': '',
    '/Users/jean/xdg/bin/vibe': '',
    '/Users/jean/.local/bin/vibe': '',
  };
  const env = { UV_TOOL_BIN_DIR: '/opt/uv-tools', XDG_BIN_HOME: '~/xdg-bin', XDG_DATA_HOME: '~/xdg/share' };
  assert.equal(findVibeBinDirectory(fakeHost({ env, files: everywhere }).host), '/opt/uv-tools');

  const withoutUv = { ...everywhere };
  delete (withoutUv as Record<string, string>)['/opt/uv-tools/vibe'];
  assert.equal(findVibeBinDirectory(fakeHost({ env, files: withoutUv }).host), '/Users/jean/xdg-bin');

  const onlyXdgData = { '/Users/jean/xdg/bin/vibe': '', '/Users/jean/.local/bin/vibe': '' };
  assert.equal(findVibeBinDirectory(fakeHost({ env, files: onlyXdgData }).host), '/Users/jean/xdg/bin');
});

test('the Windows environment is read without regard to case, as Windows does', () => {
  const { host } = fakeHost({
    platform: 'win32',
    env: { Uv_Tool_Bin_Dir: 'D:\\outils' },
    files: { 'D:\\outils\\vibe.exe': '' },
  });
  assert.equal(resolveVibeExecutable(host), 'D:\\outils\\vibe.exe');
});

test('vibe counts as installed only when the resolved executable answers --version with 0', () => {
  const files = { '/Users/jean/.local/bin/vibe': '' };
  const ok = fakeHost({ files, answer: () => ({ status: 0 }) });
  assert.equal(isVibeInstalled(ok.host), true);
  assert.deepEqual(ok.calls.map((call) => [call.command, call.args]), [['/Users/jean/.local/bin/vibe', ['--version']]]);

  assert.equal(isVibeInstalled(fakeHost({ answer: () => ({ status: 1 }) }).host), false);
  assert.equal(isVibeInstalled(fakeHost({ answer: () => ({ status: null }) }).host), false);
  assert.equal(isVibeInstalled(fakeHost({ answer: () => ({ status: 0, error: new Error('ENOENT') }) }).host), false);
  assert.equal(isVibeInstalled(fakeHost({ answer: () => ({ throws: true }) }).host), false);
});

test('a non-empty MISTRAL_API_KEY in the server environment is a key, and nothing else is probed', () => {
  const { host, calls } = fakeHost({ env: { MISTRAL_API_KEY: 'cle-test' } });
  assert.equal(findVibeApiKey(host), 'process_env');
  assert.equal(calls.length, 0);

  assert.equal(findVibeApiKey(fakeHost({ platform: 'win32', env: { Mistral_Api_Key: 'cle-test' } }).host), 'process_env');
  assert.equal(findVibeApiKey(fakeHost({ env: { MISTRAL_API_KEY: '   ' } }).host), null);
  assert.equal(findVibeApiKey(fakeHost({ platform: 'linux', env: { mistral_api_key: 'cle-test' } }).host), null);
});

test('the Vibe .env lives in ~/.vibe, or in VIBE_HOME when it is set', () => {
  assert.equal(vibeEnvFilePath(fakeHost().host), '/Users/jean/.vibe/.env');
  assert.equal(vibeEnvFilePath(fakeHost({ env: { VIBE_HOME: '~/autre-vibe' } }).host), '/Users/jean/autre-vibe/.env');
  assert.equal(vibeEnvFilePath(fakeHost({ env: { VIBE_HOME: '/srv/vibe' } }).host), '/srv/vibe/.env');
  assert.equal(vibeEnvFilePath(fakeHost({ platform: 'win32' }).host), 'C:\\Users\\jean\\.vibe\\.env');
  assert.equal(vibeEnvFilePath(fakeHost({ platform: 'win32', env: { VIBE_HOME: 'D:\\vibe' } }).host), 'D:\\vibe\\.env');
});

test('every way vibe --setup or a person writes the key in .env is recognised', () => {
  const accepted = [
    'MISTRAL_API_KEY=cle-test',
    "MISTRAL_API_KEY='cle-test'",
    'MISTRAL_API_KEY="cle-test"',
    'export MISTRAL_API_KEY=cle-test',
    '  MISTRAL_API_KEY = cle-test  ',
    'MISTRAL_API_KEY=cle-test # ajoutée à la main',
    'MISTRAL_API_KEY="cle-test" # ajoutée à la main',
    'MISTRAL_API_KEY= # python-dotenv garde cette valeur',
    'AUTRE=1\r\nMISTRAL_API_KEY=cle-test\r\n',
  ];
  for (const content of accepted) {
    const { host } = fakeHost({ files: { '/Users/jean/.vibe/.env': content } });
    assert.equal(findVibeApiKey(host), 'env_file', content);
  }

  const { host: windowsHost } = fakeHost({ platform: 'win32', files: { 'C:\\Users\\jean\\.vibe\\.env': 'MISTRAL_API_KEY=cle-test\r\n' } });
  assert.equal(findVibeApiKey(windowsHost), 'env_file');
});

test('a .env without a usable key does not count as signed in', () => {
  const rejected = [
    '',
    'MISTRAL_API_KEY=',
    "MISTRAL_API_KEY=''",
    '# MISTRAL_API_KEY=cle-test',
    'OTHER_MISTRAL_API_KEY=cle-test',
    'MISTRAL_API_KEY_BACKUP=cle-test',
  ];
  for (const content of rejected) {
    const { host } = fakeHost({ files: { '/Users/jean/.vibe/.env': content } });
    assert.equal(findVibeApiKey(host), null, content);
  }
});

test('on macOS the Keychain is asked, without -w, for the current then the legacy Vibe service', () => {
  const found = fakeHost({ answer: (call) => ({ status: call.args.includes('vibe') ? 0 : 44 }) });
  assert.equal(findVibeApiKey(found.host), 'keyring');
  assert.deepEqual(found.calls.map((call) => [call.command, call.args]), [
    ['/usr/bin/security', ['find-generic-password', '-s', 'ai.mistral.vibe', '-a', 'MISTRAL_API_KEY']],
    ['/usr/bin/security', ['find-generic-password', '-s', 'vibe', '-a', 'MISTRAL_API_KEY']],
  ]);
  assert.ok(found.calls.every((call) => call.options.stdio === 'ignore' && !call.args.includes('-w')));

  assert.equal(findVibeApiKey(fakeHost({ answer: () => ({ status: 44 }) }).host), null);
  assert.equal(findVibeApiKey(fakeHost({ answer: () => ({ status: 0, error: new Error('EACCES') }) }).host), null);
  assert.equal(findVibeApiKey(fakeHost({ answer: () => ({ throws: true }) }).host), null);
});

test('on Linux the Secret Service is asked through secret-tool, output discarded', () => {
  const found = fakeHost({ platform: 'linux', answer: () => ({ status: 0 }) });
  assert.equal(findVibeApiKey(found.host), 'keyring');
  assert.deepEqual(found.calls[0].command, 'secret-tool');
  assert.deepEqual(found.calls[0].args, ['lookup', 'service', 'ai.mistral.vibe', 'username', 'MISTRAL_API_KEY']);
  assert.equal(found.calls[0].options.stdio, 'ignore');

  assert.equal(findVibeApiKey(fakeHost({ platform: 'linux', answer: () => ({ status: 1 }) }).host), null);
  assert.equal(findVibeApiKey(fakeHost({ platform: 'linux', answer: () => ({ status: null, error: new Error('ENOENT') }) }).host), null);
});

test('on Windows the Credential Manager is probed by one hidden PowerShell that answers found or missing', () => {
  const found = fakeHost({ platform: 'win32', answer: () => ({ status: 0, stdout: 'found\r\n' }) });
  assert.equal(findVibeApiKey(found.host), 'keyring');
  assert.equal(found.calls.length, 1);
  const [call] = found.calls;
  assert.equal(call.command, 'powershell.exe');
  assert.deepEqual(call.args.slice(0, 3), ['-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.equal(call.options.windowsHide, true);
  assert.equal(Buffer.from(call.args[3], 'base64').toString('utf16le'), windowsCredentialProbeScript(['ai.mistral.vibe', 'vibe']));

  for (const answer of [
    { status: 0, stdout: 'missing\r\n' },
    { status: 1, stdout: 'found' },
    { status: null, stdout: '', error: new Error('ETIMEDOUT') },
    { throws: true },
  ]) {
    assert.equal(findVibeApiKey(fakeHost({ platform: 'win32', answer: () => answer }).host), null, JSON.stringify(answer));
  }
});

test('the Windows probe reads only user names, for the plain and the compound target python-keyring writes', () => {
  const script = windowsCredentialProbeScript(['ai.mistral.vibe', "o'brien"]);
  assert.match(script, /foreach \(\$service in @\('ai\.mistral\.vibe', 'o''brien'\)\)/);
  assert.match(script, /UserName\(\$service\) -eq \$variable/);
  assert.match(script, /UserName\("\$variable@\$service"\)/);
  assert.match(script, /\$variable = 'MISTRAL_API_KEY'/);
  assert.doesNotMatch(script, /CredentialBlob\)/);
  assert.match(script, /^'@$/m);
});

test('the status reports a missing Vibe, a Vibe without key, and a Vibe with a key', async () => {
  const missing = await new MistralProviderAuth(() => fakeHost({ answer: () => ({ status: 1 }) }).host).getStatus();
  assert.deepEqual(missing, {
    installed: false,
    provider: 'mistral',
    authenticated: false,
    email: null,
    method: null,
    error: 'Mistral Vibe CLI is not installed',
  });

  const signedOut = await new MistralProviderAuth(() => fakeHost({
    answer: (call) => ({ status: call.args[0] === '--version' ? 0 : 44 }),
  }).host).getStatus();
  assert.deepEqual(signedOut, {
    installed: true,
    provider: 'mistral',
    authenticated: false,
    email: null,
    method: null,
    error: 'Not logged in. Run vibe --setup',
  });

  const windowsSignedIn = await new MistralProviderAuth(() => fakeHost({
    platform: 'win32',
    files: { 'C:\\Users\\jean\\.local\\bin\\vibe.exe': '' },
    answer: (call) => (call.command === 'powershell.exe' ? { status: 0, stdout: 'found' } : { status: 0 }),
  }).host).getStatus();
  assert.deepEqual(windowsSignedIn, {
    installed: true,
    provider: 'mistral',
    authenticated: true,
    email: 'Mistral API key',
    method: 'api_key',
    error: undefined,
  });
});

test('a real vibe in a fake ~/.local/bin is resolved and run through cross-spawn', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-cli-home-'));
  try {
    const bin = path.join(home, '.local', 'bin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'vibe'), '#!/bin/sh\n[ "$1" = "--version" ] && echo "vibe 0.0.0-test" && exit 0\nexit 3\n', { mode: 0o755 });
    const host = { ...currentVibeCliHost(), homedir: home, env: { PATH: '/usr/bin:/bin' } };
    assert.equal(resolveVibeExecutable(host), path.join(bin, 'vibe'));
    assert.equal(isVibeInstalled(host), true);

    fs.writeFileSync(path.join(bin, 'vibe'), '#!/bin/sh\nexit 3\n', { mode: 0o755 });
    assert.equal(isVibeInstalled(host), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

const TEST_SERVICE = `piecemaker-test.vibe.${process.pid}`;

test('the real macOS Keychain entry written like Vibe does is detected, and its absence too', { skip: process.platform !== 'darwin' }, () => {
  const host = { ...currentVibeCliHost(), env: {}, homedir: os.tmpdir(), keyringServices: [TEST_SERVICE] };
  assert.equal(findVibeApiKey(host), null);
  execFileSync('/usr/bin/security', ['add-generic-password', '-s', TEST_SERVICE, '-a', 'MISTRAL_API_KEY', '-w', 'cle-test', '-A']);
  try {
    assert.equal(findVibeApiKey(host), 'keyring');
  } finally {
    execFileSync('/usr/bin/security', ['delete-generic-password', '-s', TEST_SERVICE, '-a', 'MISTRAL_API_KEY'], { stdio: 'ignore' });
  }
  assert.equal(findVibeApiKey(host), null);
});

test('the real Windows Credential Manager entries python-keyring writes are detected', { skip: process.platform !== 'win32' }, () => {
  const host = { ...currentVibeCliHost(), env: {}, homedir: os.tmpdir(), keyringServices: [TEST_SERVICE] };
  const add = (target: string, user: string) => crossSpawn.sync('cmdkey', [`/generic:${target}`, `/user:${user}`, '/pass:cle-test'], { stdio: 'ignore' });
  const remove = (target: string) => crossSpawn.sync('cmdkey', [`/delete:${target}`], { stdio: 'ignore' });
  try {
    assert.equal(findVibeApiKey(host), null);

    add(TEST_SERVICE, 'MISTRAL_API_KEY');
    assert.equal(findVibeApiKey(host), 'keyring');
    remove(TEST_SERVICE);

    add(TEST_SERVICE, 'AUTRE_COMPTE');
    assert.equal(findVibeApiKey(host), null);
    add(`MISTRAL_API_KEY@${TEST_SERVICE}`, 'MISTRAL_API_KEY');
    assert.equal(findVibeApiKey(host), 'keyring');
  } finally {
    remove(TEST_SERVICE);
    remove(`MISTRAL_API_KEY@${TEST_SERVICE}`);
  }
});
