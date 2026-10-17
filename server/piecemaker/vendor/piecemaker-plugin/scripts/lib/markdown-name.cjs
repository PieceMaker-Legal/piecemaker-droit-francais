const crypto = require('node:crypto');
const path = require('node:path');

const DIGEST_LENGTH = 8;

function caseRelativeKey(absolutePath, caseRoot) {
  const resolved = path.resolve(absolutePath);
  const relative = path.relative(path.resolve(caseRoot), resolved);
  const inside = relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
  return (inside ? relative : resolved).split(path.sep).join('/');
}

function sourceStem(absolutePath) {
  return path.basename(absolutePath, path.extname(absolutePath));
}

function markdownStem(absolutePath) {
  return sourceStem(absolutePath);
}

function homonymMarkdownStem(absolutePath, caseRoot) {
  const digest = crypto.createHash('sha1')
    .update(caseRelativeKey(absolutePath, caseRoot), 'utf8')
    .digest('hex')
    .slice(0, DIGEST_LENGTH);
  return `${sourceStem(absolutePath)}-${digest}`;
}

function markdownStemCandidates(absolutePath, caseRoot) {
  return [homonymMarkdownStem(absolutePath, caseRoot), markdownStem(absolutePath)];
}

module.exports = {
  homonymMarkdownStem,
  markdownStem,
  markdownStemCandidates,
};
