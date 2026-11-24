import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { Template } from '../shared.js';
import { assertHostOrigin, sortRow } from '../server/classify.js';
import { createReview, readReview, updateReview } from '../server/reviews.js';

const cleanup: (() => void)[] = [];

afterEach(() => {
  for (const step of cleanup.splice(0)) step();
});

const template: Template = {
  id: 'index',
  name: 'Case index',
  description: '',
  updatedAt: '',
  columns: [{ name: 'Classement', prompt: 'Dossier ?', format: 'tags', tags: ['Pièces/Contrats'], action: 'classify' }],
};

async function fakeHost(pieces: unknown[]): Promise<{ origin: string; renames: unknown[] }> {
  const renames: unknown[] = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      response.setHeader('content-type', 'application/json');
      if (request.url?.startsWith('/api/piecemaker/local/pieces?folder=')) {
        response.end(JSON.stringify({ pieces }));
        return;
      }
      renames.push(JSON.parse(body));
      response.end(JSON.stringify({ current: 'Pièces/Contrats/contrat.pdf', markdown: 'Fichiers convertis PieceMaker/contrat.md' }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => server.close());
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, renames };
}

describe('classement côté serveur', () => {
  it('range la pièce dans le dossier de la colonne Classement et note le déplacement', async () => {
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-classe-')));
    cleanup.push(() => fs.rmSync(project, { recursive: true, force: true }));
    fs.mkdirSync(path.join(project, 'Fichiers convertis PieceMaker'));
    fs.writeFileSync(path.join(project, 'Fichiers convertis PieceMaker', 'contrat.md'), '# Contrat Société Exemple SAS');
    const { file, review } = await createReview(project, template, 'Case index', [{ label: 'contrat', documents: ['Fichiers convertis PieceMaker/contrat.md'], piece: 'contrat.pdf' }], { provider: 'claude', model: 'haiku', concurrency: 1 });
    const rowId = review.rows[0].id;
    await updateReview(project, file, (current) => {
      current.cells[rowId] = { 0: { summary: 'Contrats', flag: 'green', reasoning: '' } };
    });
    const host = await fakeHost([{ path: 'contrat.pdf', status: 'converted', markdown: 'Fichiers convertis PieceMaker/contrat.md' }]);

    await sortRow(host.origin, project, file, rowId);

    expect(host.renames).toEqual([{ folder: project, path: 'contrat.pdf', directory: 'Pièces/Contrats' }]);
    expect((await readReview(project, file)).rows[0]).toMatchObject({ piece: 'Pièces/Contrats/contrat.pdf', applied: { from: 'contrat.pdf' } });
  });

  it('n’accepte que l’origine locale du serveur', () => {
    expect(assertHostOrigin(undefined)).toBeUndefined();
    expect(assertHostOrigin('http://127.0.0.1:3003')).toBe('http://127.0.0.1:3003');
    expect(() => assertHostOrigin('http://exemple.fr:3003')).toThrow('invalide');
    expect(() => assertHostOrigin('http://127.0.0.1:3003/autre')).toThrow('invalide');
  });
});
