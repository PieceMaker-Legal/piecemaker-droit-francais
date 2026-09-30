import fs from 'node:fs';
import path from 'node:path';

// Racines des skills personnels, relatives à la maison de l'utilisateur.
// Claude Code ne lit que celles-ci (niveau utilisateur) ; les autres providers lisent .agents/skills du dossier.
export const CLAUDE_SKILL_ROOTS = ['.claude/skills', '.claude/skills/synced', '.claude/commands'] as const;
export const AGENTS_SKILL_ROOTS = ['.agents/skills'] as const;
export const PERSONAL_SKILL_ROOTS = [
  ...CLAUDE_SKILL_ROOTS,
  ...AGENTS_SKILL_ROOTS,
  '.codex/skills',
  '.cursor/skills',
  '.config/opencode/skills',
  '.vibe/skills',
  '.grok/skills',
] as const;

// Agents personnels (actifs partout, non désactivables par dossier).
export const PERSONAL_AGENT_ROOTS = [
  '.claude/agents',
  '.cursor/agents',
  '.config/opencode/agent',
  '.config/opencode/agents',
  '.grok/agents',
  '.codex/agents',
] as const;

// Fichiers de configuration utilisateur dont la bibliothèque importe les connecteurs (source : `<fichier>#<nom>`).
export const PERSONAL_CONNECTOR_FILES = [
  '.claude.json',
  '.codex/config.toml',
  '.cursor/mcp.json',
  '.config/opencode/opencode.json',
  '.config/opencode/opencode.jsonc',
  '.grok/config.toml',
] as const;

function realOrResolved(file: string) {
  try { return fs.realpathSync(file); } catch { return path.resolve(file); }
}

function within(file: string, prefixes: string[]) {
  return prefixes.some((prefix) => file === prefix || file.startsWith(prefix + path.sep));
}

const joined = (home: string, relative: string) => path.join(home, ...relative.split('/'));

// Préfixes réels d'une racine : la racine elle-même et les cibles des liens symboliques qu'elle contient
// (un skill lié depuis un autre dossier reste un skill personnel).
function rootPrefixes(root: string) {
  const prefixes = [realOrResolved(root)];
  let children: fs.Dirent[];
  try { children = fs.readdirSync(root, { withFileTypes: true }); } catch { return prefixes; }
  for (const child of children) {
    if (child.name.startsWith('.')) continue;
    const file = path.join(root, child.name);
    try {
      if (child.isSymbolicLink()) prefixes.push(fs.realpathSync(file));
      else if (child.isDirectory() && fs.lstatSync(path.join(file, 'SKILL.md')).isSymbolicLink()) prefixes.push(fs.realpathSync(path.join(file, 'SKILL.md')));
    } catch { /* lien cassé ou illisible : ignoré */ }
  }
  return prefixes;
}

export type PersonalSkillOrigin = { personal: boolean; claude: boolean; agents: boolean };

// Classe l'origine (chemin réel) d'un skill : personnelle, lue par Claude Code, lue via ~/.agents/skills.
export function personalSkillClassifier(userHome: string) {
  const home = realOrResolved(userHome);
  const scan = (relatives: readonly string[]) => relatives.flatMap((relative) => rootPrefixes(joined(home, relative)));
  const claude = scan(CLAUDE_SKILL_ROOTS);
  const agents = scan(AGENTS_SKILL_ROOTS);
  const others = scan(PERSONAL_SKILL_ROOTS.filter((root) => !(CLAUDE_SKILL_ROOTS as readonly string[]).includes(root) && !(AGENTS_SKILL_ROOTS as readonly string[]).includes(root)));
  return (source: string): PersonalSkillOrigin => {
    const inClaude = within(source, claude);
    const inAgents = within(source, agents);
    return { personal: inClaude || inAgents || within(source, others), claude: inClaude, agents: inAgents };
  };
}

// Reconnaît les origines personnelles des agents (dossiers) et des connecteurs (fichiers de configuration).
export function personalComponentMatcher(userHome: string) {
  const home = realOrResolved(userHome);
  const agentRoots = PERSONAL_AGENT_ROOTS.flatMap((relative) => {
    const root = joined(home, relative);
    return [...new Set([root, realOrResolved(root)])];
  });
  const connectorFiles = PERSONAL_CONNECTOR_FILES.flatMap((relative) => {
    const file = joined(home, relative);
    return [...new Set([file, realOrResolved(file)])];
  });
  return {
    agent: (source: string) => within(source, agentRoots),
    connector: (source: string) => connectorFiles.some((file) => source.startsWith(`${file}#`)),
  };
}
