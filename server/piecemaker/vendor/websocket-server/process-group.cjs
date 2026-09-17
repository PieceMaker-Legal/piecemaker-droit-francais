const { spawn } = require('node:child_process');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function posixProcessGroupExists(processGroupId) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 0) return false;
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === 'EPERM') return true;
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

function signalPosixProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForPosixProcessGroupExit(processGroupId, timeoutMs, pollIntervalMs = 25) {
  const deadline = Date.now() + timeoutMs;
  while (posixProcessGroupExists(processGroupId)) {
    if (Date.now() >= deadline) return false;
    await wait(Math.min(pollIntervalMs, Math.max(1, deadline - Date.now())));
  }
  return true;
}

function taskkillProcessTree(processId) {
  return new Promise((resolve, reject) => {
    const killer = spawn('taskkill.exe', ['/PID', String(processId), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    killer.once('error', reject);
    killer.once('close', (code) => {
      if (code === 0 || code === 128) resolve();
      else reject(new Error(`taskkill a échoué avec le code ${code}.`));
    });
  });
}

/**
 * Terminates a complete processing tree and confirms that it disappeared.
 * On POSIX, the pipeline is its process-group leader. On Windows, taskkill /T
 * performs the recursive termination while the root process still exists.
 */
async function terminateProcessTree(processGroupId, {
  graceMs = 2_000,
  platform = process.platform,
} = {}) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 0) return;

  if (platform === 'win32') {
    await taskkillProcessTree(processGroupId);
    return;
  }

  if (!posixProcessGroupExists(processGroupId)) return;
  signalPosixProcessGroup(processGroupId, 'SIGTERM');
  if (await waitForPosixProcessGroupExit(processGroupId, graceMs)) return;

  signalPosixProcessGroup(processGroupId, 'SIGKILL');
  if (!(await waitForPosixProcessGroupExit(processGroupId, graceMs))) {
    throw new Error(`Le groupe de processus ${processGroupId} est toujours actif après SIGKILL.`);
  }
}

/**
 * Post-job guard: a successful direct child exit is insufficient because one
 * of its descendants may still own CPU, memory, or inherited pipes.
 */
async function ensureProcessTreeStopped(processGroupId, options) {
  if (process.platform === 'win32') return;
  if (posixProcessGroupExists(processGroupId)) {
    await terminateProcessTree(processGroupId, options);
  }
  if (posixProcessGroupExists(processGroupId)) {
    throw new Error(`Nettoyage incomplet du groupe de processus ${processGroupId}.`);
  }
}

module.exports = {
  ensureProcessTreeStopped,
  posixProcessGroupExists,
  terminateProcessTree,
  waitForPosixProcessGroupExit,
};
