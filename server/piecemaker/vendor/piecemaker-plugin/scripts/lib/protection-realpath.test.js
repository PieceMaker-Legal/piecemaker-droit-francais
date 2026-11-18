const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  isProtectedFile,
  isResourceFile,
  memoizedRealpath,
  readProtection,
  writeProtection,
  WORKSPACE_SUBDIR,
} = require('./protection.cjs');

test('la résolution mémorisée donne les mêmes décisions que la résolution directe, lien symbolique compris', (t) => {
  const real = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-realpath-'));
  t.after(() => fs.rmSync(real, { recursive: true, force: true }));
  const files = [
    'Pièces/contrat.pdf',
    'Pièces/photo.png',
    'Pièces/note.docx',
    'Pièces/libre.pdf',
    'Pièces/public.pdf',
    'Pièces/lu.md',
    `${WORKSPACE_SUBDIR}/acte-ooxml/media/image1.png`,
    `${WORKSPACE_SUBDIR}/scan.pdf`,
    '.cache/x.pdf',
  ];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(real, file)), { recursive: true });
    fs.writeFileSync(path.join(real, file), 'x');
  }
  writeProtection(real, { unprotected: ['Pièces/libre.pdf'], resources: ['Pièces/public.pdf'] });
  const link = path.join(os.tmpdir(), `pm-realpath-link-${process.pid}`);
  fs.symlinkSync(real, link);
  t.after(() => fs.rmSync(link, { force: true }));
  const candidates = [...files, 'Pièces/absente.pdf', '../dehors.pdf'];
  for (const root of [real, link]) {
    const state = readProtection(root);
    const memo = { ...state, resolve: memoizedRealpath() };
    for (const base of [real, link]) {
      for (const file of candidates) {
        const absolute = path.join(base, file);
        for (let round = 0; round < 2; round += 1) {
          assert.strictEqual(isProtectedFile(absolute, root, memo), isProtectedFile(absolute, root, state), `${root} ${absolute}`);
          assert.strictEqual(isResourceFile(absolute, root, memo), isResourceFile(absolute, root, state), `${root} ${absolute}`);
        }
      }
    }
  }
  assert.strictEqual(isProtectedFile(path.join(link, 'Pièces/contrat.pdf'), real, { ...readProtection(real), resolve: memoizedRealpath() }), true);
});
