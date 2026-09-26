/** Legal-case registry: every CloudCLI project published by the server is a case. */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  isTechnicalCaseDirectoryName,
} = require('../piecemaker-plugin/scripts/lib/commits.cjs');
const { registeredProjectFolders } = require('../piecemaker-plugin/scripts/lib/case-folders.cjs');

function readRegistryConfig(configFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function caseFolderId(folder) {
  const digest = crypto.createHash('sha256').update(path.resolve(folder)).digest('hex').slice(0, 20);
  return `folder-${digest}`;
}

function projectEntries() {
  return registeredProjectFolders().map((root) => ({
    id: caseFolderId(root),
    name: path.basename(root),
    root,
    casesRoot: path.dirname(root),
    caseName: path.basename(root),
    registered: true,
  }));
}

function listProjectCases() {
  return projectEntries().sort((a, b) =>
    a.name.localeCompare(b.name, 'fr') || a.root.localeCompare(b.root, 'fr'));
}

function resolveCaseReference(reference) {
  const token = String(reference || '').trim();
  if (!token) throw new Error('Dossier juridique invalide.');
  const entry = projectEntries().find((candidate) => candidate.id === token);
  if (!entry) throw new Error('Ce dossier juridique n’est pas un projet enregistré.');
  return entry;
}

function projectCaseEntry(root) {
  return projectEntries().find((entry) => entry.root === root) || null;
}

function validateSelectedCaseFolder(folder) {
  const requested = String(folder || '').trim();
  if (!requested || !path.isAbsolute(requested)) throw new Error('Le dossier sélectionné doit avoir un chemin absolu.');
  let root;
  try {
    root = fs.realpathSync(path.resolve(requested));
  } catch {
    throw new Error('Le dossier sélectionné est introuvable.');
  }
  if (!fs.statSync(root).isDirectory()) throw new Error('La sélection doit être un dossier existant.');
  const name = path.basename(root);
  if (!name || name.startsWith('.') || isTechnicalCaseDirectoryName(name)) {
    throw new Error('Ce dossier ne peut pas être enregistré comme dossier juridique.');
  }
  return root;
}

module.exports = {
  caseFolderId,
  listProjectCases,
  projectCaseEntry,
  readRegistryConfig,
  resolveCaseReference,
  validateSelectedCaseFolder,
};
