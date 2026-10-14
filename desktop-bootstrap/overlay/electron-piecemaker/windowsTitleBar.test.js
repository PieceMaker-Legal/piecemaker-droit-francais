import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { installWindowsTitleBar, WINDOWS_TITLEBAR_CSS } from './windowsTitleBar.js';

function harness(platform) {
  class DesktopWindowManager {
    getContentViewBounds() {
      return { x: 0, y: 0, width: 1000, height: 700 };
    }
  }
  const app = new EventEmitter();
  installWindowsTitleBar({ app, DesktopWindowManager, platform });
  return { app, manager: new DesktopWindowManager() };
}

test('Windows reserves the title bar on every content bounds calculation', () => {
  const { manager } = harness('win32');
  assert.deepEqual(manager.getContentViewBounds(), { x: 0, y: 44, width: 0, height: 0 });
  let size = [1440, 960];
  manager.mainWindow = { getContentSize: () => size };
  assert.deepEqual(manager.getContentViewBounds(), { x: 0, y: 44, width: 1440, height: 916 });
  size = [1920, 1080];
  assert.deepEqual(manager.getContentViewBounds(), { x: 0, y: 44, width: 1920, height: 1036 });
  size = [100, 20];
  assert.equal(manager.getContentViewBounds().height, 0);
});

test('Windows restores the launcher title bar after each load and excludes child windows', async () => {
  const { app } = harness('win32');
  const webContents = new EventEmitter();
  const styles = [];
  webContents.insertCSS = async (css) => styles.push(css);
  app.emit('browser-window-created', {}, { getParentWindow: () => null, webContents });
  webContents.emit('did-finish-load');
  webContents.emit('did-finish-load');
  await Promise.resolve();
  assert.deepEqual(styles, [WINDOWS_TITLEBAR_CSS, WINDOWS_TITLEBAR_CSS]);
  const childContents = new EventEmitter();
  app.emit('browser-window-created', {}, { getParentWindow: () => ({}), webContents: childContents });
  assert.equal(childContents.listenerCount('did-finish-load'), 0);
});

for (const platform of ['darwin', 'linux']) {
  test(`${platform} retains its existing window layout`, () => {
    const { app, manager } = harness(platform);
    assert.deepEqual(manager.getContentViewBounds(), { x: 0, y: 0, width: 1000, height: 700 });
    assert.equal(app.listenerCount('browser-window-created'), 0);
  });
}
