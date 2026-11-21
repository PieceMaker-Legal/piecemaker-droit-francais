import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createBrain, disableNativeMemory } from './brain.js';

const skills = path.join(path.dirname(fileURLToPath(import.meta.url)), 'vendor', 'brain', 'skills');

function fixture() {
  const base = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'pm-brain-')));
  const home = path.join(base, '.piecemaker');
  const brain = createBrain({ home, defaultRoot: path.join(base, 'PieceMaker Agent'), skills });
  return { base, home, brain, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test('le brain est choisi par l’utilisateur, avec un emplacement par défaut', t => {
  const f = fixture();
  t.after(f.cleanup);
  assert.equal(f.brain.root(), path.join(f.base, 'PieceMaker Agent'));
  assert.throws(() => f.brain.setRoot('relatif/brain'), /absolu/);
  f.brain.setRoot(path.join(f.base, 'Mon brain'));
  assert.equal(f.brain.root(), path.join(f.base, 'Mon brain'));
});

test('le brain reprend perso.md comme AGENTS.md, l’importe dans CLAUDE.md et garde ses skills pour lui', t => {
  const f = fixture();
  t.after(f.cleanup);
  const root = path.join(f.base, 'brain');
  f.brain.setRoot(root);
  writeFileSync(path.join(f.home, 'brain.json'), JSON.stringify({ path: root }));
  const perso = path.join(f.home, 'custom', 'perso.md');
  f.brain.prepare(root);
  assert.equal(readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  assert.equal(readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), readFileSync(perso, 'utf8'));
  writeFileSync(path.join(root, 'AGENTS.md'), 'Profil de Jean Dupont\n');
  if (process.platform !== 'win32') assert.equal(readFileSync(perso, 'utf8'), 'Profil de Jean Dupont\n');
  for (const name of ['grill-me', 'connect-tool', 'skill-manager', 'setup-brain']) {
    assert.ok(existsSync(path.join(root, '.agents', 'skills', name, 'SKILL.md')), name);
    assert.ok(existsSync(path.join(root, '.claude', 'skills', name, 'SKILL.md')), name);
  }
  writeFileSync(path.join(root, '.agents', 'skills', 'grill-me', 'SKILL.md'), 'version de l’utilisateur');
  f.brain.prepare(root);
  assert.equal(readFileSync(path.join(root, '.agents', 'skills', 'grill-me', 'SKILL.md'), 'utf8'), 'version de l’utilisateur');
  assert.equal(readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), 'Profil de Jean Dupont\n');
});

test('chaque dossier suivi a seulement son About.md, sa Roadmap.json et le script de synthèse dans le brain, sans écraser ce que l’agent a écrit', t => {
  const f = fixture();
  t.after(f.cleanup);
  const root = path.join(f.base, 'brain');
  mkdirSync(path.join(f.base, 'Dossier Dupont'), { recursive: true });
  f.brain.prepareCase(root, path.join(f.base, 'Dossier Dupont'));
  const directory = path.join(root, 'projects', 'Dossier Dupont');
  const about = path.join(directory, 'About.md');
  assert.match(readFileSync(about, 'utf8'), /^# Dossier Dupont\n/);
  assert.equal(readFileSync(path.join(directory, 'Roadmap.json'), 'utf8'), '{}\n');
  assert.match(readFileSync(path.join(directory, 'synthese.mjs'), 'utf8'), /export default async function synthese/);
  assert.equal(existsSync(path.join(directory, 'Roadmap.md')), false);
  assert.deepEqual(JSON.parse(readFileSync(path.join(root, '.piecemaker', 'dossiers.json'), 'utf8')), { [path.join(f.base, 'Dossier Dupont')]: 'Dossier Dupont' });
  writeFileSync(about, 'Statut : en cours\n');
  f.brain.prepareCase(root, path.join(f.base, 'Dossier Dupont'));
  assert.equal(readFileSync(about, 'utf8'), 'Statut : en cours\n');
  assert.deepEqual(JSON.parse(readFileSync(path.join(f.base, 'Dossier Dupont', '.claude', 'settings.local.json'), 'utf8')), { autoMemoryEnabled: false });
});

test('la mémoire native de Claude est coupée sans toucher aux autres réglages locaux', t => {
  const f = fixture();
  t.after(f.cleanup);
  const folder = path.join(f.base, 'Societe Exemple');
  const file = path.join(folder, '.claude', 'settings.local.json');
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ permissions: { allow: ['Bash(git diff)'] } }));
  disableNativeMemory(folder);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { permissions: { allow: ['Bash(git diff)'] }, autoMemoryEnabled: false });
  writeFileSync(file, '{ invalide');
  disableNativeMemory(folder);
  assert.equal(readFileSync(file, 'utf8'), '{ invalide');
});

test('changer le brain de place y emporte tout son contenu : profil, skills, paires des dossiers et index', t => {
  const f = fixture();
  t.after(f.cleanup);
  const from = path.join(f.base, 'brain');
  f.brain.setRoot(from);
  f.brain.prepare(from);
  mkdirSync(path.join(f.base, 'Dossier Dupont'), { recursive: true });
  f.brain.prepareCase(from, path.join(f.base, 'Dossier Dupont'));
  writeFileSync(path.join(from, 'projects', 'Dossier Dupont', 'About.md'), 'Statut : en cours\n');
  mkdirSync(path.join(f.base, 'Plein'), { recursive: true });
  writeFileSync(path.join(f.base, 'Plein', 'note.md'), 'x');
  assert.throws(() => f.brain.move(path.join(f.base, 'Plein')), /pas vide/);
  assert.throws(() => f.brain.move(path.join(from, 'sous')), /ancien brain/);
  const target = path.join(f.base, 'Nouveau', 'Brain');
  f.brain.move(target);
  assert.equal(f.brain.root(), target);
  assert.equal(existsSync(from), false);
  assert.equal(readFileSync(path.join(target, 'projects', 'Dossier Dupont', 'About.md'), 'utf8'), 'Statut : en cours\n');
  assert.ok(existsSync(path.join(target, 'projects', 'Dossier Dupont', 'Roadmap.json')));
  assert.ok(existsSync(path.join(target, '.piecemaker', 'dossiers.json')));
  assert.ok(existsSync(path.join(target, '.claude', 'skills', 'grill-me', 'SKILL.md')));
  assert.equal(readFileSync(path.join(target, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
});
