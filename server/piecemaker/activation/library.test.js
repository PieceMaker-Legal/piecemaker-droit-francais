/**
 * Bibliothèque de skills et d'agents : installation, désinstallation, adoption et
 * cohabitation de composants historiquement globaux.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildLibrary,
  installLibraryComponent,
  adoptGlobalComponent,
  listGlobalLeftovers,
  pieceMakerLibraryDirs,
  userLibraryDirs,
} = require('./library.cjs');
const { ActivationError } = require('./errors.cjs');

function writeSkillFixture(dir, id, { name = id, description = undefined } = {}) {
  const skillDir = path.join(dir, id);
  fs.mkdirSync(skillDir, { recursive: true });
  const frontmatter = description ? `---\nname: ${name}\ndescription: ${description}\n---` : `---\nname: ${name}\n---`;
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), `${frontmatter}\n# Content\n`);
}

function writeAgentFixture(dir, id, { name = id, description = undefined } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const frontmatter = description ? `---\nname: ${name}\ndescription: ${description}\n---` : `---\nname: ${name}\n---`;
  fs.writeFileSync(path.join(dir, `${id}.md`), `${frontmatter}\n# Content\n`);
}

test('buildLibrary fusionne les sources piecemaker et library, library gagnant sur collision', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const pieceMakerDirs = pieceMakerLibraryDirs(repoRoot);
  const libraryDirs = userLibraryDirs(piecemakerHome);

  writeSkillFixture(pieceMakerDirs.skills, 'shared-skill', { name: 'PieceMaker Shared' });
  writeSkillFixture(pieceMakerDirs.skills, 'pm-only', { name: 'Only in PieceMaker' });
  writeSkillFixture(libraryDirs.skills, 'shared-skill', { name: 'Library Shared' });
  writeSkillFixture(libraryDirs.skills, 'lib-only', { name: 'Only in Library' });

  const library = buildLibrary(workspacePath, { repoRoot, piecemakerHome, userHome });

  assert.equal(library.skills.length, 3);
  const shared = library.skills.find((s) => s.id === 'shared-skill');
  assert.equal(shared.name, 'Library Shared');
  assert.equal(shared.origin, 'library');
  assert(library.skills.some((s) => s.id === 'pm-only' && s.origin === 'piecemaker'));
  assert(library.skills.some((s) => s.id === 'lib-only' && s.origin === 'library'));
});

test('installLibraryComponent copie un skill de la bibliothèque dans le dossier', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const pieceMakerDirs = pieceMakerLibraryDirs(repoRoot);
  writeSkillFixture(pieceMakerDirs.skills, 'test-skill', { name: 'Test Skill', description: 'A test' });

  const result = installLibraryComponent({
    workspacePath,
    assistant: 'claude',
    family: 'skill',
    id: 'test-skill',
    installed: true,
    repoRoot,
    piecemakerHome,
    userHome,
  });

  assert.equal(result.name, 'Test Skill');
  assert.equal(result.installed.claude, true);
  assert(fs.existsSync(path.join(workspacePath, '.claude', 'skills', 'test-skill', 'SKILL.md')));
});

test('installLibraryComponent rejette agent+codex', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  assert.throws(
    () => installLibraryComponent({
      workspacePath,
      assistant: 'codex',
      family: 'agent',
      id: 'any',
      installed: true,
      repoRoot,
      piecemakerHome,
      userHome,
    }),
    (error) => error instanceof ActivationError && error.status === 400,
  );
});

test('installLibraryComponent rejette un id contenant traversal', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  assert.throws(
    () => installLibraryComponent({
      workspacePath,
      assistant: 'claude',
      family: 'skill',
      id: '../../evil',
      installed: true,
      repoRoot,
      piecemakerHome,
      userHome,
    }),
    (error) => error instanceof ActivationError && error.status === 400,
  );
  assert.equal(fs.existsSync(path.join(workspacePath, '..', 'evil')), false);
});

test('installLibraryComponent rejette un composant inexistant', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  assert.throws(
    () => installLibraryComponent({
      workspacePath,
      assistant: 'claude',
      family: 'skill',
      id: 'nonexistent',
      installed: true,
      repoRoot,
      piecemakerHome,
      userHome,
    }),
    (error) => error instanceof ActivationError && error.status === 400,
  );
});

test('installLibraryComponent écrase une copie antérieure', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const pieceMakerDirs = pieceMakerLibraryDirs(repoRoot);
  writeSkillFixture(pieceMakerDirs.skills, 'test-skill', { name: 'v1' });

  installLibraryComponent({
    workspacePath,
    assistant: 'claude',
    family: 'skill',
    id: 'test-skill',
    installed: true,
    repoRoot,
    piecemakerHome,
    userHome,
  });

  const content1 = fs.readFileSync(path.join(workspacePath, '.claude', 'skills', 'test-skill', 'SKILL.md'), 'utf8');
  assert(content1.includes('v1'));

  writeSkillFixture(pieceMakerDirs.skills, 'test-skill', { name: 'v2' });

  installLibraryComponent({
    workspacePath,
    assistant: 'claude',
    family: 'skill',
    id: 'test-skill',
    installed: true,
    repoRoot,
    piecemakerHome,
    userHome,
  });

  const content2 = fs.readFileSync(path.join(workspacePath, '.claude', 'skills', 'test-skill', 'SKILL.md'), 'utf8');
  assert(content2.includes('v2'));
  assert(!content2.includes('v1'));
});

test('installLibraryComponent désinstalle (installed: false) sans toucher la bibliothèque', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const pieceMakerDirs = pieceMakerLibraryDirs(repoRoot);
  writeSkillFixture(pieceMakerDirs.skills, 'test-skill');

  installLibraryComponent({
    workspacePath,
    assistant: 'claude',
    family: 'skill',
    id: 'test-skill',
    installed: true,
    repoRoot,
    piecemakerHome,
    userHome,
  });
  assert(fs.existsSync(path.join(workspacePath, '.claude', 'skills', 'test-skill', 'SKILL.md')));
  assert(fs.existsSync(path.join(pieceMakerDirs.skills, 'test-skill', 'SKILL.md')));

  installLibraryComponent({
    workspacePath,
    assistant: 'claude',
    family: 'skill',
    id: 'test-skill',
    installed: false,
    repoRoot,
    piecemakerHome,
    userHome,
  });

  assert.equal(fs.existsSync(path.join(workspacePath, '.claude', 'skills', 'test-skill')), false);
  assert(fs.existsSync(path.join(pieceMakerDirs.skills, 'test-skill', 'SKILL.md')));
});

test('adoptGlobalComponent déplace un composant global dans la bibliothèque', () => {
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const globalSkillsDir = path.join(userHome, '.claude', 'skills');
  writeSkillFixture(globalSkillsDir, 'leftover-skill', { name: 'Leftover' });

  adoptGlobalComponent({
    assistant: 'claude',
    family: 'skill',
    id: 'leftover-skill',
    userHome,
    piecemakerHome,
  });

  assert.equal(fs.existsSync(path.join(globalSkillsDir, 'leftover-skill')), false);
  assert(fs.existsSync(path.join(piecemakerHome, 'library', 'skills', 'leftover-skill', 'SKILL.md')));
});

test('adoptGlobalComponent rejette si le même id existe déjà dans la bibliothèque', () => {
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const libraryDirs = userLibraryDirs(piecemakerHome);
  const globalSkillsDir = path.join(userHome, '.claude', 'skills');

  writeSkillFixture(libraryDirs.skills, 'conflict-skill', { name: 'In Library' });
  writeSkillFixture(globalSkillsDir, 'conflict-skill', { name: 'In Global' });

  const libraryContent = fs.readFileSync(path.join(libraryDirs.skills, 'conflict-skill', 'SKILL.md'), 'utf8');

  assert.throws(
    () => adoptGlobalComponent({
      assistant: 'claude',
      family: 'skill',
      id: 'conflict-skill',
      userHome,
      piecemakerHome,
    }),
    (error) => error instanceof ActivationError && error.status === 400,
  );

  assert.equal(
    fs.readFileSync(path.join(libraryDirs.skills, 'conflict-skill', 'SKILL.md'), 'utf8'),
    libraryContent,
  );
  assert(fs.existsSync(path.join(globalSkillsDir, 'conflict-skill')));
});

test('adoptGlobalComponent rejette un composant fourni par un plugin', () => {
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const pluginSkillsDir = path.join(userHome, '.claude', 'plugins', 'cache', 'marketplace', 'plugin-name', 'skills');
  writeSkillFixture(pluginSkillsDir, 'plugin-skill');

  assert.throws(
    () => adoptGlobalComponent({
      assistant: 'claude',
      family: 'skill',
      id: 'plugin-skill',
      userHome,
      piecemakerHome,
    }),
    (error) => error instanceof ActivationError && error.status === 400,
  );
});

test('adoptGlobalComponent rejette agent+codex', () => {
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  assert.throws(
    () => adoptGlobalComponent({
      assistant: 'codex',
      family: 'agent',
      id: 'any',
      userHome,
      piecemakerHome,
    }),
    (error) => error instanceof ActivationError && error.status === 400,
  );
});

test('listGlobalLeftovers exclut les composants fournis par un plugin', () => {
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const globalSkillsDir = path.join(userHome, '.claude', 'skills');
  const pluginSkillsDir = path.join(userHome, '.claude', 'plugins', 'cache', 'marketplace', 'plugin-name', 'skills');

  writeSkillFixture(globalSkillsDir, 'real-leftover');
  writeSkillFixture(pluginSkillsDir, 'plugin-skill');

  const leftovers = listGlobalLeftovers(userHome);

  assert.equal(leftovers.skills.length, 1);
  assert.equal(leftovers.skills[0].id, 'real-leftover');
  assert.equal(leftovers.skills[0].assistant, 'claude');
});

test('installLibraryComponent sur un agent copie un fichier, pas un dossier', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const pieceMakerDirs = pieceMakerLibraryDirs(repoRoot);
  writeAgentFixture(pieceMakerDirs.agents, 'test-agent', { name: 'Test Agent' });

  installLibraryComponent({
    workspacePath,
    assistant: 'claude',
    family: 'agent',
    id: 'test-agent',
    installed: true,
    repoRoot,
    piecemakerHome,
    userHome,
  });

  const agentPath = path.join(workspacePath, '.claude', 'agents', 'test-agent.md');
  assert(fs.existsSync(agentPath));
  assert(fs.statSync(agentPath).isFile());
});

test('buildLibrary indique installed: codex = null pour les agents', () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const pieceMakerDirs = pieceMakerLibraryDirs(repoRoot);
  writeAgentFixture(pieceMakerDirs.agents, 'test-agent');

  const library = buildLibrary(workspacePath, { repoRoot, piecemakerHome, userHome });
  const agent = library.agents[0];
  assert.equal(agent.installed.claude, false);
  assert.equal(agent.installed.codex, null);
});
