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

test('supprime seulement le snapshot Small provisionné, sans toucher aux autres modèles ni au Python', async () => {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'small-models-'));
  const hub = path.join(userHome, 'hub');
  const checkpoints = require('./vendor/websocket-server/scripts/ocr-small-checkpoints.json').models;
  const snapshots = checkpoints.map(model => path.join(hub, `models--${model.modelId.replace('/', '--')}`, 'snapshots', model.revision));
  const preserved = path.join(hub, 'models--PaddlePaddle--PP-OCRv6_small_det_onnx', 'snapshots', 'other-revision');
  const python = path.join(userHome, 'python');
  fs.writeFileSync(python, 'interpreter');
  fs.mkdirSync(preserved, { recursive: true });
  try {
    for (const snapshot of snapshots) fs.mkdirSync(snapshot, { recursive: true });
    await assert.rejects(removeLocalModel('mineru', { userHome, env: { HF_HUB_CACHE: hub } }), /partagé/);
    for (const [index, snapshot] of snapshots.entries()) {
      fs.writeFileSync(path.join(snapshot, '.piecemaker-ocr-small.json'), JSON.stringify({ modelId: checkpoints[index].modelId, revision: checkpoints[index].revision }));
    }
    await removeLocalModel('mineru', { userHome, env: { HF_HUB_CACHE: hub } });
    assert.ok(snapshots.every(snapshot => !fs.existsSync(snapshot)));
    assert.ok(fs.existsSync(preserved));
    assert.strictEqual(fs.readFileSync(python, 'utf8'), 'interpreter');
  } finally {
    fs.rmSync(userHome, { recursive: true, force: true });
  }
});
