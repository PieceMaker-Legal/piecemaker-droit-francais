const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, readFile, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');
const {
  posixProcessGroupExists,
  terminateProcessTree,
} = require('./process-group.cjs');

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(read, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await wait(20);
  }
  throw new Error('Condition de test non satisfaite avant le délai maximal.');
}

function processExists(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

test('termine le parent et son descendant, avec escalade SIGKILL', {
  skip: process.platform === 'win32',
  timeout: 15_000,
}, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'piecemaker-process-group-'));
  const childPidPath = path.join(directory, 'child.pid');
  const childReadyPath = path.join(directory, 'child.ready');
  let parent;

  const descendantSource = `
    const fs = require('node:fs');
    process.on('SIGTERM', () => {});
    fs.writeFileSync(${JSON.stringify(childReadyPath)}, String(process.pid));
    setInterval(() => {}, 1_000);
  `;
  const parentSource = `
    const fs = require('node:fs');
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], {
      stdio: 'ignore',
    });
    fs.writeFileSync(${JSON.stringify(childPidPath)}, String(child.pid));
    setInterval(() => {}, 1_000);
  `;

  try {
    parent = spawn(process.execPath, ['-e', parentSource], {
      detached: true,
      stdio: 'ignore',
    });
    const parentPid = parent.pid;
    assert.ok(Number.isInteger(parentPid));

    const childPid = await waitFor(async () => {
      try {
        const value = Number(await readFile(childReadyPath, 'utf8'));
        return Number.isInteger(value) && value > 0 ? value : null;
      } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
      }
    });

    assert.equal(posixProcessGroupExists(parentPid), true);
    assert.equal(processExists(childPid), true);

    // The descendant ignores SIGTERM, so this call must escalate to SIGKILL.
    await terminateProcessTree(parentPid, { graceMs: 150 });

    assert.equal(posixProcessGroupExists(parentPid), false);
    await waitFor(async () => !processExists(childPid));
    assert.equal(processExists(childPid), false);
  } finally {
    if (parent?.pid && posixProcessGroupExists(parent.pid)) {
      await terminateProcessTree(parent.pid, { graceMs: 100 }).catch(() => {});
    }
    await rm(directory, { recursive: true, force: true });
  }
});
