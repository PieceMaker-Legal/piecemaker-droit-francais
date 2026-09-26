const path = require('path');
const { locateProjectCase } = require('../piecemaker-plugin/scripts/lib/case-folders.cjs');

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Resolve a selected path to the project folder that contains it. */
function resolveProjectCaseFolder(selectedFolder) {
  if (!selectedFolder) throw new Error('Dossier de travail manquant.');
  const located = locateProjectCase(selectedFolder);
  if (!located) {
    throw new Error('Ce dossier de travail n’est pas un projet PieceMaker. Ouvrez-le comme projet.');
  }
  return located.caseRoot;
}

module.exports = {
  isInside,
  resolveProjectCaseFolder,
};
