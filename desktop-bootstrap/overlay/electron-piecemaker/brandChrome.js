const HIDDEN_CHROME_CSS = `
  [data-cc-action="connect"],
  [data-cc-action="logout"],
  [data-cc-action="env-row-menu"],
  [data-cc-nav="cloud"] {
    display: none !important;
  }
`;

function isLauncherDocument(webContents) {
  const url = webContents.getURL();
  return url.startsWith('file://') && url.includes('/launcher/index.html');
}

function applyChrome(webContents) {
  if (!isLauncherDocument(webContents)) return;
  webContents.insertCSS(HIDDEN_CHROME_CSS).catch(() => {});
}

export function brandChrome(window) {
  const { webContents } = window;
  webContents.on('did-finish-load', () => applyChrome(webContents));
  applyChrome(webContents);
}
