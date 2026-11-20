const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  canonicalMarkdownStem,
  homonymMarkdownStem,
  markdownStem,
  markdownStemCandidates,
} = require('./markdown-name.cjs');
const { markdownCounterpart, WORKSPACE_SUBDIR } = require('./protection.cjs');

function makeCase() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'markdown-name-')));
}

test('le suffixe homonyme reprend le calcul du pipeline Python', () => {
  const root = makeCase();
  try {
    assert.strictEqual(
      homonymMarkdownStem(path.join(root, 'Pièces', 'a', 'exemple.docx'), root),
      'exemple-34cdff21',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('le nom canonique reprend le calcul du pipeline Python', () => {
  const root = makeCase();
  try {
    assert.strictEqual(
      canonicalMarkdownStem(path.join(root, 'Pièces', 'a', 'exemple.docx'), root),
      'exemple-f746693ae66db90e',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('les candidats désignent d’abord le nom canonique, puis le suffixe homonyme, puis le nom simple', () => {
  const root = makeCase();
  try {
    const piece = path.join(root, 'a', 'exemple.docx');
    assert.deepStrictEqual(markdownStemCandidates(piece, root), [
      canonicalMarkdownStem(piece, root),
      homonymMarkdownStem(piece, root),
      'exemple',
    ]);
    assert.strictEqual(markdownStem(piece), 'exemple');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('markdownCounterpart retrouve le Markdown suffixé de chaque homonyme', () => {
  const root = makeCase();
  try {
    const first = path.join(root, 'a', 'exemple.docx');
    const second = path.join(root, 'b', 'exemple.docx');
    const workspace = path.join(root, WORKSPACE_SUBDIR);
    fs.mkdirSync(workspace, { recursive: true });
    const firstMarkdown = path.join(workspace, `${homonymMarkdownStem(first, root)}.md`);
    const secondMarkdown = path.join(workspace, `${homonymMarkdownStem(second, root)}.md`);
    fs.writeFileSync(firstMarkdown, '# Pièce A fictive\n');
    fs.writeFileSync(secondMarkdown, '# Pièce B fictive\n');
    fs.writeFileSync(path.join(workspace, 'exemple.md'), '# Ancien Markdown fictif\n');

    assert.deepStrictEqual(markdownCounterpart(first, root), { path: firstMarkdown, exists: true });
    assert.deepStrictEqual(markdownCounterpart(second, root), { path: secondMarkdown, exists: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('un original sans homonyme garde son Markdown au nom simple', () => {
  const root = makeCase();
  try {
    const piece = path.join(root, 'a', 'exemple.docx');
    const workspace = path.join(root, WORKSPACE_SUBDIR);
    fs.mkdirSync(workspace, { recursive: true });
    const markdown = path.join(workspace, 'exemple.md');
    fs.writeFileSync(markdown, '# Pièce fictive\n');

    assert.deepStrictEqual(markdownCounterpart(piece, root), { path: markdown, exists: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
