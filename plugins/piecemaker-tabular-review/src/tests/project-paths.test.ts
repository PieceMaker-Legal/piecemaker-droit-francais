import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

const home = vi.hoisted(() => ({ value: '' }));

vi.mock('node:os', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:os')>();
  return { ...original, default: { ...original, homedir: () => home.value }, homedir: () => home.value };
});

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
  home.value = '';
});

function registeredProject(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tabular-project-'));
  directories.push(root);
  home.value = path.join(root, 'home');
  const project = path.join(root, 'case');
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(home.value, '.piecemaker'), { recursive: true });
  fs.writeFileSync(path.join(home.value, '.piecemaker', 'projects.json'), JSON.stringify({ sources: { test: [project] } }));
  return project;
}

describe('validation des chemins de dossier', () => {
  it('retourne le chemin physique du dossier enregistré', async () => {
    const project = registeredProject();
    vi.resetModules();
    const { assertProject } = await import('../server/paths.js');

    expect(assertProject(project)).toBe(fs.realpathSync(project));
  });

  it.skipIf(process.platform !== 'win32')('compare le dossier enregistré sans sensibilité à la casse Windows', async () => {
    const project = registeredProject();
    const variant = project.replace(/case$/, 'CASE');
    const document = path.join(project, 'nested.md');
    fs.writeFileSync(document, 'texte interne');
    vi.resetModules();
    const { assertProject, isRealPathInside } = await import('../server/paths.js');

    expect(assertProject(variant).toLowerCase()).toBe(fs.realpathSync(project).toLowerCase());
    expect(isRealPathInside(project.toUpperCase(), document)).toBe(true);
  });
});
