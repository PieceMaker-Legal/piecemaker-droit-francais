import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDesktopUpdateService,
  desktopBundlePath,
  installerCommand,
  installerEnvironment,
  relaunchCommand,
  type DesktopUpdateDependencies,
} from './service.js';

const BUNDLE_APP_ROOT = '/Applications/PieceMaker.app/Contents/Resources/app';

function makeDependencies(overrides: Partial<DesktopUpdateDependencies> = {}) {
  const calls = { installer: [] as { command: string; environment: NodeJS.ProcessEnv }[], detached: [] as string[] };
  const dependencies: DesktopUpdateDependencies = {
    appRoot: BUNDLE_APP_ROOT,
    platform: 'darwin',
    repository: 'PieceMaker-Legal/piecemaker-droit-francais',
    applicationPid: 728,
    environment: { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', SERVER_PORT: '3101', HOME: '/Users/x' },
    async runInstaller(command, environment) {
      calls.installer.push({ command, environment });
      return { exitCode: 0, output: '\u001b[1;34m==\u001b[0m Version retenue : v2.0.4\n', errorOutput: '' };
    },
    launchDetached(command) {
      calls.detached.push(command);
    },
    logInfo() {},
    ...overrides,
  };
  return { dependencies, calls };
}

test('desktopBundlePath extracts the macOS bundle from the packaged app root', () => {
  assert.equal(desktopBundlePath(BUNDLE_APP_ROOT, 'darwin'), '/Applications/PieceMaker.app');
  assert.equal(desktopBundlePath('/Users/x/Applications/PieceMaker.app/Contents/Resources/app/', 'darwin'), '/Users/x/Applications/PieceMaker.app');
  assert.equal(desktopBundlePath('/Users/x/code/piecemaker', 'darwin'), null);
  assert.equal(desktopBundlePath(BUNDLE_APP_ROOT, 'win32'), null);
});

test('installerCommand runs the product desktop bootstrap without launching it', () => {
  assert.equal(
    installerCommand('PieceMaker-Legal/piecemaker-droit-francais'),
    "curl -fsSL 'https://raw.githubusercontent.com/PieceMaker-Legal/piecemaker-droit-francais/main/desktop-bootstrap/install.sh' | sh -s -- --no-launch",
  );
});

test('installerEnvironment drops the variables that only concern the running server', () => {
  const environment = installerEnvironment({ PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', CLOUDCLI_HOME: '/h', DATABASE_PATH: '/d', HOST: '0', SERVER_PORT: '1', PORT: '2' });
  assert.deepEqual(environment, { PATH: '/usr/bin' });
});

test('relaunchCommand quits the running app, waits for it, then reopens the bundle', () => {
  const command = relaunchCommand('/Applications/PieceMaker.app', 728);
  assert.match(command, /osascript -e 'tell application "\/Applications\/PieceMaker.app" to quit'/);
  assert.match(command, /kill -0 728/);
  assert.match(command, /open '\/Applications\/PieceMaker.app'$/);
});

test('update installs the latest release then schedules the relaunch', async () => {
  const { dependencies, calls } = makeDependencies();
  const result = await createDesktopUpdateService(dependencies).update();

  assert.equal(result.success, true);
  assert.equal(result.success && result.output, '== Version retenue : v2.0.4\n');
  assert.equal(calls.installer.length, 1);
  assert.match(calls.installer[0].command, /desktop-bootstrap\/install\.sh/);
  assert.equal(calls.installer[0].environment.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(calls.installer[0].environment.HOME, '/Users/x');
  assert.equal(calls.detached.length, 1);
  assert.match(calls.detached[0], /open '\/Applications\/PieceMaker.app'/);
});

test('update reports the installer failure and keeps the app running', async () => {
  const { dependencies, calls } = makeDependencies({
    async runInstaller() {
      return { exitCode: 1, output: 'build', errorOutput: '\u001b[1;31m!!\u001b[0m curl est requis.' };
    },
  });
  const result = await createDesktopUpdateService(dependencies).update();

  assert.equal(result.success, false);
  assert.equal(!result.success && result.errorOutput, '!! curl est requis.');
  assert.equal(!result.success && result.error, '!! curl est requis.');
  assert.equal(calls.detached.length, 0);
});

test('update falls back to a generic message when the installer is silent on stderr', async () => {
  const { dependencies } = makeDependencies({
    async runInstaller() {
      return { exitCode: 1, output: 'build', errorOutput: '  \n' };
    },
  });
  const result = await createDesktopUpdateService(dependencies).update();

  assert.equal(!result.success && result.error, "Échec du téléchargement ou de l'installation de la nouvelle version");
});

test('non-desktop installs are left to the upstream updater', async () => {
  const fromSources = createDesktopUpdateService(makeDependencies({ appRoot: '/Users/x/code/piecemaker' }).dependencies);
  const withoutRepository = createDesktopUpdateService(makeDependencies({ repository: null }).dependencies);

  assert.equal(fromSources.isDesktopInstall(), false);
  assert.equal(withoutRepository.isDesktopInstall(), false);
  assert.equal((await fromSources.update()).success, false);
});
