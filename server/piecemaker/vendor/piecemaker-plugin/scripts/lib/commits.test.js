const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { originalFilesOverview } = require('./commits.cjs');
const { canonicalMarkdownStem } = require('./markdown-name.cjs');
const { WORKSPACE_SUBDIR } = require('./protection.cjs');

function makeCase() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'commits-overview-')));
}

test('originalFilesOverview tient pour convertis les homonymes dont le Markdown porte le nom canonique', async () => {
  const root = makeCase();
  try {
    const first = path.join(root, 'a', 'exemple.docx');
    const second = path.join(root, 'b', 'exemple.docx');
    fs.mkdirSync(path.dirname(first), { recursive: true });
    fs.mkdirSync(path.dirname(second), { recursive: true });
    fs.writeFileSync(first, 'Pièce A fictive');
    fs.writeFileSync(second, 'Pièce B fictive');
    const workspace = path.join(root, WORKSPACE_SUBDIR);
    fs.mkdirSync(workspace, { recursive: true });
    fs.writeFileSync(path.join(workspace, `${canonicalMarkdownStem(first, root)}.md`), '# Pièce A fictive\n');
    fs.writeFileSync(path.join(workspace, `${canonicalMarkdownStem(second, root)}.md`), '# Pièce B fictive\n');

    const overview = await originalFilesOverview(root);

    assert.deepStrictEqual(
      overview.map((original) => [original.path, original.converted]),
      [['a/exemple.docx', true], ['b/exemple.docx', true]],
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
