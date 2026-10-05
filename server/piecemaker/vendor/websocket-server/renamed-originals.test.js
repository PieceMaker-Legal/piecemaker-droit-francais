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
const { readProtection, writeProtection } = require('../piecemaker-plugin/scripts/lib/protection.cjs');
const { listOriginals } = require('./originals-pipeline.cjs');
const { documentIndexFile } = require('./document-index.cjs');
const { renamePiece } = require('./renamed-originals.cjs');

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

test('renommer à la main une pièce reporte aussi sa levée de protection', async () => {
  const root = convertedCase(['Pièce 12.pdf']);
  try {
    writeProtection(root, { unprotected: ['Pièce 12.pdf'], resources: [] });
    fs.renameSync(path.join(root, 'Pièce 12.pdf'), path.join(root, 'Assignation.pdf'));

    await listOriginals(root);

    assert.deepStrictEqual([...readProtection(root).unprotected], ['Assignation.pdf']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renamePiece renomme la pièce, son Markdown et tout son état', async () => {
  const root = convertedCase(['Pièce 12.pdf']);
  try {
    writeProtection(root, { unprotected: [], resources: ['Pièce 12.pdf'] });

    const result = await renamePiece(root, 'Pièce 12.pdf', '2024-01-09_Jugement du Tribunal judiciaire de Paris');

    const current = '2024-01-09_Jugement du Tribunal judiciaire de Paris.pdf';
    assert.deepStrictEqual(result, {
      previous: 'Pièce 12.pdf',
      current,
      markdown: `${CONVERTED}/2024-01-09_Jugement du Tribunal judiciaire de Paris.md`,
    });
    assert.ok(fs.existsSync(path.join(root, current)));
    assert.deepStrictEqual(fs.readdirSync(path.join(root, CONVERTED)), ['2024-01-09_Jugement du Tribunal judiciaire de Paris.md']);
    const newKey = stateKey(current);
    assert.deepStrictEqual(Object.keys(readAnonymizationState(root).files), [newKey]);
    const index = readIndex(root);
    assert.deepStrictEqual(Object.keys(index.documents), [newKey]);
    assert.deepStrictEqual(Object.keys(index.overrides), [newKey]);
    assert.strictEqual(index.revisions[0].documentKey, newKey);
    assert.deepStrictEqual([...readProtection(root).resources], [current]);
    const [original] = await listOriginals(root);
    assert.strictEqual(original.status, 'ready');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renamePiece garde la pièce dans son sous-dossier', async () => {
  const root = convertedCase([]);
  try {
    fs.mkdirSync(path.join(root, 'Correspondance'));
    fs.writeFileSync(path.join(root, 'Correspondance', 'courrier.pdf'), '%PDF');

    const result = await renamePiece(root, path.join(root, 'Correspondance', 'courrier.pdf'), '2024-02-01_Lettre de mise en demeure');

    assert.strictEqual(result.current, 'Correspondance/2024-02-01_Lettre de mise en demeure.pdf');
    assert.strictEqual(result.markdown, null);
    assert.ok(fs.existsSync(path.join(root, 'Correspondance', '2024-02-01_Lettre de mise en demeure.pdf')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renamePiece refuse un nom hors format', async () => {
  const root = convertedCase(['Pièce 12.pdf']);
  try {
    for (const name of ['Jugement', '2024-02-31_Jugement', '2024-01-09_', '2024-01-09_Société A c/ Société B', `2024-01-09_${'x'.repeat(150)}`]) {
      await assert.rejects(renamePiece(root, 'Pièce 12.pdf', name), TypeError, name);
    }
    assert.ok(fs.existsSync(path.join(root, 'Pièce 12.pdf')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renamePiece refuse un nom déjà porté par une pièce d’un autre sous-dossier', async () => {
  const root = convertedCase(['Pièce 12.pdf']);
  try {
    fs.mkdirSync(path.join(root, 'Annexes'));
    fs.writeFileSync(path.join(root, 'Annexes', '2024-01-09_Jugement.docx'), 'docx');

    await assert.rejects(renamePiece(root, 'Pièce 12.pdf', '2024-01-09_jugement'), /porte déjà ce nom/);
    assert.deepStrictEqual(fs.readdirSync(path.join(root, CONVERTED)), ['Pièce 12.md']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renamePiece refuse une pièce inconnue', async () => {
  const root = convertedCase([]);
  try {
    await assert.rejects(renamePiece(root, 'absente.pdf', '2024-01-09_Jugement'), /introuvable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renamePiece range une pièce dans un nouveau sous-dossier sans toucher à son Markdown', async () => {
  const root = convertedCase(['Pièce 12.pdf']);
  try {
    writeProtection(root, { unprotected: ['Pièce 12.pdf'], resources: [] });

    const result = await renamePiece(root, 'Pièce 12.pdf', '', 'Procédure/Jugements');

    const current = 'Procédure/Jugements/Pièce 12.pdf';
    assert.deepStrictEqual(result, { previous: 'Pièce 12.pdf', current, markdown: `${CONVERTED}/Pièce 12.md` });
    assert.ok(fs.existsSync(path.join(root, 'Procédure', 'Jugements', 'Pièce 12.pdf')));
    assert.deepStrictEqual(Object.keys(readAnonymizationState(root).files), [stateKey(current)]);
    assert.deepStrictEqual(Object.keys(readIndex(root).documents), [stateKey(current)]);
    assert.deepStrictEqual([...readProtection(root).unprotected], [current]);
    const [original] = await listOriginals(root);
    assert.strictEqual(original.status, 'ready');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renamePiece renomme et range en une fois, et ramène une pièce à la racine', async () => {
  const root = convertedCase(['Pièce 12.pdf']);
  try {
    await renamePiece(root, 'Pièce 12.pdf', '2024-01-09_Jugement', 'Procédure');
    assert.deepStrictEqual(fs.readdirSync(path.join(root, CONVERTED)), ['2024-01-09_Jugement.md']);

    const back = await renamePiece(root, 'Procédure/2024-01-09_Jugement.pdf', undefined, '');

    assert.strictEqual(back.current, '2024-01-09_Jugement.pdf');
    assert.ok(fs.existsSync(path.join(root, '2024-01-09_Jugement.pdf')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renamePiece refuse de ranger hors du dossier ou dans un dossier produit par PieceMaker', async () => {
  const root = convertedCase(['Pièce 12.pdf']);
  try {
    for (const directory of ['../ailleurs', '.piecemaker', CONVERTED, 'Tabular Review/docs', 'Pièces tamponnées']) {
      await assert.rejects(renamePiece(root, 'Pièce 12.pdf', '', directory), TypeError, directory);
    }
    assert.ok(fs.existsSync(path.join(root, 'Pièce 12.pdf')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
