const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  assertNotTechnicalPath,
  CONVERTED_FOLDER,
  GENERATED_FOLDERS,
  isIgnoredName,
  isTechnicalName,
  isTechnicalPath,
  STAMPED_FOLDER,
} = require('./technical-paths.cjs');
const { originalFilesOverview } = require('./commits.cjs');
const { WORKSPACE_SUBDIR } = require('./protection.cjs');
const { STAMPED_PIECES_SUBFOLDER } = require('../../../websocket-server/lib/stamping.cjs');
const { renamePiece } = require('../../../websocket-server/renamed-originals.cjs');

test('la liste couvre les dossiers cachés, de code et produits par PieceMaker', () => {
  for (const name of ['.piecemaker', '.git', '.DS_Store', '~$bail.docx', 'node_modules', 'Node_Modules', '__pycache__', 'venv', 'piecemaker_output']) {
    assert.ok(isIgnoredName(name), name);
    assert.ok(isTechnicalName(name), name);
  }
  for (const name of GENERATED_FOLDERS) {
    assert.ok(!isIgnoredName(name), name);
    assert.ok(isTechnicalName(name), name);
  }
  for (const name of ['Pièces', 'Contrats', 'bail.pdf', 'Correspondance', 'piecemaker']) assert.ok(!isTechnicalName(name), name);
});

test('un chemin est technique dès qu’un de ses segments l’est', () => {
  for (const relative of [
    '.piecemaker/document-index.json',
    '.piecemaker/catala/regle/source.md',
    `${CONVERTED_FOLDER}/2024-01-02_bail-0123456789abcdef.md`,
    `Pièces/${CONVERTED_FOLDER}/bail.md`,
    'fichiers convertis piecemaker/bail.md',
    'Tabular Review/Index.xlsx',
    `${STAMPED_FOLDER}/bail.pdf`,
    'Pièces/.git/HEAD',
    'Pièces\\node_modules\\x.js',
    '../ailleurs/bail.pdf',
  ]) assert.ok(isTechnicalPath(relative), relative);
  for (const relative of ['bail.pdf', 'Pièces/Contrats/bail.pdf', 'Notes/synthese.md', '', 'Pièces/piecemaker.pdf']) {
    assert.ok(!isTechnicalPath(relative), relative);
  }
  assert.throws(() => assertNotTechnicalPath('.piecemaker/x.json'), /dossier technique/);
  assert.doesNotThrow(() => assertNotTechnicalPath('Pièces/bail.pdf'));
});

test('les modules historiques reprennent les noms de la liste', () => {
  assert.strictEqual(WORKSPACE_SUBDIR, CONVERTED_FOLDER);
  assert.strictEqual(STAMPED_PIECES_SUBFOLDER, STAMPED_FOLDER);
});

function makeCase() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'technical-paths-')));
  const write = (relative, content = 'x') => {
    const file = path.join(root, ...relative.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  write('Pièces/2024-01-02_bail.pdf');
  write(`${CONVERTED_FOLDER}/2024-01-02_bail.md`, '# Bail');
  write(`${CONVERTED_FOLDER}/image.png`);
  write('.piecemaker/cache/pièce.pdf');
  write('.piecemaker/notes.md', '# interne');
  write('node_modules/paquet/doc.pdf');
  write('.git/objects/blob.pdf');
  return root;
}

test('les pièces listées n’incluent ni .piecemaker, ni les .md convertis, ni les dossiers de code', async () => {
  const root = makeCase();
  try {
    const paths = (await originalFilesOverview(root)).map((file) => file.path);
    assert.deepStrictEqual(paths, ['Pièces/2024-01-02_bail.pdf']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('le rangement refuse de déplacer un fichier technique ou vers un dossier technique', async () => {
  const root = makeCase();
  try {
    await assert.rejects(renamePiece(root, '.piecemaker/cache/pièce.pdf', undefined, 'Pièces'), /technique|introuvable/);
    await assert.rejects(renamePiece(root, `${CONVERTED_FOLDER}/2024-01-02_bail.md`, undefined, 'Pièces'), /technique/);
    for (const directory of ['.piecemaker', CONVERTED_FOLDER, `Pièces/${CONVERTED_FOLDER}`, 'node_modules', 'Tabular Review', STAMPED_FOLDER]) {
      await assert.rejects(renamePiece(root, 'Pièces/2024-01-02_bail.pdf', undefined, directory), /ne se range pas|invalide/, directory);
    }
    assert.ok(fs.existsSync(path.join(root, 'Pièces', '2024-01-02_bail.pdf')));
    const moved = await renamePiece(root, 'Pièces/2024-01-02_bail.pdf', undefined, 'Contrats');
    assert.strictEqual(moved.current, 'Contrats/2024-01-02_bail.pdf');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
