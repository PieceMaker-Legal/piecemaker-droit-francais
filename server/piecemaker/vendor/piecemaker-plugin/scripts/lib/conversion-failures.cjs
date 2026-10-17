const fs = require('node:fs');
const path = require('node:path');

const CONVERSION_FAILURES_RELATIVE_PATH = '.piecemaker/conversion-failures.json';
const CONVERSION_FAILURES_VERSION = 1;
const MAX_REASON_LENGTH = 300;

function conversionFailuresFile(caseRoot) {
  return path.join(caseRoot, ...CONVERSION_FAILURES_RELATIVE_PATH.split('/'));
}

function normalizeRelativePath(value) {
  const relative = String(value || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!relative || path.posix.isAbsolute(relative) || relative.split('/').includes('..')) return null;
  return relative.normalize('NFC');
}

function normalizeFailures(raw) {
  const failures = new Map();
  const source = raw && typeof raw === 'object' && raw.files && typeof raw.files === 'object' && !Array.isArray(raw.files)
    ? raw.files
    : {};
  for (const [candidate, entry] of Object.entries(source)) {
    const key = normalizeRelativePath(candidate);
    if (!key || !entry || typeof entry !== 'object') continue;
    failures.set(key, { reason: String(entry.reason || ''), failedAt: String(entry.failedAt || '') });
  }
  return failures;
}

function readConversionFailures(caseRoot) {
  try {
    return normalizeFailures(JSON.parse(fs.readFileSync(conversionFailuresFile(caseRoot), 'utf8').replace(/^﻿/, '')));
  } catch {
    return new Map();
  }
}

function writeConversionFailures(caseRoot, failures) {
  const target = conversionFailuresFile(caseRoot);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.piecemaker-${process.pid}.tmp`;
  const content = { version: CONVERSION_FAILURES_VERSION, files: Object.fromEntries(failures) };
  fs.writeFileSync(temporary, `${JSON.stringify(content, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, target);
}

function recordConversionOutcome(caseRoot, { attempted = [], failed = [], failedAt = new Date().toISOString() } = {}) {
  const failures = readConversionFailures(caseRoot);
  const before = JSON.stringify([...failures]);
  const failedNow = new Map();
  for (const entry of failed) {
    const key = normalizeRelativePath(entry.file);
    if (key) failedNow.set(key, { reason: String(entry.reason || '').slice(0, MAX_REASON_LENGTH), failedAt });
  }
  for (const file of attempted) {
    const key = normalizeRelativePath(file);
    if (key && !failedNow.has(key)) failures.delete(key);
  }
  for (const [key, entry] of failedNow) failures.set(key, entry);
  if (JSON.stringify([...failures]) !== before) writeConversionFailures(caseRoot, failures);
  return failures;
}

function moveConversionFailure(caseRoot, previous, current) {
  const from = normalizeRelativePath(previous);
  const to = normalizeRelativePath(current);
  const failures = readConversionFailures(caseRoot);
  if (!from || !to || !failures.has(from)) return;
  const entry = failures.get(from);
  failures.delete(from);
  failures.set(to, entry);
  writeConversionFailures(caseRoot, failures);
}

function conversionFailureOf(failures, relativePath) {
  const entry = failures.get(normalizeRelativePath(relativePath));
  return entry ? { reason: entry.reason, failedAt: entry.failedAt } : null;
}

module.exports = {
  CONVERSION_FAILURES_RELATIVE_PATH,
  conversionFailureOf,
  moveConversionFailure,
  readConversionFailures,
  recordConversionOutcome,
};
