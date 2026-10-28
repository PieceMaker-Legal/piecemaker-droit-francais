import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const mac = { skip: process.platform !== 'darwin' };
const installer = new URL('../install.sh', import.meta.url).pathname;

async function fixture(t, { legacy = false, missing = false, checksum = true, corrupt = false, exitCode = 0 } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-bootstrap-mac-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const app = path.join(root, 'source', 'PieceMaker.app');
  const appRoot = path.join(app, 'Contents/Resources/app');
  const home = path.join(root, 'bootstrap');
  const log = path.join(root, 'requests');
  await fs.mkdir(bin);
  await fs.mkdir(path.join(home, 'prebuilt/fixture-bootstrap/historical'), { recursive: true });
  await fs.mkdir(path.join(app, 'Contents/MacOS'), { recursive: true });
  await fs.mkdir(path.join(appRoot, 'desktop-bootstrap/lib'), { recursive: true });
  await fs.writeFile(path.join(app, 'Contents/MacOS/PieceMaker'), `#!/bin/sh\nprintf "%s\\n" "$ELECTRON_RUN_AS_NODE" "$PIECEMAKER_SRC_DIR" "$PIECEMAKER_PREBUILT_APP_PATH" "$@" > "$FIXTURE_EXECUTION"\nexit ${exitCode}\n`, { mode: 0o755 });
  if (!legacy) await fs.writeFile(path.join(appRoot, 'desktop-bootstrap/lib/install.mjs'), 'fixture');
  await fs.mkdir(path.join(app, 'Contents/Frameworks/Fixture.framework/Versions/A'), { recursive: true });
  await fs.symlink('A', path.join(app, 'Contents/Frameworks/Fixture.framework/Versions/Current'));
  const archive = path.join(root, 'fixture.tar.gz');
  const pack = async (entries = ['PieceMaker.app']) => {
    execFileSync('/usr/bin/tar', ['-czf', archive, '-C', path.dirname(app), ...entries]);
    const hash = crypto.createHash('sha256').update(await fs.readFile(archive)).digest('hex');
    await fs.writeFile(`${archive}.sha256`, corrupt ? '0'.repeat(64) : hash);
  };
  await pack();
  await fs.writeFile(path.join(bin, 'curl'), `#!/bin/sh
output=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output="$2"; shift 2 ;;
    -w) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\\n' "$url" >> "$FIXTURE_REQUESTS"
case "$url" in
  *desktop-darwin-*.tar.gz.sha256) ${checksum ? 'cp "$FIXTURE_ARCHIVE.sha256" "$output"; printf 200' : 'printf 404; exit 22'} ;;
  *desktop-darwin-*.tar.gz) ${missing ? 'printf 404; exit 22' : 'cp "$FIXTURE_ARCHIVE" "$output"; printf 200'} ;;
  *) exit 91 ;;
esac
`, { mode: 0o755 });
  const run = () => spawnSync('/bin/sh', [installer, '--no-launch', '--no-certificate', '--no-progress'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`, PIECEMAKER_TAG: 'fixture-bootstrap', PIECEMAKER_BOOTSTRAP_HOME: home, FIXTURE_ARCHIVE: archive, FIXTURE_REQUESTS: log, FIXTURE_EXECUTION: path.join(root, 'executed') },
  });
  return { root, app, home, log, pack, run };
}

test('verified Mac bundle uses its embedded Node and shipped installer without source or toolchain downloads', mac, async (t) => {
  const { root, home, log, run } = await fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const executed = await fs.readFile(path.join(root, 'executed'), 'utf8');
  assert.match(executed, /^1\n/);
  assert.match(executed, /Contents\/Resources\/app\n/);
  assert.match(executed, /PieceMaker.app\n.*desktop-bootstrap\/lib\/install.mjs\n--no-launch\n--no-certificate\n--no-progress\n/s);
  const requests = await fs.readFile(log, 'utf8');
  assert.doesNotMatch(requests, /codeload|nodejs/);
  assert.deepEqual(await fs.readdir(path.join(home, 'prebuilt/fixture-bootstrap')), []);
});

test('successful Mac install removes downloads left by earlier versions', mac, async (t) => {
  const { home, run } = await fixture(t);
  for (const stale of ['prebuilt/v0.0.1/archive', 'src/v0.0.1/node_modules', 'toolchain/node-v22.0.0-darwin-arm64/bin']) {
    await fs.mkdir(path.join(home, stale), { recursive: true });
  }
  assert.equal(run().status, 0);
  assert.deepEqual((await fs.readdir(home)).sort(), ['prebuilt']);
  assert.deepEqual(await fs.readdir(path.join(home, 'prebuilt')), ['fixture-bootstrap']);
});

test('failed embedded preparation preserves its exit code and removes only its transaction', mac, async (t) => {
  const { home, run } = await fixture(t, { exitCode: 7 });
  await fs.mkdir(path.join(home, 'src/v0.0.1'), { recursive: true });
  assert.equal(run().status, 7);
  assert.deepEqual(await fs.readdir(path.join(home, 'src')), ['v0.0.1']);
  assert.deepEqual(await fs.readdir(path.join(home, 'prebuilt/fixture-bootstrap')), ['historical']);
});

for (const [name, options] of [['checksum mismatch', { corrupt: true }], ['missing checksum', { checksum: false }]]) {
  test(`Mac bootstrap stops on ${name} before executing a bundle or downloading sources`, mac, async (t) => {
    const { root, log, run } = await fixture(t, options);
    const result = run();
    assert.notEqual(result.status, 0);
    assert.equal(await fs.stat(path.join(root, 'executed')).then(() => true, () => false), false);
    assert.doesNotMatch(await fs.readFile(log, 'utf8'), /codeload|nodejs/);
  });
}

for (const [name, options] of [['old bundle without preparation scripts', { legacy: true }], ['release without a bundle', { missing: true }]]) {
  test(`Mac bootstrap keeps the historical source fallback for ${name}`, mac, async (t) => {
    const { log, run } = await fixture(t, options);
    assert.notEqual(run().status, 0);
    assert.match(await fs.readFile(log, 'utf8'), /codeload/);
  });
}

test('Mac bootstrap refuses an external bundle symlink before executing embedded Node', mac, async (t) => {
  const { root, app, pack, run } = await fixture(t);
  await fs.symlink('/usr/bin', path.join(app, 'Contents/External'));
  await pack();
  assert.notEqual(run().status, 0);
  assert.equal(await fs.stat(path.join(root, 'executed')).then(() => true, () => false), false);
});

test('Mac bootstrap refuses a parent-directory bundle symlink before executing embedded Node', mac, async (t) => {
  const { root, app, pack, run } = await fixture(t);
  await fs.symlink('../..', path.join(app, 'Contents/External'));
  await pack();
  assert.notEqual(run().status, 0);
  assert.equal(await fs.stat(path.join(root, 'executed')).then(() => true, () => false), false);
});
