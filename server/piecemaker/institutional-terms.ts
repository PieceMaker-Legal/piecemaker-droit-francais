import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type Database from 'better-sqlite3';
import express from 'express';

type InstitutionalTermsFile = { file: string; terms: string[] };

type InstitutionalTermsModule = {
  dedupeTerms(terms: unknown): string[];
  institutionalTermsFile(): string;
  readInstitutionalTerms(): InstitutionalTermsFile;
  writeInstitutionalTerms(terms: string[]): InstitutionalTermsFile;
};

export type InstitutionalTermsStore = {
  read(): InstitutionalTermsFile;
  write(terms: unknown): InstitutionalTermsFile;
};

const LIBRARY_DIRECTORY = 'server/piecemaker/vendor/piecemaker-plugin/scripts/lib';
const TABLE = 'piecemaker_institutional_terms';
const MAXIMUM_TERMS = 1000;

export function openInstitutionalTerms(database: Database.Database, applicationRoot: string): InstitutionalTermsStore {
  const libraryDirectory = path.join(applicationRoot, LIBRARY_DIRECTORY);
  const mirror = createRequire(import.meta.url)(path.join(libraryDirectory, 'institutional-terms.cjs')) as InstitutionalTermsModule;
  const tableExisted = Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(TABLE));
  database.exec(`CREATE TABLE IF NOT EXISTS ${TABLE} (term TEXT PRIMARY KEY) WITHOUT ROWID`);

  const selectTerms = database.prepare(`SELECT term FROM ${TABLE}`);
  const deleteTerms = database.prepare(`DELETE FROM ${TABLE}`);
  const insertTerm = database.prepare(`INSERT INTO ${TABLE}(term) VALUES (?)`);
  const storedTerms = () => mirror.dedupeTerms((selectTerms.all() as Array<{ term: string }>).map(({ term }) => term));
  const replaceTerms = database.transaction((terms: string[]) => {
    deleteTerms.run();
    for (const term of terms) insertTerm.run(term);
  });

  if (!tableExisted) {
    const previousList = fs.existsSync(mirror.institutionalTermsFile())
      ? mirror.readInstitutionalTerms().terms
      : (JSON.parse(fs.readFileSync(path.join(libraryDirectory, 'institutional-terms.default.json'), 'utf8')) as { terms: string[] }).terms;
    replaceTerms(mirror.dedupeTerms(previousList));
  }
  mirror.writeInstitutionalTerms(storedTerms());

  return {
    read: () => ({ file: mirror.institutionalTermsFile(), terms: storedTerms() }),
    write: (terms) => {
      replaceTerms(mirror.dedupeTerms(terms));
      return mirror.writeInstitutionalTerms(storedTerms());
    },
  };
}

export function createInstitutionalTermsRouter(store: InstitutionalTermsStore) {
  const router = express.Router();

  router.get('/institutional-terms', (_request, response) => {
    response.json(store.read());
  });

  router.put('/institutional-terms', (request, response) => {
    const terms = request.body?.terms;
    if (!Array.isArray(terms)) {
      response.status(400).json({ error: 'Le corps doit contenir un tableau « terms ».' });
      return;
    }
    if (terms.length > MAXIMUM_TERMS) {
      response.status(400).json({ error: `Liste trop longue (${MAXIMUM_TERMS} termes maximum).` });
      return;
    }
    response.json({ ok: true, ...store.write(terms) });
  });

  return router;
}
