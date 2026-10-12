import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { deleteDraft, listDrafts, upsertDraft } from '../server/drafts.js';

const directories: string[] = [];
const store = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-drafts-'));
  directories.push(directory);
  return path.join(directory, 'drafts.json');
};
const project = (value: unknown) => String(value);

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

describe('projets non lancés', () => {
  it('enregistre, met à jour, liste par dossier et supprime un projet', () => {
    const file = store();
    const created = upsertDraft({ project: '/dossier-a', title: '  Tableau exemple  ' }, file, project);
    upsertDraft({ project: '/dossier-b', title: 'Autre' }, file, project);
    const updated = upsertDraft({ ...created, rows: [{ label: 'a', documents: ['a.md'] }] }, file, project);
    expect(updated).toMatchObject({ id: created.id, title: 'Tableau exemple', createdAt: created.createdAt });
    expect(listDrafts(['/dossier-a'], file)).toEqual([updated]);
    deleteDraft(created.id, file);
    expect(listDrafts(['/dossier-a', '/dossier-b'], file).map((draft) => draft.title)).toEqual(['Autre']);
  });

  it('refuse un projet sans nom', () => {
    expect(() => upsertDraft({ project: '/dossier', title: ' ' }, store(), project)).toThrow('Donnez un nom');
  });
});
