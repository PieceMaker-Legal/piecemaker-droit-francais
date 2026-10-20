import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyDocxReasoning } from '../docx-reasoning.js';
import { fixture, options } from './docx-reasoning-fixture.js';

let soffice = '';
try { soffice = execFileSync('which', ['soffice'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}

test('le modèle natif et les ancres survivent à un réenregistrement LibreOffice', { skip: !soffice }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pm-docx-roundtrip-'));
  try {
    const input = path.join(directory, 'contrat-fictif.docx');
    const output = path.join(directory, 'saved');
    await mkdir(output);
    await writeFile(input, await fixture());
    execFileSync(soffice, [
      `-env:UserInstallation=file://${path.join(directory, 'profile')}`, '--headless',
      '--convert-to', 'docx:Office Open XML Text', '--outdir', output, input,
    ], { timeout: 45000 });
    const result = await verifyDocxReasoning(await readFile(path.join(output, 'contrat-fictif.docx')), options);
    assert.equal(result.status, 'testé');
    assert.equal((result.verification?.annotated?.objectifs as Array<{ montant_calcule: number }>)[0].montant_calcule, 360);
    assert.equal(result.verification?.issues.filter((issue) => issue.kind === 'erreur').length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
