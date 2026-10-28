import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { readDocxReasoning, verifyDocxReasoning } from '../docx-reasoning.js';
import { clauses, code, fixture, mutate, options } from './docx-reasoning-fixture.js';

let soffice = '';
try { soffice = execFileSync('which', ['soffice'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch {}

for (const scenario of [
  { name: 'sans retouche', change: (xml: string) => xml, amount: 360 },
  { name: 'après modification manuelle d’une valeur', change: (xml: string) => xml.replace('>30<', '>60<'), amount: 720 },
  { name: 'après réécriture manuelle d’une clause', change: (xml: string) => xml.replace('une pénalité est due', 'aucune pénalité n’est due'), amount: null },
]) test(`le modèle et les ancres survivent à LibreOffice ${scenario.name}`, { skip: !soffice }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'pm-docx-roundtrip-'));
  try {
    const input = path.join(directory, 'contrat-fictif.docx');
    const output = path.join(directory, 'saved');
    await mkdir(output);
    await writeFile(input, await mutate(await fixture(), scenario.change));
    execFileSync(soffice, [
      `-env:UserInstallation=file://${path.join(directory, 'profile')}`, '--headless',
      '--convert-to', 'docx:Office Open XML Text', '--outdir', output, input,
    ], { timeout: 45000 });
    const saved = await readFile(path.join(output, 'contrat-fictif.docx'));
    assert.equal((await readDocxReasoning(saved)).code, code);
    const result = await verifyDocxReasoning(saved, options);
    if (scenario.amount === null) {
      assert.equal(result.status, 'à revoir');
      assert.deepEqual(result.changed, [clauses[1]]);
      assert.match(result.context[0].text, /aucune pénalité n’est due.*10 % du prix convenu\./);
      assert.equal(result.verification, null);
      return;
    }
    assert.equal(result.status, 'testé');
    assert.equal((result.verification?.annotated?.objectifs as Array<{ montant_calcule: number }>)[0].montant_calcule, scenario.amount);
    assert.equal(result.verification?.issues.filter((issue) => issue.kind === 'erreur').length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
