import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { declareDocxCliSkill } from './skill-declaration.js';

const LINKS = ['.claude/skills/docx-cli', '.cursor/skills/docx-cli', '.opencode/skills/docx-cli', '.grok/skills/docx-cli'];

function temporaryFolder() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-docx-cli-')));
}

function skillPath(folder: string) {
  return path.join(folder, '.agents', 'skills', 'docx-cli', 'SKILL.md');
}

test('installe docx-cli dans .agents/skills et le relie aux providers', () => {
  const folder = temporaryFolder();
  declareDocxCliSkill(folder);
  assert.match(fs.readFileSync(skillPath(folder), 'utf8'), /^---\nname: docx-cli\n/);
  assert.equal(fs.existsSync(path.join(folder, '.agents', 'skills', 'docx-cli', 'scripts', 'bootstrap.sh')), true);
  const root = fs.realpathSync(path.join(folder, '.agents', 'skills', 'docx-cli'));
  for (const relative of LINKS) {
    assert.equal(fs.lstatSync(path.join(folder, relative)).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(path.join(folder, relative)), root);
  }
});

test('un second passage ne réécrit aucun fichier', () => {
  const folder = temporaryFolder();
  declareDocxCliSkill(folder);
  const skill = skillPath(folder);
  const old = new Date('2020-01-01T00:00:00Z');
  fs.utimesSync(skill, old, old);
  const before = { content: fs.readFileSync(skill, 'utf8'), mtimeMs: fs.statSync(skill).mtimeMs };
  declareDocxCliSkill(folder);
  assert.equal(fs.readFileSync(skill, 'utf8'), before.content);
  assert.equal(fs.statSync(skill).mtimeMs, before.mtimeMs);
});

test('une copie personnelle n’est pas écrasée', () => {
  const folder = temporaryFolder();
  const skill = skillPath(folder);
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, '---\nname: docx-cli\ndescription: perso\n---\n');
  declareDocxCliSkill(folder);
  assert.equal(fs.readFileSync(skill, 'utf8'), '---\nname: docx-cli\ndescription: perso\n---\n');
  assert.equal(fs.existsSync(path.join(folder, '.claude', 'skills', 'docx-cli')), false);
});

test('une copie encore identique au dernier bundle est mise à jour', () => {
  const folder = temporaryFolder();
  const skill = skillPath(folder);
  const stale = '---\nname: docx-cli\ndescription: ancien\n---\n';
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, stale);
  const marker = path.join(folder, '.piecemaker', 'bundled-skills.json');
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, `${JSON.stringify({
    'docx-cli': { '.agents/skills/docx-cli/SKILL.md': createHash('sha256').update(stale).digest('hex') },
  }, null, 2)}\n`);
  declareDocxCliSkill(folder);
  const content = fs.readFileSync(skill, 'utf8');
  assert.match(content, /^---\nname: docx-cli\n/);
  assert.equal(content.includes('description: ancien'), false);
  assert.equal(fs.existsSync(path.join(folder, '.agents', 'skills', 'docx-cli', 'scripts', 'bootstrap.sh')), true);
});

test('un dossier inexistant est journalisé sans lever d’erreur', (context) => {
  const warn = context.mock.method(console, 'warn', () => undefined);
  declareDocxCliSkill(path.join(temporaryFolder(), 'absent'));
  assert.equal(warn.mock.callCount(), 1);
});
