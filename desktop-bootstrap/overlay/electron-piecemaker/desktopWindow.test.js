import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';

const source = await fs.readFile(new URL('../../../electron/desktopWindow.js', import.meta.url), 'utf8');
const styles = await fs.readFile(new URL('../../../electron/launcher/launcher.css', import.meta.url), 'utf8');

async function loadWindowManager(platform) {
  const context = createContext({ process: { platform } });
  const mocks = {
    electron: Object.fromEntries(['BrowserWindow', 'Menu', 'Tray', 'clipboard', 'nativeImage', 'nativeTheme', 'session', 'webContents'].map(name => [name, {}])),
    './viewHost.js': { ViewHost: class {} },
  };
  const module = new SourceTextModule(source, { context });
  await module.link(specifier => {
    const exports = mocks[specifier];
    assert.ok(exports, `Unexpected import: ${specifier}`);
    return new SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return new module.namespace.DesktopWindowManager({ actions: {} });
}

for (const platform of ['win32', 'darwin', 'linux']) {
  test(`${platform} uses the CloudCLI content bounds beneath the visible title bar`, async () => {
    const manager = await loadWindowManager(platform);
    const bounds = () => JSON.parse(JSON.stringify(manager.getContentViewBounds()));
    assert.deepEqual(bounds(), { x: 0, y: 44, width: 0, height: 0 });
    let size = [1440, 960];
    manager.mainWindow = { getContentSize: () => size };
    assert.deepEqual(bounds(), { x: 0, y: 44, width: 1440, height: 916 });
    size = [1920, 1080];
    assert.deepEqual(bounds(), { x: 0, y: 44, width: 1920, height: 1036 });
    size = [100, 20];
    assert.deepEqual(bounds(), { x: 0, y: 44, width: 100, height: 0 });
  });
}

test('the launcher retains the visible CloudCLI title bar and system button margins', () => {
  const titlebar = styles.match(/^\.titlebar \{([^}]+)\}/m)?.[1];
  assert.match(titlebar, /display: flex;/);
  assert.match(titlebar, /height: 44px;/);
  assert.match(titlebar, /-webkit-app-region: drag;/);
  assert.match(styles, /body\.mac \.titlebar \{\s+padding-left: 92px;/);
  assert.match(styles, /body\.win \.titlebar \{\s+padding-right: 150px;/);
});
