const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { stateKey } = require('../piecemaker-plugin/scripts/lib/anonymization-state.cjs');
const { buildChronology, readDocumentIndex } = require('./document-index.cjs');

const temporaryRoots = [];

test.afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporaryCase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-document-index-'));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, '.piecemaker'));
  fs.mkdirSync(path.join(root, 'Fichiers convertis PieceMaker'));
  return root;
}

test('lit les champs historiques de l’index documentaire', () => {
  const root = temporaryCase();
  const key = 'a'.repeat(64);
  fs.writeFileSync(path.join(root, '.piecemaker', 'document-index.json'), JSON.stringify({
    documents: {
      [key]: {
        juridiction: 'RCS de Paris',
        codes: ['ADVERSAIRE_DEFENDEUR_PERSONNE_MORALE_01'],
      },
    },
  }));

  const entry = readDocumentIndex(root).documents[key];

  assert.equal(entry.localisation, 'RCS de Paris');
  assert.deepEqual(entry.personnes_visees, ['ADVERSAIRE_DEFENDEUR_PERSONNE_MORALE_01']);
});

test('retrouve le code courant dans le Markdown quand un ancien index référence un code périmé', async () => {
  const root = temporaryCase();
  const workspace = path.join(root, 'Fichiers convertis PieceMaker');
  const source = path.join(root, 'Kbis Société Alpha.pdf');
  const relativeSource = path.basename(source);
  const key = stateKey(relativeSource);
  fs.writeFileSync(source, 'pdf');
  fs.writeFileSync(path.join(workspace, 'Kbis Société Alpha.md'), 'Extrait Kbis de Société Alpha');
  fs.writeFileSync(path.join(workspace, 'Kbis Société Alpha_sensitive_map.json'), '{}');
  fs.writeFileSync(path.join(workspace, 'mapping_default.json'), JSON.stringify({
    mapping: { 'Société Alpha': 'ADVERSAIRE_DEFENDEUR_SA_01' },
    reverse_mapping: { ADVERSAIRE_DEFENDEUR_SA_01: ['Société Alpha'] },
  }));
  fs.writeFileSync(path.join(root, '.piecemaker', 'document-index.json'), JSON.stringify({
    documents: {
      [key]: { codes: ['ADVERSAIRE_DEFENDEUR_PERSONNE_MORALE_01'] },
    },
  }));

  const chronology = await buildChronology(root);

  assert.deepEqual(chronology.documents[0].effectiveCodes, ['ADVERSAIRE_DEFENDEUR_SA_01']);
});
