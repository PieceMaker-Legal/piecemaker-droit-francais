const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  CONVERSION_FAILURES_RELATIVE_PATH,
  conversionFailureOf,
  moveConversionFailure,
  readConversionFailures,
  recordConversionOutcome,
} = require('./conversion-failures.cjs');

function makeCase() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'conversion-failures-')));
}

test('un échec de conversion est enregistré par chemin de pièce, puis retiré à la conversion suivante', () => {
  const root = makeCase();
  try {
    recordConversionOutcome(root, {
      attempted: ['Pièces/contrat.pdf'],
      failed: [{ file: 'Pièces/contrat.pdf', reason: 'MinerU failed' }],
      failedAt: '2026-10-17T10:00:00.000Z',
    });

    const stored = JSON.parse(fs.readFileSync(path.join(root, CONVERSION_FAILURES_RELATIVE_PATH), 'utf8'));
    assert.deepStrictEqual(stored, {
      version: 1,
      files: { 'Pièces/contrat.pdf': { reason: 'MinerU failed', failedAt: '2026-10-17T10:00:00.000Z' } },
    });

    recordConversionOutcome(root, { attempted: ['Pièces/contrat.pdf'], failed: [] });
    assert.strictEqual(readConversionFailures(root).size, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('un échec n’est pas retiré par un scan qui ne porte pas sur la pièce', () => {
  const root = makeCase();
  try {
    recordConversionOutcome(root, { attempted: ['a.pdf'], failed: [{ file: 'a.pdf', reason: 'format illisible' }] });
    recordConversionOutcome(root, { attempted: ['b.pdf'], failed: [] });

    assert.strictEqual(conversionFailureOf(readConversionFailures(root), 'a.pdf').reason, 'format illisible');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('les clés sont normalisées : séparateurs Windows et forme Unicode', () => {
  const root = makeCase();
  try {
    recordConversionOutcome(root, { attempted: [], failed: [{ file: 'Pièces\\contrat.pdf', reason: 'échec fictif' }] });

    assert.strictEqual(conversionFailureOf(readConversionFailures(root), 'Pièces/contrat.pdf').reason, 'échec fictif');
    assert.strictEqual(conversionFailureOf(readConversionFailures(root), 'Pièces/autre.pdf'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('un renommage déplace l’échec de conversion vers le nouveau chemin', () => {
  const root = makeCase();
  try {
    recordConversionOutcome(root, { attempted: [], failed: [{ file: 'Pièces/contrat.pdf', reason: 'échec fictif' }] });

    moveConversionFailure(root, 'Pièces/contrat.pdf', 'Procédure/contrat.pdf');

    const failures = readConversionFailures(root);
    assert.strictEqual(conversionFailureOf(failures, 'Pièces/contrat.pdf'), null);
    assert.strictEqual(conversionFailureOf(failures, 'Procédure/contrat.pdf').reason, 'échec fictif');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('un manifeste absent ou illisible ne signale aucun échec', () => {
  const root = makeCase();
  try {
    assert.strictEqual(readConversionFailures(root).size, 0);
    fs.mkdirSync(path.join(root, '.piecemaker'));
    fs.writeFileSync(path.join(root, CONVERSION_FAILURES_RELATIVE_PATH), '{ pas du json');
    assert.strictEqual(readConversionFailures(root).size, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
