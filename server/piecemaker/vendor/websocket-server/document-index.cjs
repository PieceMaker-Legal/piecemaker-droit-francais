const path = require('node:path');

const DOCUMENT_INDEX_RELATIVE_PATH = '.piecemaker/document-index.json';

function documentIndexFile(caseRoot) {
  return path.join(caseRoot, ...DOCUMENT_INDEX_RELATIVE_PATH.split('/'));
}

module.exports = {
  DOCUMENT_INDEX_RELATIVE_PATH,
  documentIndexFile,
};
