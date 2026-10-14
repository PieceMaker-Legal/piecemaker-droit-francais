export const WINDOWS_TITLEBAR_HEIGHT = 44;
export const WINDOWS_TITLEBAR_CSS = 'body.win:not(.cc-modal-window) .titlebar { display: flex; background: var(--s1); }';

export function installWindowsTitleBar({ app, DesktopWindowManager, platform = process.platform }) {
  if (platform !== 'win32') return;

  DesktopWindowManager.prototype.getContentViewBounds = function () {
    if (!this.mainWindow) return { x: 0, y: WINDOWS_TITLEBAR_HEIGHT, width: 0, height: 0 };
    const [width, height] = this.mainWindow.getContentSize();
    return {
      x: 0,
      y: WINDOWS_TITLEBAR_HEIGHT,
      width,
      height: Math.max(0, height - WINDOWS_TITLEBAR_HEIGHT),
    };
  };

  app.on('browser-window-created', (_event, window) => {
    if (window.getParentWindow()) return;
    window.webContents.on('did-finish-load', () => {
      window.webContents.insertCSS(WINDOWS_TITLEBAR_CSS).catch((error) => {
        console.error(`[PieceMaker] Barre de titre Windows : ${error.message}`);
      });
    });
  });
}
