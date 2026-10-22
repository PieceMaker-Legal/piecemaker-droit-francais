const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const GLINER_MODEL_IDS = [
  'fastino/gliner2-privacy-filter-PII-multi',
  'fastino/gliner2.5-multi-v1',
  'fastino/gliner2-multi-v1',
];
const MINERU_MODEL_IDS = ['opendatalab/PDF-Extract-Kit-1.0'];
const MINERU_PACKAGES = ['mineru', 'mineru-llama-cpp'];

function huggingFaceHub(userHome, env = process.env) {
  const hfHome = env.HF_HOME || path.join(userHome, '.cache', 'huggingface');
  return env.HUGGINGFACE_HUB_CACHE || env.HF_HUB_CACHE || path.join(hfHome, 'hub');
}

function modelRepoDirectory(hub, modelId) {
  return path.join(hub, `models--${modelId.replace(/\//g, '--')}`);
}

function repoRootFromModelPath(modelPath) {
  let current = path.resolve(modelPath);
  while (path.dirname(current) !== current) {
    if (path.basename(current).startsWith('models--')) return current;
    current = path.dirname(current);
  }
  return null;
}

function underHome(target, userHome) {
  const relative = path.relative(path.resolve(userHome), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function readMineruConfig(userHome) {
  try {
    return JSON.parse(fs.readFileSync(path.join(userHome, 'mineru.json'), 'utf8'));
  } catch {
    return null;
  }
}

function localModelRemovalTargets(component, { userHome, env = process.env, mineruConfig = null }) {
  const hub = huggingFaceHub(userHome, env);
  const targets = new Set();
  if (component === 'gliner') {
    for (const modelId of GLINER_MODEL_IDS) targets.add(modelRepoDirectory(hub, modelId));
  } else if (component === 'mineru') {
    for (const modelId of MINERU_MODEL_IDS) targets.add(modelRepoDirectory(hub, modelId));
    for (const value of Object.values(mineruConfig?.['models-dir'] || {})) {
      if (typeof value !== 'string' || !value.trim()) continue;
      const repo = repoRootFromModelPath(value);
      if (repo) targets.add(repo);
    }
    targets.add(path.join(userHome, 'mineru.json'));
    targets.add(env.MINERU_HOME || path.join(userHome, '.mineru'));
  } else {
    throw new Error(`Modèle local inconnu : ${component}`);
  }
  return [...targets].map((target) => path.resolve(target)).filter((target) => underHome(target, userHome));
}

function uninstallPackages(python, packages) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-m', 'pip', 'uninstall', '-y', ...packages], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const stderr = [];
    child.stderr.on('data', (chunk) => stderr.push(String(chunk)));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.join('').trim().slice(-400) || `pip uninstall a échoué (code ${code}).`));
    });
  });
}

async function removeLocalModel(component, { homeDir, userHome, env = process.env }) {
  const targets = localModelRemovalTargets(component, { userHome, env, mineruConfig: readMineruConfig(userHome) });
  if (component === 'mineru') {
    let python = '';
    try {
      const config = JSON.parse(fs.readFileSync(path.join(homeDir, 'config.json'), 'utf8'));
      python = config.pythonRuntime?.kind === 'shared' ? '' : config.pythonPath || '';
    } catch {
      python = '';
    }
    if (python && fs.existsSync(python)) await uninstallPackages(python, MINERU_PACKAGES);
  }
  for (const target of targets) fs.rmSync(target, { recursive: true, force: true });
  return targets;
}

module.exports = {
  localModelRemovalTargets,
  removeLocalModel,
};
