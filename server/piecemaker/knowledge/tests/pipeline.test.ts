import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { defaultScanFiles } from '../pipeline.js';

function writeFile(root: string, relative: string, contents = 'x') {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

test('defaultScanFiles lists nested originals and ignores generated markdown', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-knowledge-scan-')));
  try {
    writeFile(root, 'contrat.pdf');
    writeFile(root, path.join('01_CORRESPONDANCE', '01_Client', 'lettre.docx'));
    writeFile(root, path.join('02_DATA_ROOM', 'kbis.pdf'));
    writeFile(root, 'brouillon.md');
    writeFile(root, path.join('Fichiers convertis PieceMaker', 'contrat.md'));
    const files = await defaultScanFiles(root);
    const relative = files.map((file) => path.relative(root, file).split(path.sep).join('/')).sort();
    assert.deepEqual(relative, [
      '01_CORRESPONDANCE/01_Client/lettre.docx',
      '02_DATA_ROOM/kbis.pdf',
      'contrat.pdf',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
