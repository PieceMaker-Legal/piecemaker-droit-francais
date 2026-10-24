import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { observeServerForUpdate } from './updateShutdown.js';

function harness(keepLocalServerRunning, stopTree) {
  const calls = [];
  const child = Object.assign(new EventEmitter(), { pid: 12345, exitCode: null, signalCode: null });
  const exit = () => { child.exitCode = 0; child.emit('exit', 0); };
  class Controller {
    getSettings() { return { keepLocalServerRunning }; }
    startBundledServer() { this.ownedServerProcess = child; return 'started'; }
    async shutdownOwnedServer() { calls.push('shutdown'); this.ownedServerProcess = null; }
  }
  const originalSettings = Controller.prototype.getSettings;
  const originalShutdown = Controller.prototype.shutdownOwnedServer;
  const prepare = observeServerForUpdate({ LocalServerController: Controller, stopTree: async (...args) => {
    calls.push(args);
    if (stopTree) return stopTree({ args, child, exit });
    exit();
  } });
  assert.equal(Controller.prototype.getSettings, originalSettings);
  assert.equal(Controller.prototype.shutdownOwnedServer, originalShutdown);
  const controller = new Controller();
  return { child, exit, prepare, controller, calls };
}

for (const keepRunning of [true, false]) {
  test(`explicit install stops only the owned server with keepLocalServerRunning=${keepRunning}`, async () => {
    const { prepare, controller, calls } = harness(keepRunning);
    assert.equal(controller.startBundledServer(), 'started');
    await prepare();
    assert.deepEqual(calls, [[12345, false], 'shutdown']);
    assert.equal(controller.getSettings().keepLocalServerRunning, keepRunning);
    assert.equal(controller.ownedServerProcess, null);
    await prepare();
    assert.equal(calls.length, 2);
  });
}

test('no server started by this application means no process termination', async () => {
  const { prepare, calls } = harness(false);
  await prepare();
  assert.deepEqual(calls, []);
});

test('normal quitting keeps upstream shutdown and settings methods intact', () => {
  const { controller, calls } = harness(true);
  controller.startBundledServer();
  assert.deepEqual(calls, []);
  assert.equal(controller.getSettings().keepLocalServerRunning, true);
});

test('a rejected non-forced tree stop falls back to forced descendants shutdown', async () => {
  const { prepare, controller, calls } = harness(false, ({ args, exit }) => {
    if (!args[1]) throw new Error('Process requires force');
    exit();
  });
  controller.startBundledServer();
  await prepare();
  assert.deepEqual(calls, [[12345, false], [12345, true], 'shutdown']);
});

test('a still-running process after upstream shutdown is forcibly stopped', async () => {
  const { prepare, controller, calls } = harness(false, ({ args, exit }) => { if (args[1]) exit(); });
  controller.startBundledServer();
  await prepare();
  assert.deepEqual(calls, [[12345, false], 'shutdown', [12345, true]]);
});

test('failure to terminate the owned tree rejects installation and retains ownership', async () => {
  const { prepare, controller } = harness(false, () => { throw new Error('Access denied'); });
  controller.startBundledServer();
  await assert.rejects(prepare(), /Access denied/);
  assert.equal(controller.ownedServerProcess.pid, 12345);
});

test('a process that never exits causes a bounded failure rather than a blocked quit', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let allowExit = false;
  const { prepare, controller, child } = harness(false, ({ exit }) => { if (allowExit) exit(); });
  controller.startBundledServer();
  const pending = assert.rejects(prepare(), /installation annulée/);
  await new Promise(setImmediate);
  context.mock.timers.tick(3000);
  await pending;
  assert.equal(child.listenerCount('exit'), 0);
  allowExit = true;
  await prepare();
  assert.equal(child.exitCode, 0);
});

test('the real CloudCLI controller can stop and restart without a quit loop', async (context) => {
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { once } = await import('node:events');
  const { LocalServerController } = await import('../../../electron/localServer.js');
  class TestController extends LocalServerController {}
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-update-shutdown-'));
  const entry = path.join(root, 'server.cjs');
  await fs.writeFile(entry, 'setInterval(() => {}, 1000);\n');
  const controller = new TestController({ appRoot: root, settingsPath: path.join(root, 'settings.json'), dataRoot: root });
  context.after(async () => {
    await controller.shutdownOwnedServer();
    await fs.rm(root, { recursive: true, force: true });
  });
  const stopped = [];
  const prepare = observeServerForUpdate({ LocalServerController: TestController, stopTree: async (pid) => { stopped.push(pid); process.kill(pid, 'SIGTERM'); } });
  for (let cycle = 0; cycle < 2; cycle += 1) {
    controller.startBundledServer(0, entry);
    const child = controller.ownedServerProcess;
    await once(child, 'spawn');
    await prepare();
    assert.equal(controller.hasOwnedServer(), false);
    assert.equal(child.signalCode, 'SIGTERM');
  }
  assert.equal(new Set(stopped).size, 2);
});
