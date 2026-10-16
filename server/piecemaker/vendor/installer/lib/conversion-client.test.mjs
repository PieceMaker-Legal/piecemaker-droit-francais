import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  adoptedServerHome,
  adoptRunningServerPort,
  runningServerMarkerPaths,
  runningServerPort,
} from './conversion-client.mjs';

function writeMarker(file, { port, pid = process.pid, host = '127.0.0.1' }) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ pid, host, port }));
}

async function withPortEnv(run) {
  const previous = process.env.PIECEMAKER_APP_PORT;
  delete process.env.PIECEMAKER_APP_PORT;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.PIECEMAKER_APP_PORT;
    else process.env.PIECEMAKER_APP_PORT = previous;
  }
}

describe('conversion-client adoptRunningServerPort', { concurrency: 1 }, () => {
test('runningServerMarkerPaths place le dossier -dev avant le bureau', () => {
  const home = '/tmp/pm-home';
  const paths = runningServerMarkerPaths({ env: {}, homedir: () => home });
  assert.deepEqual(paths, [
    path.join(home, '.piecemaker-droit-francais-dev', 'local-server.json'),
    path.join(home, '.piecemaker-droit-francais', 'local-server.json'),
    path.join(home, '.piecemaker', 'local-server.json'),
  ]);
  assert.deepEqual(
    runningServerMarkerPaths({ env: { CLOUDCLI_HOME: '/tmp/cloudcli-home' }, homedir: () => home }),
    [path.join('/tmp/cloudcli-home', 'local-server.json')],
  );
});

test('adoptRunningServerPort préfère le serveur de développement joignable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-adopt-'));
  const dev = path.join(root, 'dev', 'local-server.json');
  const desk = path.join(root, 'desk', 'local-server.json');
  writeMarker(dev, { port: 3003 });
  writeMarker(desk, { port: 3101 });
  const seen = [];
  await withPortEnv(async () => {
    const port = await adoptRunningServerPort({
      markerPaths: [dev, desk],
      reachable: async (candidate) => {
        seen.push(candidate);
        return true;
      },
    });
    assert.equal(port, 3003);
    assert.equal(process.env.PIECEMAKER_APP_PORT, '3003');
    assert.equal(adoptedServerHome(), path.dirname(dev));
    assert.deepEqual(seen, [3003]);
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('adoptRunningServerPort saute un marqueur mort ou injoignable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-adopt-skip-'));
  const dead = path.join(root, 'dev', 'local-server.json');
  const desk = path.join(root, 'desk', 'local-server.json');
  writeMarker(dead, { port: 3003, pid: 1_000_000_041 });
  writeMarker(desk, { port: 3101 });
  await withPortEnv(async () => {
    const port = await adoptRunningServerPort({
      markerPaths: [dead, desk],
      reachable: async (candidate) => candidate === 3101,
    });
    assert.equal(port, 3101);
    assert.equal(adoptedServerHome(), path.dirname(desk));
  });
  fs.rmSync(root, { recursive: true, force: true });
});

test('adoptRunningServerPort adopte un port encore servi après un pid périmé', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-adopt-stale-'));
  const stale = path.join(root, 'dev', 'local-server.json');
  writeMarker(stale, { port: 3003, pid: 1_000_000_042 });
  assert.equal(runningServerPort(stale), null);
  await withPortEnv(async () => {
    const port = await adoptRunningServerPort({
      markerPaths: [stale],
      reachable: async () => true,
    });
    assert.equal(port, 3003);
    assert.equal(adoptedServerHome(), path.dirname(stale));
  });
  fs.rmSync(root, { recursive: true, force: true });
});
});
