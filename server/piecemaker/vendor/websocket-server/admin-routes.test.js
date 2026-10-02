const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { chronologyScopeFromFolder, loadAdminChronology, normalizeChronologyScope, scopeChronology } = require('./admin-routes.cjs');

test('loads only the opened case chronology from its document index', async () => {
  const localChronology = { documents: [], deanonymized: false };
  let builds = 0;
  let loadedRoot = null;
  const result = await loadAdminChronology({
    caseRoot: '/opened-case',
    buildLocalChronology: async (caseRoot) => {
      builds += 1;
      loadedRoot = caseRoot;
      return localChronology;
    },
  });

  assert.equal(builds, 1);
  assert.equal(loadedRoot, '/opened-case');
  assert.equal(result, localChronology);
});

test('scopes a chronology to one subfolder and keeps the dossier folder choices', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-chronology-scope-'));
  fs.mkdirSync(path.join(root, 'Pieces', 'Alpha'), { recursive: true });
  try {
    const alpha = { documentKey: 'a'.repeat(64), id: 'Pieces/Alpha/a.pdf', path: 'Pieces/Alpha/a.pdf', indexed: true, dateIso: '2024-01-01', codes: [] };
    const beta = { documentKey: 'b'.repeat(64), id: 'Pieces/Beta/b.pdf', path: 'Pieces/Beta/b.pdf', indexed: true, dateIso: '2024-02-01', codes: [] };
    const chronology = {
      documents: [alpha, beta],
      datedDocuments: [alpha, beta],
      undatedDocuments: [],
      entities: [{ code: 'party', documents: [alpha.id, beta.id] }],
      stats: { documents: 2, indexed: 2, dated: 2, entities: 1, span: { from: alpha.dateIso, to: beta.dateIso } },
    };

    assert.equal(normalizeChronologyScope(root, 'Pieces/Alpha'), 'Pieces/Alpha');
    assert.equal(chronologyScopeFromFolder(root, path.join(root, 'Pieces', 'Alpha')), 'Pieces/Alpha');
    const scoped = scopeChronology(chronology, 'Pieces/Alpha');
    assert.deepEqual(scoped.documents, [alpha]);
    assert.deepEqual(scoped.folders, ['Pieces', 'Pieces/Alpha', 'Pieces/Beta']);
    assert.deepEqual(scoped.stats, { documents: 1, indexed: 1, dated: 1, entities: 1, span: { from: '2024-01-01', to: '2024-01-01' } });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('rejects a chronology scope outside the legal case', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-chronology-scope-'));
  try {
    assert.throws(() => normalizeChronologyScope(root, '../outside'), /Sous-dossier invalide/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
