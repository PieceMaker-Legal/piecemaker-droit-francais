const PRODUCT_NAME = 'PieceMaker';

const HIDDEN_CHROME_CSS = `
  [data-cc-action="connect"],
  [data-cc-action="logout"],
  [data-cc-action="env-row-menu"],
  [data-cc-nav="cloud"] {
    display: none !important;
  }
  .titlebar {
    background: transparent !important;
    border: none !important;
    -webkit-app-region: drag;
  }
  .titlebar > *:not(.brand) {
    display: none !important;
  }
  .titlebar .brand {
    margin-left: 72px;
  }
`;

const RENAME_SCRIPT = `(() => {
  const PRODUCT = ${JSON.stringify(PRODUCT_NAME)};
  const PATTERN = /CloudCLI/g;
  if (window.__piecemakerRenamed) return;
  window.__piecemakerRenamed = true;
  const rename = () => {
    if (document.title.includes('CloudCLI')) document.title = document.title.replace(PATTERN, PRODUCT);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const pending = [];
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue.includes('CloudCLI')) pending.push(walker.currentNode);
    }
    for (const node of pending) node.nodeValue = node.nodeValue.replace(PATTERN, PRODUCT);
    for (const element of document.querySelectorAll('[title*="CloudCLI"], [placeholder*="CloudCLI"], [aria-label*="CloudCLI"]')) {
      for (const name of ['title', 'placeholder', 'aria-label']) {
        const value = element.getAttribute(name);
        if (value && value.includes('CloudCLI')) element.setAttribute(name, value.replace(PATTERN, PRODUCT));
      }
    }
  };
  rename();
  new MutationObserver(rename).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();`;

function isLauncherDocument(webContents) {
  const url = webContents.getURL();
  return url.startsWith('file://') && url.includes('/launcher/index.html');
}

function applyChrome(webContents) {
  if (!isLauncherDocument(webContents)) return;
  webContents.insertCSS(HIDDEN_CHROME_CSS).catch(() => {});
  webContents.executeJavaScript(RENAME_SCRIPT, true).catch(() => {});
}

export function brandChrome(window) {
  const { webContents } = window;
  webContents.on('did-finish-load', () => applyChrome(webContents));
  applyChrome(webContents);
}
