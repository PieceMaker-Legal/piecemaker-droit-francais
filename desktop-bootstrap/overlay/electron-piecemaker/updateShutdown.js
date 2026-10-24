import { execFile } from 'node:child_process';

function stopWindowsTree(pid, force) {
  return new Promise((resolve, reject) => {
    execFile('taskkill', ['/PID', String(pid), '/T', ...(force ? ['/F'] : [])], { windowsHide: true, timeout: 5000 }, (error) => error ? reject(error) : resolve());
  });
}

function hasExited(child) {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitForExit(child) {
  if (hasExited(child)) return;
  await new Promise((resolve, reject) => {
    const onExit = () => { clearTimeout(timeout); child.off('exit', onExit); resolve(); };
    const timeout = setTimeout(() => {
      child.off('exit', onExit);
      reject(new Error('Le serveur ne s’est pas arrêté ; installation annulée.'));
    }, 3000);
    child.once('exit', onExit);
    if (hasExited(child)) onExit();
  });
}

export function observeServerForUpdate({ LocalServerController, stopTree = stopWindowsTree }) {
  let controller;
  let lastOwnedProcess;
  const startBundledServer = LocalServerController.prototype.startBundledServer;
  LocalServerController.prototype.startBundledServer = function (...args) {
    const result = startBundledServer.apply(this, args);
    controller = this;
    lastOwnedProcess = this.ownedServerProcess;
    return result;
  };
  return async () => {
    const child = controller?.ownedServerProcess || lastOwnedProcess;
    if (!child?.pid || hasExited(child)) return;
    try {
      await stopTree(child.pid, false);
    } catch (error) {
      if (hasExited(child)) throw error;
      await stopTree(child.pid, true);
    }
    await controller.shutdownOwnedServer();
    if (!hasExited(child)) await stopTree(child.pid, true);
    await waitForExit(child);
  };
}
