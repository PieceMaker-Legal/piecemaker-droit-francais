import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { vibeExecutable } from '../server/vibe-executable.js';

const directories: string[] = [];

const IS_WINDOWS = process.platform === 'win32';
const EXECUTABLE = IS_WINDOWS ? 'vibe.exe' : 'vibe';
const BIN_DIRECTORY = IS_WINDOWS ? 'Scripts' : 'bin';

afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function temporaryHome(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-vibe-'));
  directories.push(directory);
  return directory;
}

function installVibe(directory: string): string {
  fs.mkdirSync(directory, { recursive: true });
  const executable = path.join(directory, EXECUTABLE);
  fs.writeFileSync(executable, '');
  return executable;
}

describe('recherche de l’exécutable Vibe installé par PieceMaker', () => {
  it('retrouve l’exécutable dans PIECEMAKER_HOME quand vibe n’est pas dans le PATH', () => {
    const home = temporaryHome();
    const piecemakerHome = path.join(home, 'piecemaker-exemple');
    const executable = installVibe(path.join(piecemakerHome, 'vibe', BIN_DIRECTORY));

    expect(vibeExecutable(null, { environment: { PATH: home, PIECEMAKER_HOME: piecemakerHome }, homedir: home })).toBe(executable);
  });

  it('retrouve l’exécutable dans ~/.piecemaker sans PIECEMAKER_HOME', () => {
    const home = temporaryHome();
    const executable = installVibe(path.join(home, '.piecemaker', 'vibe', BIN_DIRECTORY));

    expect(vibeExecutable(null, { environment: {}, homedir: home })).toBe(executable);
  });

  it('garde le chemin configuré en priorité', () => {
    const home = temporaryHome();
    installVibe(path.join(home, '.piecemaker', 'vibe', BIN_DIRECTORY));
    const configured = path.join(home, 'outils', EXECUTABLE);

    expect(vibeExecutable(configured, { environment: {}, homedir: home })).toBe(configured);
  });

  it('revient à la commande nue vibe quand rien n’est installé', () => {
    const home = temporaryHome();

    expect(vibeExecutable(null, { environment: {}, homedir: home })).toBe('vibe');
  });
});
