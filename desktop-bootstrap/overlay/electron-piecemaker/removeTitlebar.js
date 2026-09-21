import { DesktopWindowManager } from '../electron/desktopWindow.js';

export function removeTitlebar() {
  DesktopWindowManager.prototype.getContentViewBounds = function getContentViewBounds() {
    if (!this.mainWindow) return { x: 0, y: 0, width: 0, height: 0 };
    const [width, height] = this.mainWindow.getContentSize();
    return { x: 0, y: 0, width, height };
  };
}
