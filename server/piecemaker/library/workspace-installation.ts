import fs from 'node:fs';
import path from 'node:path';

const SKILL_PROVIDERS = ['.claude', '.agents', '.cursor', '.opencode'];

const AGENT_TARGETS = [
  { provider: '.claude', folder: 'agents', extension: '.md', sourceFile: 'agent.md' },
  { provider: '.codex', folder: 'agents', extension: '.toml', sourceFile: 'agent.toml' },
  { provider: '.opencode', folder: 'agent', extension: '.md', sourceFile: 'agent.md' },
] as const;

function assertWorkspaceDirectory(workspace: string, directory: string, enabled: boolean) {
  if (!fs.existsSync(directory)) {
    if (enabled) fs.mkdirSync(directory);
    return;
  }
  if (!fs.statSync(directory).isDirectory() || !fs.realpathSync(directory).startsWith(workspace + path.sep)) {
    throw new Error(`Répertoire de composants hors du dossier : ${directory}`);
  }
}

export function prepareWorkspaceInstallation(workspace: string, id: string, packageRoot: string, kind: 'skill' | 'agent', enabled: boolean) {
  const targets = kind === 'skill'
    ? SKILL_PROVIDERS.map((provider) => {
      const parent = path.join(workspace, provider, 'skills');
      for (const directory of [path.dirname(parent), parent]) assertWorkspaceDirectory(workspace, directory, enabled);
      return {
        parent,
        target: path.join(parent, `piecemaker-${id}`),
        source: packageRoot,
        kind: 'skill' as const,
      };
    })
    : AGENT_TARGETS.map((entry) => {
      const parent = path.join(workspace, entry.provider, entry.folder);
      for (const directory of [path.dirname(parent), parent]) assertWorkspaceDirectory(workspace, directory, enabled);
      return {
        parent,
        target: path.join(parent, `piecemaker-${id}${entry.extension}`),
        source: path.join(packageRoot, entry.sourceFile),
        kind: 'agent' as const,
      };
    });

  const prepared = targets.map((entry) => {
    let existing: fs.Stats;
    try { existing = fs.lstatSync(entry.target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...entry, installed: false, content: null };
      throw error;
    }
    const content = entry.kind === 'agent' && existing.isFile() ? fs.readFileSync(entry.target) : null;
    const owned = entry.kind === 'skill'
      ? existing.isSymbolicLink() && path.resolve(entry.parent, fs.readlinkSync(entry.target)) === entry.source
      : content && fs.existsSync(entry.source) && content.equals(fs.readFileSync(entry.source));
    if (!owned) throw new Error(`Composant personnel préservé : ${entry.target}`);
    return { ...entry, installed: true, content };
  });

  return () => {
    const changed: typeof prepared = [];
    try {
      for (const entry of prepared) {
        const { target, source, installed, kind: targetKind } = entry;
        if (enabled && targetKind === 'agent') {
          fs.copyFileSync(source, target);
          changed.push(entry);
        } else if (enabled && !installed) {
          fs.symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
          changed.push(entry);
        } else if (!enabled && installed) {
          fs.unlinkSync(target);
          changed.push(entry);
        }
      }
    } catch (error) {
      for (const { target, source, content, installed } of changed.reverse()) {
        if (content) fs.writeFileSync(target, content);
        else if (!installed) fs.unlinkSync(target);
        else fs.symlinkSync(source, target, process.platform === 'win32' ? 'junction' : 'dir');
      }
      throw error;
    }
  };
}
