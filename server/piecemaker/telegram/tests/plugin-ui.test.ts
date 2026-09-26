import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const { JSDOM } = createRequire(import.meta.url)('jsdom');

test('Telegram tab guides setup and escapes project names', async () => {
  const dom = new JSDOM('<div id="tab"></div>');
  const globals = globalThis as unknown as { document?: unknown };
  const previousDocument = globals.document;
  globals.document = dom.window.document;
  try {
    const modulePath = pathToFileURL(path.resolve('server/piecemaker/telegram/assets/index.js')).href;
    const plugin = await import(modulePath);
    const container = dom.window.document.getElementById('tab');
    plugin.mount(container, {
      context: { project: null, theme: 'light', session: null },
      onContextChange: () => () => {},
      rpc: async () => ({
        installed: false, mainOnline: false, mainError: '', bots: [],
        projects: [{ id: 'case-1', path: '/tmp/case', name: '<script>intrus</script>' }],
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(container.textContent || '', /Guide rapide/);
    assert.match(container.textContent || '', /Installer depuis la bibliothèque/);
    assert.match(container.textContent || '', /<script>intrus<\/script>/);
    assert.equal(container.querySelector('script'), null);
    plugin.unmount(container);
    assert.equal(container.childElementCount, 0);
  } finally {
    globals.document = previousDocument;
    dom.window.close();
  }
});
