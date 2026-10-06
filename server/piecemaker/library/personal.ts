import fs from 'node:fs';
import path from 'node:path';

const CLAUDE_SKILL_ROOTS = ['.claude/skills', '.claude/skills/synced', '.claude/commands'];
const AGENTS_SKILL_ROOTS = ['.agents/skills'];
const OTHER_SKILL_ROOTS = ['.codex/skills', '.cursor/skills', '.config/opencode/skills', '.vibe/skills', '.grok/skills'];

export type PersonalSkillOrigin = { personal: boolean; claude: boolean; agents: boolean };

function realOrResolved(file: string) {
  try { return fs.realpathSync(file); } catch { return path.resolve(file); }
}

function within(file: string, prefixes: string[]) {
  return prefixes.some((prefix) => file === prefix || file.startsWith(prefix + path.sep));
}

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
    } catch {}
  }
  return prefixes;
}

export function personalSkillClassifier(userHome: string) {
  const home = realOrResolved(userHome);
  const scan = (relatives: string[]) => relatives.flatMap((relative) => rootPrefixes(path.join(home, ...relative.split('/'))));
  const claude = scan(CLAUDE_SKILL_ROOTS);
  const agents = scan(AGENTS_SKILL_ROOTS);
  const others = scan(OTHER_SKILL_ROOTS);
  return (source: string): PersonalSkillOrigin => {
    const inClaude = within(source, claude);
    const inAgents = within(source, agents);
    return { personal: inClaude || inAgents || within(source, others), claude: inClaude, agents: inAgents };
  };
}
