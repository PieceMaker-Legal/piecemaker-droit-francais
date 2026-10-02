import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import Database from 'better-sqlite3';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { openInstitutionalTerms } from './institutional-terms.js';

const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));

function withTermsFile(run: (file: string) => void) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'institutional-terms-'));
  const previous = process.env.PIECEMAKER_INSTITUTIONAL_TERMS;
  const file = path.join(directory, 'home', 'institutional-terms.json');
  process.env.PIECEMAKER_INSTITUTIONAL_TERMS = file;
  try {
    run(file);
  } finally {
    if (previous === undefined) delete process.env.PIECEMAKER_INSTITUTIONAL_TERMS;
    else process.env.PIECEMAKER_INSTITUTIONAL_TERMS = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

const mirroredTerms = (file: string): string[] => JSON.parse(fs.readFileSync(file, 'utf8')).terms;

test('une base neuve sans liste reçoit la liste par défaut, recopiée dans le fichier lu par les scripts', () => {
  withTermsFile((file) => {
    const store = openInstitutionalTerms(new Database(':memory:'), applicationRoot);
    const { terms } = store.read();
    assert.ok(terms.length > 100);
    assert.ok(terms.includes('Cour de cassation'));
    assert.ok(terms.includes('Code civil'));
    assert.deepEqual(mirroredTerms(file), terms);
  });
});

test('une liste déjà présente dans le fichier est reprise dans la base', () => {
  withTermsFile((file) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, terms: ['Tribunal arbitral du sport'] }));
    const store = openInstitutionalTerms(new Database(':memory:'), applicationRoot);
    assert.deepEqual(store.read().terms, ['Tribunal arbitral du sport']);
  });
});

test('la base fait foi : le fichier effacé est rétabli et une liste vidée reste vide', () => {
  withTermsFile((file) => {
    const database = new Database(':memory:');
    const store = openInstitutionalTerms(database, applicationRoot);
    assert.deepEqual(store.write(['  Ordre des  géomètres ', 'ordre des géomètres', 'BODACC']).terms, ['BODACC', 'Ordre des géomètres']);
    assert.deepEqual(mirroredTerms(file), ['BODACC', 'Ordre des géomètres']);

    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    assert.deepEqual(openInstitutionalTerms(database, applicationRoot).read().terms, ['BODACC', 'Ordre des géomètres']);
    assert.deepEqual(mirroredTerms(file), ['BODACC', 'Ordre des géomètres']);

    store.write([]);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
    assert.deepEqual(openInstitutionalTerms(database, applicationRoot).read().terms, []);
    assert.deepEqual(mirroredTerms(file), []);
  });
});
