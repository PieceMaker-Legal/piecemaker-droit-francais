const fs = require('fs');
const path = require('path');

const GLINER_MODEL_IDS = [
  'fastino/gliner2-privacy-filter-PII-multi',
  'fastino/gliner2.5-multi-v1',
  'fastino/gliner2-multi-v1',
];
const OCR_CHECKPOINTS = require('./vendor/websocket-server/scripts/ocr-small-checkpoints.json').models;

function huggingFaceHub(userHome, env = process.env) {
  const hfHome = env.HF_HOME || path.join(userHome, '.cache', 'huggingface');
  return env.HUGGINGFACE_HUB_CACHE || env.HF_HUB_CACHE || path.join(hfHome, 'hub');
}

function modelRepoDirectory(hub, modelId) {
  return path.join(hub, `models--${modelId.replace(/\//g, '--')}`);
}

function underHome(target, userHome) {
  const relative = path.relative(path.resolve(userHome), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function localModelRemovalTargets(component, { userHome, env = process.env }) {
  const hub = huggingFaceHub(userHome, env);
  const targets = new Set();
  if (component === 'gliner') {
    for (const modelId of GLINER_MODEL_IDS) targets.add(modelRepoDirectory(hub, modelId));
  } else if (component === 'mineru') {
    for (const model of OCR_CHECKPOINTS) {
      const snapshot = path.join(modelRepoDirectory(hub, model.modelId), 'snapshots', model.revision);
      let marker = {};
      try { marker = JSON.parse(fs.readFileSync(path.join(snapshot, '.piecemaker-ocr-small.json'), 'utf8')); } catch {}
      if (marker.modelId === model.modelId && marker.revision === model.revision) targets.add(snapshot);
      else if (fs.existsSync(snapshot)) throw new Error('Ce snapshot Small est partagé et n’a pas été installé par PieceMaker.');
    }
  } else {
    throw new Error(`Modèle local inconnu : ${component}`);
  }
  return [...targets].map((target) => path.resolve(target)).filter((target) => underHome(target, userHome));
}

async function removeLocalModel(component, { userHome, env = process.env }) {
  const targets = localModelRemovalTargets(component, { userHome, env });
  for (const target of targets) fs.rmSync(target, { recursive: true, force: true });
  return targets;
}

module.exports = {
  localModelRemovalTargets,
  removeLocalModel,
};
