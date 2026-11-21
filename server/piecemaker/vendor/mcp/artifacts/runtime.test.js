const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = require('jsdom');

test('a selection spanning nested elements is highlighted at the selected occurrence', { timeout: 3000 }, async () => {
  const runtime = fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8');
  const dom = new JSDOM('<main><p>Durée: trois ans.</p><p>Renouvellement: <strong>trois</strong> ans.</p></main>', { runScripts: 'outside-only' });
  const page = dom.window;
  try {
    let highlight;
    let scrolled = false;
    page.HTMLElement.prototype.scrollIntoView = () => { scrolled = true; };
    Object.assign(page, {
      CSS: { highlights: { set: (_name, value) => { highlight = value; }, delete: () => {} } },
      Highlight: class { constructor(range) { this.range = range; } },
    });
    const selected = new Promise((resolve) => {
      page.postMessage = (message) => { if (message.op === 'selection') resolve(message.args); };
    });
    page.eval(runtime);
    const receive = (message) => page.dispatchEvent(new page.MessageEvent('message', {
      source: page, data: { channel: 'piecemaker-artifact', ...message },
    }));
    receive({ kind: 'review', enabled: true, highlights: [] });
    const first = page.document.querySelector('strong').firstChild;
    const last = page.document.querySelector('p:last-child').lastChild;
    const selection = page.document.createRange();
    selection.setStart(first, 0);
    selection.setEnd(last, 4);
    page.getSelection().addRange(selection);
    page.document.dispatchEvent(new page.Event('selectionchange'));

    const passage = await selected;
    assert.equal(passage.quote, 'trois ans');
    assert.match(passage.before, /Renouvellement/);
    receive({ kind: 'review', enabled: true, highlights: [{ id: 'annotation', passage }] });
    receive({ kind: 'focus-passage', id: 'annotation' });
    assert.equal(highlight.range.startContainer, first);
    assert.equal(highlight.range.toString(), 'trois ans');
    assert.equal(scrolled, true);
  } finally {
    page.close();
  }
});

test('db.get resolves null for a missing document and rejects other errors', { timeout: 3000 }, async () => {
  const runtime = fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8');
  const dom = new JSDOM('<main></main>', { runScripts: 'outside-only' });
  const page = dom.window;
  try {
    const errors = { absent: { message: 'missing', code: 'not_found' }, cassé: { message: 'broken', code: 'internal' } };
    page.postMessage = (message) => {
      if (message.op !== 'get') return;
      page.dispatchEvent(new page.MessageEvent('message', {
        source: page, data: { channel: 'piecemaker-artifact', id: message.id, error: errors[message.args.doc_id] },
      }));
    };
    page.eval(runtime);
    assert.equal(await page.artifact.db.get('compteurs', 'absent'), null);
    await assert.rejects(page.artifact.db.get('compteurs', 'cassé'), /broken/);
  } finally {
    dom.window.close();
  }
});
