import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { localModelRemovalTargets, removeLocalModel } = require('./local-models.cjs');

test('la suppression de GLiNER vise les dépôts du modèle dans le cache Hugging Face', () => {
  const targets = localModelRemovalTargets('gliner', { userHome: '/Users/ada', env: {} });
  assert.ok(targets.includes(path.join('/Users/ada', '.cache', 'huggingface', 'hub', 'models--fastino--gliner2-privacy-filter-PII-multi')));
  assert.ok(targets.every((target) => path.basename(target).startsWith('models--')));
});

test('la suppression de MinerU suit mineru.json sans sortir du dossier personnel', () => {
  const targets = localModelRemovalTargets('mineru', {
    userHome: '/Users/ada',
    env: { HF_HUB_CACHE: '/Users/ada/hub' },
    mineruConfig: {
      'models-dir': {
        pipeline: '/Users/ada/autre/models--opendatalab--PDF-Extract-Kit-1.0/snapshots/abc',
        vlm: '/opt/partage/models--opendatalab--MinerU/snapshots/def',
      },
    },
  });
  assert.deepStrictEqual(targets.sort(), [
    path.join('/Users/ada', 'autre', 'models--opendatalab--PDF-Extract-Kit-1.0'),
    path.join('/Users/ada', 'hub', 'models--opendatalab--PDF-Extract-Kit-1.0'),
    path.join('/Users/ada', 'mineru.json'),
    path.join('/Users/ada', '.mineru'),
  ].sort());
});

test('un composant inconnu est refusé', () => {
  assert.throws(() => localModelRemovalTargets('ollama', { userHome: '/Users/ada', env: {} }), /inconnu/);
});

test('supprime le modèle GLiNER du cache sans toucher au reste', async () => {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'local-models-'));
  const hub = path.join(userHome, '.cache', 'huggingface', 'hub');
  const model = path.join(hub, 'models--fastino--gliner2-privacy-filter-PII-multi', 'snapshots', 'r1');
  const other = path.join(hub, 'models--exemple--autre');
  fs.mkdirSync(model, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  try {
    await removeLocalModel('gliner', { homeDir: path.join(userHome, '.piecemaker'), userHome, env: {} });
    assert.strictEqual(fs.existsSync(path.join(hub, 'models--fastino--gliner2-privacy-filter-PII-multi')), false);
    assert.strictEqual(fs.existsSync(other), true);
  } finally {
    fs.rmSync(userHome, { recursive: true, force: true });
  }
});
