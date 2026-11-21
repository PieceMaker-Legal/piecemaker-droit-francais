import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'fs';
import path from 'path';

export const BRAIN_LIMITS: Record<string, number> = { 'AGENTS.md': 200, 'About.md': 100, 'Roadmap.md': 150 };

const PERSO_HEADER = 'Pour remplir ce document, lire @cold-start-interview.md\n';

type BrainOptions = { home: string; defaultRoot: string; skills: string };

const present = (target: string) => {
  try { lstatSync(target); return true; } catch { return false; }
};

function link(source: string, target: string, relative: string) {
  try {
    symlinkSync(relative, target, process.platform === 'win32' ? 'junction' : undefined);
  } catch {
    cpSync(source, target, { recursive: true });
  }
}

export function disableNativeMemory(folder: string) {
  const file = path.join(folder, '.claude', 'settings.local.json');
  let settings: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
    settings = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return;
  }
  if (settings.autoMemoryEnabled === false) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...settings, autoMemoryEnabled: false }, null, 2) + '\n');
}

export function caseFolderName(folder: string) {
  return path.basename(path.resolve(folder));
}

export function createBrain({ home, defaultRoot, skills }: BrainOptions) {
  const config = path.join(home, 'brain.json');

  function root(): string {
    try {
      const value = JSON.parse(readFileSync(config, 'utf8'))?.path;
      if (typeof value === 'string' && path.isAbsolute(value)) return path.resolve(value);
    } catch {
      return defaultRoot;
    }
    return defaultRoot;
  }

  function setRoot(value: unknown) {
    if (typeof value !== 'string' || !path.isAbsolute(value.trim())) throw Object.assign(new Error('Chemin absolu du brain requis.'), { code: 400 });
    const target = path.resolve(value.trim());
    mkdirSync(target, { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(config, JSON.stringify({ path: target }, null, 2) + '\n');
    return { path: target };
  }

  function prepare(brain: string) {
    mkdirSync(path.join(brain, 'projects'), { recursive: true });
    const agents = path.join(brain, 'AGENTS.md');
    if (!present(agents)) {
      const perso = path.join(home, 'custom', 'perso.md');
      mkdirSync(path.dirname(perso), { recursive: true });
      if (!existsSync(perso)) writeFileSync(perso, PERSO_HEADER);
      try { symlinkSync(perso, agents); } catch { copyFileSync(perso, agents); }
    }
    disableNativeMemory(brain);
    const claude = path.join(brain, 'CLAUDE.md');
    if (!present(claude)) writeFileSync(claude, '@AGENTS.md\n');
    const installed = path.join(brain, '.agents', 'skills');
    mkdirSync(installed, { recursive: true });
    for (const entry of readdirSync(skills, { withFileTypes: true })) {
      const target = path.join(installed, entry.name);
      if (present(target)) continue;
      cpSync(path.join(skills, entry.name), target, { recursive: true });
    }
    const claudeSkills = path.join(brain, '.claude', 'skills');
    if (!present(claudeSkills)) {
      mkdirSync(path.dirname(claudeSkills), { recursive: true });
      link(installed, claudeSkills, path.join('..', '.agents', 'skills'));
    }
  }

  function prepareCase(brain: string, folder: string) {
    try {
      disableNativeMemory(folder);
      const name = caseFolderName(folder);
      const target = path.join(brain, 'projects', name);
      mkdirSync(target, { recursive: true });
      const about = path.join(target, 'About.md');
      if (!present(about)) {
        writeFileSync(about, `# ${name}\n\nStatut : à compléter\nDossier : ${path.resolve(folder)}\n\n## Ce que c'est\n\nÀ compléter\n\n## Faits clés\n\n## Décisions\n`);
      }
      const roadmap = path.join(target, 'Roadmap.md');
      if (!present(roadmap)) writeFileSync(roadmap, `# ${name} : feuille de route\n\n- [ ] À compléter\n`);
    } catch (error) {
      console.warn('[piecemaker] Brain :', error);
    }
  }

  return { root, setRoot, prepare, prepareCase };
}
