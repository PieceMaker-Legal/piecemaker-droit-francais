import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveMarkdownDocument } from '../server/documents.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function projectFixture(): { project: string; outside: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tabular-documents-'));
  directories.push(root);
  const project = path.join(root, 'case');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(project);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(project, 'ordinary.md'), 'texte interne');
  fs.writeFileSync(path.join(outside, 'external.md'), 'texte externe');
  return { project, outside };
}

describe('résolution des documents Markdown', () => {
  it('accepte les chemins ordinaires et garde le chemin réel des documents internes', () => {
    const { project } = projectFixture();
    const result = resolveMarkdownDocument(project, 'ordinary.md');

    expect(result).toBe(fs.realpathSync(path.join(project, 'ordinary.md')));
    expect(fs.readFileSync(result, 'utf8')).toBe('texte interne');
  });

  it.skipIf(process.platform !== 'win32')('refuse un document extérieur atteint par une jonction et accepte une jonction interne', () => {
    const { project, outside } = projectFixture();
    fs.mkdirSync(path.join(project, 'internal'));
    fs.writeFileSync(path.join(project, 'internal', 'valid.md'), 'texte interne lié');
    fs.symlinkSync(outside, path.join(project, 'external-link'), 'junction');
    fs.symlinkSync(path.join(project, 'internal'), path.join(project, 'internal-link'), 'junction');

    expect(() => resolveMarkdownDocument(project, 'external-link/external.md')).toThrow(/hors du dossier/);
    expect(resolveMarkdownDocument(project, 'internal-link/valid.md')).toBe(fs.realpathSync(path.join(project, 'internal', 'valid.md')));
  });
});
