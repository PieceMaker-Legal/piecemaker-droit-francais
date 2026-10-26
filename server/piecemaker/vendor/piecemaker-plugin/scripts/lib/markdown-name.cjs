const crypto = require('node:crypto');
const path = require('node:path');

const DIGEST_LENGTH = 8;
const CANONICAL_DIGEST_LENGTH = 16;

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

function canonicalMarkdownStem(absolutePath, caseRoot) {
  const digest = crypto.createHash('sha256')
    .update(caseRelativeKey(absolutePath, caseRoot).normalize('NFC'), 'utf8')
    .digest('hex')
    .slice(0, CANONICAL_DIGEST_LENGTH);
  return `${Array.from(sourceStem(absolutePath)).slice(0, 80).join('')}-${digest}`;
}

function markdownStemCandidates(absolutePath, caseRoot) {
  return [canonicalMarkdownStem(absolutePath, caseRoot), homonymMarkdownStem(absolutePath, caseRoot), markdownStem(absolutePath)];
}

module.exports = {
  canonicalMarkdownStem,
  homonymMarkdownStem,
  markdownStem,
  markdownStemCandidates,
};
