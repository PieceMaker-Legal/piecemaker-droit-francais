const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  markFilesAnonymized,
  readAnonymizationState,
  stateKey,
} = require('../piecemaker-plugin/scripts/lib/anonymization-state.cjs');
const { listOriginals } = require('./originals-pipeline.cjs');
const { documentIndexFile } = require('./document-index.cjs');

const CONVERTED = 'Fichiers convertis PieceMaker';
const RECEIVED_AT = new Date('2026-01-15T10:00:00Z');

function convertedCase(pieces) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'renamed-originals-')));
  fs.mkdirSync(path.join(root, CONVERTED));
  for (const piece of pieces) {
    fs.writeFileSync(path.join(root, piece), `%PDF ${piece}`);
    fs.utimesSync(path.join(root, piece), RECEIVED_AT, RECEIVED_AT);
    fs.writeFileSync(path.join(root, CONVERTED, `${path.basename(piece, '.pdf')}.md`), `# ${piece}\n`);
  }
  markFilesAnonymized(root, pieces.map((piece) => path.join(root, piece)));
  fs.writeFileSync(documentIndexFile(root), JSON.stringify({
    version: 2,
    documents: Object.fromEntries(pieces.map((piece) => [stateKey(piece), { nature: 'assignation' }])),
    overrides: Object.fromEntries(pieces.map((piece) => [stateKey(piece), { nature: 'jugement' }])),
    entityDecisions: {},
    revisions: pieces.map((piece, index) => ({ revision: index + 1, documentKey: stateKey(piece), field: 'nature' })),
  }));
  return root;
}

const readIndex = (root) => JSON.parse(fs.readFileSync(documentIndexFile(root), 'utf8'));

test('renommer une pièce convertie renomme son Markdown et conserve son état', async () => {
  const root = convertedCase(['Pièce 12.pdf']);
  try {
    fs.renameSync(path.join(root, 'Pièce 12.pdf'), path.join(root, 'Assignation TJ Paris.pdf'));

    const [original] = await listOriginals(root);

    assert.strictEqual(original.path, 'Assignation TJ Paris.pdf');
    assert.strictEqual(original.status, 'ready');
    assert.deepStrictEqual(fs.readdirSync(path.join(root, CONVERTED)), ['Assignation TJ Paris.md']);
    const newKey = stateKey('Assignation TJ Paris.pdf');
    assert.deepStrictEqual(Object.keys(readAnonymizationState(root).files), [newKey]);
    const index = readIndex(root);
    assert.deepStrictEqual(Object.keys(index.documents), [newKey]);
    assert.deepStrictEqual(Object.keys(index.overrides), [newKey]);
    assert.strictEqual(index.revisions[0].documentKey, newKey);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('une copie de pièce ne détourne pas le Markdown de l’original', async () => {
  const root = convertedCase(['Pièce 12.pdf']);
  try {
    const original = path.join(root, 'Pièce 12.pdf');
    const copy = path.join(root, 'Pièce 12 copie.pdf');
    fs.copyFileSync(original, copy);
    fs.utimesSync(copy, RECEIVED_AT, RECEIVED_AT);

    await listOriginals(root);

    assert.deepStrictEqual(fs.readdirSync(path.join(root, CONVERTED)), ['Pièce 12.md']);
    assert.deepStrictEqual(Object.keys(readAnonymizationState(root).files), [stateKey('Pièce 12.pdf')]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deux candidats identiques pour un même ancien nom : rien n’est renommé', async () => {
  const root = convertedCase(['Pièce 12.pdf']);
  try {
    const original = path.join(root, 'Pièce 12.pdf');
    const duplicate = path.join(root, 'Doublon.pdf');
    fs.copyFileSync(original, duplicate);
    fs.utimesSync(duplicate, RECEIVED_AT, RECEIVED_AT);
    fs.renameSync(original, path.join(root, 'Assignation.pdf'));

    await listOriginals(root);

    assert.deepStrictEqual(fs.readdirSync(path.join(root, CONVERTED)), ['Pièce 12.md']);
    assert.deepStrictEqual(Object.keys(readIndex(root).documents), [stateKey('Pièce 12.pdf')]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
