import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { declareBundledSkills } from './skill-declaration.js';

const DOCX_LINKS = ['.claude/skills/docx-cli', '.cursor/skills/docx-cli', '.opencode/skills/docx-cli', '.grok/skills/docx-cli'];
const REDACTION_LINKS = ['.claude/skills/redaction-juridique', '.cursor/skills/redaction-juridique', '.opencode/skills/redaction-juridique', '.grok/skills/redaction-juridique'];
const PIECEMAKER_LINKS = ['.claude/skills/Skill-PieceMaker', '.cursor/skills/Skill-PieceMaker', '.opencode/skills/Skill-PieceMaker', '.grok/skills/Skill-PieceMaker'];

function temporaryFolder() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-bundled-skills-')));
}

function skillPath(folder: string, slug: string) {
  return path.join(folder, '.agents', 'skills', slug, 'SKILL.md');
}

function assertLinked(folder: string, slug: string, links: string[]) {
  const root = fs.realpathSync(path.join(folder, '.agents', 'skills', slug));
  for (const relative of links) {
    assert.equal(fs.lstatSync(path.join(folder, relative)).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(path.join(folder, relative)), root);
  }
}

test('installe docx-cli et redaction-juridique dans .agents/skills et les relie aux providers', () => {
  const folder = temporaryFolder();
  declareBundledSkills(folder);
  assert.match(fs.readFileSync(skillPath(folder, 'docx-cli'), 'utf8'), /^---\nname: docx-cli\n/);
  assert.equal(fs.existsSync(path.join(folder, '.agents', 'skills', 'docx-cli', 'scripts', 'bootstrap.sh')), true);
  assert.match(fs.readFileSync(skillPath(folder, 'redaction-juridique'), 'utf8'), /^---\nname: redaction-juridique\n/);
  assert.match(fs.readFileSync(skillPath(folder, 'Skill-PieceMaker'), 'utf8'), /^---\nname: piecemaker\n/);
  assert.equal(fs.existsSync(path.join(folder, '.agents', 'skills', 'Skill-PieceMaker', 'scripts', 'pm.mjs')), true);
  const pmCli = path.join(folder, '.agents', 'skills', 'Skill-PieceMaker', 'scripts', 'pm');
  assert.equal(fs.existsSync(pmCli), true);
  assert.equal((fs.statSync(pmCli).mode & 0o111) !== 0, true);
  assertLinked(folder, 'docx-cli', DOCX_LINKS);
  assertLinked(folder, 'redaction-juridique', REDACTION_LINKS);
  assertLinked(folder, 'Skill-PieceMaker', PIECEMAKER_LINKS);
});

test('un second passage ne réécrit aucun fichier', () => {
  const folder = temporaryFolder();
  declareBundledSkills(folder);
  const skill = skillPath(folder, 'docx-cli');
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(skill, old, old);
  const before = { content: fs.readFileSync(skill, 'utf8'), mtimeMs: fs.statSync(skill).mtimeMs };
  declareBundledSkills(folder);
  assert.equal(fs.readFileSync(skill, 'utf8'), before.content);
  assert.equal(fs.statSync(skill).mtimeMs, before.mtimeMs);
});

test('une copie personnelle n’est pas écrasée', () => {
  const folder = temporaryFolder();
  const skill = skillPath(folder, 'docx-cli');
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, '---\nname: docx-cli\ndescription: perso\n---\n');
  declareBundledSkills(folder);
  assert.equal(fs.readFileSync(skill, 'utf8'), '---\nname: docx-cli\ndescription: perso\n---\n');
  assert.equal(fs.existsSync(path.join(folder, '.claude', 'skills', 'docx-cli')), false);
  assert.match(fs.readFileSync(skillPath(folder, 'redaction-juridique'), 'utf8'), /^---\nname: redaction-juridique\n/);
});

test('une copie encore identique au dernier bundle est mise à jour', () => {
  const folder = temporaryFolder();
  const skill = skillPath(folder, 'docx-cli');
  const stale = '---\nname: docx-cli\ndescription: ancien\n---\n';
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, stale);
  const marker = path.join(folder, '.piecemaker', 'bundled-skills.json');
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${JSON.stringify({
    'docx-cli': { '.agents/skills/docx-cli/SKILL.md': createHash('sha256').update(stale).digest('hex') },
  }, null, 2)}\n`);
  declareBundledSkills(folder);
  const content = fs.readFileSync(skill, 'utf8');
  assert.match(content, /^---\nname: docx-cli\n/);
  assert.equal(content.includes('description: ancien'), false);
  assert.equal(fs.existsSync(path.join(folder, '.agents', 'skills', 'docx-cli', 'scripts', 'bootstrap.sh')), true);
});

test('un dossier inexistant est journalisé sans lever d’erreur', (context) => {
  const warn = context.mock.method(console, 'warn', () => undefined);
  declareBundledSkills(path.join(temporaryFolder(), 'absent'));
  assert.equal(warn.mock.callCount(), 3);
});
