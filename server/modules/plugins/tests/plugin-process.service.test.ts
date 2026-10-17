import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  isPluginRunning, startPluginServer, stopAllPlugins,
} from '../plugin-process.service.js';

test('stopAllPlugins stops a plugin that reports ready after shutdown starts', async () => {
  const pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-lifecycle-'));
  const serverPath = path.join(pluginDir, 'server.js');
  const pluginName = `lifecycle-${process.pid}`;
  await fs.writeFile(serverPath, "setInterval(() => {}, 1000); setTimeout(() => process.stdout.write(JSON.stringify({ ready: true, port: 4321 }) + '\\n'), 100);");

  try {
    const start = startPluginServer(pluginName, pluginDir, 'server.js');
    const stop = stopAllPlugins();

    await Promise.all([start, stop]);

    assert.equal(isPluginRunning(pluginName), false);
    await assert.rejects(startPluginServer('late-plugin', pluginDir, 'server.js'), /shutting down/);
  } finally {
    await stopAllPlugins();
    await fs.rm(pluginDir, { recursive: true, force: true });
  }
});
