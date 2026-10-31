import assert from 'node:assert/strict';
import test from 'node:test';
import { removeExternalLegifrancePlugin } from './legacy-legifrance.mjs';

const silent = { info() {} };

function fakeClaude({ plugins = [], marketplaces = [], listCode = 0 } = {}) {
  const calls = [];
  const capture = (command, args) => {
    calls.push(args.join(' '));
    if (args.at(-1) !== '--json') return { code: 0, stdout: '' };
    return { code: listCode, stdout: JSON.stringify(args.includes('marketplace') ? marketplaces : plugins) };
  };
  return { calls, capture };
}

test('retire le plugin externe et son catalogue', () => {
  const claude = fakeClaude({ plugins: [{ id: 'piecemaker@mcp-legifrance' }], marketplaces: [{ name: 'mcp-legifrance' }] });
  const removed = removeExternalLegifrancePlugin({ capture: claude.capture, logger: silent });
  assert.deepEqual(removed, ['piecemaker@mcp-legifrance', 'mcp-legifrance']);
  assert.ok(claude.calls.includes('plugin uninstall piecemaker@mcp-legifrance'));
  assert.ok(claude.calls.includes('plugin marketplace remove mcp-legifrance'));
});

test('ne touche à rien sans plugin externe', () => {
  const claude = fakeClaude({ plugins: [{ id: 'autre@catalogue' }], marketplaces: [{ name: 'catalogue' }] });
  assert.deepEqual(removeExternalLegifrancePlugin({ capture: claude.capture, logger: silent }), []);
  assert.equal(claude.calls.length, 2);
});

test('ne fait rien sans CLI Claude', () => {
  const claude = fakeClaude({ listCode: 1 });
  assert.deepEqual(removeExternalLegifrancePlugin({ capture: claude.capture, logger: silent }), []);
});
