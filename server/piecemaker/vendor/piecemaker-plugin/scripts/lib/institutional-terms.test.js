const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  installDefaultInstitutionalTerms,
  isInstitutionalEntity,
  readInstitutionalTerms,
} = require('./institutional-terms.cjs');

const withTermsFile = (run) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'institutional-terms-'));
  const previous = process.env.PIECEMAKER_INSTITUTIONAL_TERMS;
  process.env.PIECEMAKER_INSTITUTIONAL_TERMS = path.join(directory, 'home', 'institutional-terms.json');
  try {
    run(process.env.PIECEMAKER_INSTITUTIONAL_TERMS);
  } finally {
    if (previous === undefined) delete process.env.PIECEMAKER_INSTITUTIONAL_TERMS;
    else process.env.PIECEMAKER_INSTITUTIONAL_TERMS = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
};

test('la liste par défaut est installée quand aucune liste n’existe', () => {
  withTermsFile(() => {
    assert.equal(isInstitutionalEntity('Cour de cassation'), false);
    assert.equal(installDefaultInstitutionalTerms(), true);
    assert.ok(readInstitutionalTerms().terms.length > 100);
    assert.equal(isInstitutionalEntity('Cour de cassation'), true);
    assert.equal(isInstitutionalEntity('TRIBUNAL DE COMMERCE DE LYON'), true);
    assert.equal(isInstitutionalEntity('Code civil'), true);
    assert.equal(isInstitutionalEntity('URSSAF Rhône-Alpes'), true);
    assert.equal(isInstitutionalEntity('BATIMENTS RHODANIENS SAS'), false);
    assert.equal(isInstitutionalEntity('Étienne Marchetti'), false);
  });
});

test('une liste existante, même vide, n’est jamais remplacée', () => {
  withTermsFile((file) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, terms: [] }));
    assert.equal(installDefaultInstitutionalTerms(), false);
    assert.deepEqual(readInstitutionalTerms().terms, []);
  });
});
