'use strict';

/**
 * Chemins et copies sûres pour l'activation par dossier. Toute opération
 * destructrice (installation, suppression, adoption) passe par `safeChildPath`
 * pour interdire qu'un identifiant échappe à la racine attendue.
 */
const fs = require('node:fs');
const path = require('node:path');

const { ActivationError } = require('./errors.cjs');

function resolveWorkspacePath(rawPath) {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new ActivationError(400, '« workspacePath » est requis.');
  }
  if (!path.isAbsolute(rawPath)) {
    throw new ActivationError(400, '« workspacePath » doit être un chemin absolu.');
  }
  let stats;
  try {
    stats = fs.statSync(rawPath);
  } catch {
    throw new ActivationError(400, 'Le dossier indiqué est introuvable.');
  }
  if (!stats.isDirectory()) {
    throw new ActivationError(400, 'Le chemin indiqué n’est pas un dossier.');
  }
  try {
    return fs.realpathSync(rawPath);
  } catch {
    throw new ActivationError(400, 'Le dossier indiqué est introuvable.');
  }
}

function displayPath(targetPath, homeDir) {
  if (typeof targetPath !== 'string') return targetPath;
  if (targetPath === homeDir) return '~';
  if (homeDir && targetPath.startsWith(`${homeDir}${path.sep}`)) {
    return `~${targetPath.slice(homeDir.length)}`;
  }
  return targetPath;
}

function validateComponentId(id) {
  if (typeof id !== 'string' || !id || id === '.' || id === '..' || id.includes('/') || id.includes('\\')) {
    throw new ActivationError(400, 'Identifiant de composant invalide.');
  }
  return id;
}

/**
 * Joint `root` et `id` (+ `suffix` éventuel) et vérifie que le résultat est
 * un enfant direct de `root` une fois résolu — une seule ligne de défense ne
 * suffit pas pour une opération qui supprime ou écrase un dossier entier.
 */
function safeChildPath(root, id, suffix = '') {
  validateComponentId(id);
  const resolvedRoot = path.resolve(root);
  const target = path.join(resolvedRoot, `${id}${suffix}`);
  if (path.dirname(target) !== resolvedRoot) {
    throw new ActivationError(400, 'Identifiant de composant invalide.');
  }
  return target;
}

function removeIfExists(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function copyComponent(sourcePath, targetPath, { isDirectory }) {
  removeIfExists(targetPath);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (isDirectory) {
    fs.cpSync(sourcePath, targetPath, { recursive: true });
  } else {
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function moveComponent(sourcePath, targetPath, { isDirectory }) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  try {
    fs.renameSync(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    if (isDirectory) {
      fs.cpSync(sourcePath, targetPath, { recursive: true });
    } else {
      fs.copyFileSync(sourcePath, targetPath);
    }
    removeIfExists(sourcePath);
  }
}

module.exports = {
  resolveWorkspacePath,
  displayPath,
  validateComponentId,
  safeChildPath,
  removeIfExists,
  copyComponent,
  moveComponent,
};
