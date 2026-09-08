import fs from 'node:fs';
import path from 'node:path';

export function prepareWorkspaceInstallation(workspace: string, id: string, packageRoot: string, kind: 'skill' | 'agent', enabled: boolean) {
  const providers = kind === 'skill' ? ['.claude', '.agents'] : ['.claude', '.codex'];
  const targets = providers.map((provider) => {
    const parent = path.join(workspace, provider, kind === 'skill' ? 'skills' : 'agents');
    const extension = kind === 'skill' ? '' : provider === '.claude' ? '.md' : '.toml';
    const source = kind === 'skill' ? packageRoot : path.join(packageRoot, `agent${extension}`);
    for (const directory of [path.dirname(parent), parent]) {
      if (!fs.existsSync(directory)) {
        if (enabled) fs.mkdirSync(directory);
        continue;
      }
      if (!fs.statSync(directory).isDirectory() || !fs.realpathSync(directory).startsWith(workspace + path.sep)) {
        throw new Error(`Répertoire de composants hors du dossier : ${directory}`);
      }
    }
    const target = path.join(parent, `piecemaker-${id}${extension}`);
    let existing: fs.Stats;
    try { existing = fs.lstatSync(target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { target, source, installed: false, content: null };
      throw error;
    }
    const content = kind === 'agent' && existing.isFile() ? fs.readFileSync(target) : null;
    const owned = kind === 'skill'
      ? existing.isSymbolicLink() && path.resolve(parent, fs.readlinkSync(target)) === source
      : content && fs.existsSync(source) && content.equals(fs.readFileSync(source));
    if (!owned) {
      throw new Error(`Composant personnel préservé : ${target}`);
    }
    return { target, source, installed: true, content };
  });

  return () => {
    const changed: typeof targets = [];
    try {
      for (const entry of targets) {
        const { target, source, installed } = entry;
        if (enabled && kind === 'agent') {
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
