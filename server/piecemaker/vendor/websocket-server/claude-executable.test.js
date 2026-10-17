const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const { bundledClaudeExecutable, claudeExecutable } = require('./claude-executable.cjs');

const appData = 'C:\\Users\\jean.dupont\\AppData\\Roaming';
const bundleRoot = path.win32.join(appData, 'Claude', 'claude-code');
const fakeFileSystem = (tree) => ({
  readdirSync: (directory) => {
    if (!(directory in tree)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return tree[directory];
  },
  existsSync: (file) => Boolean(tree.files?.includes(file)),
});
const bundled = fakeFileSystem({
  [bundleRoot]: ['2.1.9', '2.1.10'],
  [path.win32.join(bundleRoot, '2.1.10')]: ['abc'],
  [path.win32.join(bundleRoot, '2.1.9')]: ['def'],
  files: [path.win32.join(bundleRoot, '2.1.10', 'abc', 'claude.exe'), path.win32.join(bundleRoot, '2.1.9', 'def', 'claude.exe')],
});
const missing = () => { throw new Error('INFO: Could not find files'); };

test('the newest Claude desktop bundle is used when claude is not on PATH', () => {
  assert.equal(bundledClaudeExecutable(appData, bundled), path.win32.join(bundleRoot, '2.1.10', 'abc', 'claude.exe'));
  assert.equal(
    claudeExecutable({ platform: 'win32', env: { APPDATA: appData }, fileSystem: bundled, lookup: missing }),
    path.win32.join(bundleRoot, '2.1.10', 'abc', 'claude.exe'),
  );
});

test('a claude found on PATH wins, an .exe before a .cmd shim', () => {
  const lookup = () => 'C:\\npm\\claude\r\nC:\\npm\\claude.cmd\r\nC:\\Tools\\claude.exe\r\n';
  assert.equal(claudeExecutable({ platform: 'win32', env: { APPDATA: appData }, fileSystem: bundled, lookup }), 'C:\\Tools\\claude.exe');
  const shimOnly = () => 'C:\\npm\\claude.cmd\r\n';
  assert.equal(claudeExecutable({ platform: 'win32', env: {}, lookup: shimOnly }), 'C:\\npm\\claude.cmd');
});

test('CLAUDE_CLI_PATH overrides, and nothing found falls back to the claude.cmd shim', () => {
  assert.equal(claudeExecutable({ platform: 'win32', env: { CLAUDE_CLI_PATH: '"D:\\claude.exe"' }, lookup: missing }), 'D:\\claude.exe');
  assert.equal(claudeExecutable({ platform: 'win32', env: { APPDATA: appData }, fileSystem: fakeFileSystem({}), lookup: missing }), 'claude.cmd');
  assert.equal(claudeExecutable({ platform: 'darwin', env: {} }), 'claude');
});
