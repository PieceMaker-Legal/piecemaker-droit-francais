/**
 * Routes HTTP de l'activation par dossier : requêtes et réponses, validation d'entrée.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const { createActivationRouter } = require('./routes.cjs');
const { pieceMakerLibraryDirs, userLibraryDirs } = require('./library.cjs');

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

test('GET /activation rend le snapshot avec workspacePath valide', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const app = express();
  app.use(express.json());
  app.use(createActivationRouter({ repoRoot, piecemakerHome, userHome }));

  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/activation?workspacePath=${encodeURIComponent(workspacePath)}`);
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.workspacePath, fs.realpathSync(workspacePath));
    assert(snapshot.claude);
    assert(snapshot.codex);
    assert(snapshot.library);
    assert(snapshot.globalLeftovers);
  } finally {
    server.close();
  }
});

test('GET /activation retourne 400 si workspacePath manque', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const app = express();
  app.use(express.json());
  app.use(createActivationRouter({ repoRoot, piecemakerHome, userHome }));

  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/activation`);
    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});

test('GET /activation retourne 400 si workspacePath n\'existe pas', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const app = express();
  app.use(express.json());
  app.use(createActivationRouter({ repoRoot, piecemakerHome, userHome }));

  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/activation?workspacePath=/nonexistent/path`);
    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});

test('POST /activation/toggle with family=skill retourne 400', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const app = express();
  app.use(express.json());
  app.use(createActivationRouter({ repoRoot, piecemakerHome, userHome }));

  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/activation/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath,
        assistant: 'claude',
        family: 'skill',
        id: 'any',
        enabled: true,
      }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert(body.error);
  } finally {
    server.close();
  }
});

test('POST /activation/library install/uninstall round-trip', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const pieceMakerDirs = pieceMakerLibraryDirs(repoRoot);
  writeSkillFixture(pieceMakerDirs.skills, 'test-skill');

  const app = express();
  app.use(express.json());
  app.use(createActivationRouter({ repoRoot, piecemakerHome, userHome }));

  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    let response = await fetch(`${base}/activation/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath,
        assistant: 'claude',
        family: 'skill',
        id: 'test-skill',
        installed: true,
      }),
    });
    assert.equal(response.status, 200);
    let body = await response.json();
    assert.equal(body.item.installed.claude, true);

    response = await fetch(`${base}/activation/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath,
        assistant: 'claude',
        family: 'skill',
        id: 'test-skill',
        installed: false,
      }),
    });
    assert.equal(response.status, 200);
    body = await response.json();
    assert.equal(body.item.installed.claude, false);
  } finally {
    server.close();
  }
});

test('POST /activation/library rejects agent+codex', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const app = express();
  app.use(express.json());
  app.use(createActivationRouter({ repoRoot, piecemakerHome, userHome }));

  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/activation/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath,
        assistant: 'codex',
        family: 'agent',
        id: 'any',
        installed: true,
      }),
    });
    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});

test('POST /activation/library rejects path traversal in id', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const app = express();
  app.use(express.json());
  app.use(createActivationRouter({ repoRoot, piecemakerHome, userHome }));

  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/activation/library`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspacePath,
        assistant: 'claude',
        family: 'skill',
        id: '../../evil',
        installed: true,
      }),
    });
    assert.equal(response.status, 400);
    assert.equal(fs.existsSync(path.join(workspacePath, '..', 'evil')), false);
  } finally {
    server.close();
  }
});

test('POST /activation/library/adopt moves a leftover', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const globalSkillsDir = path.join(userHome, '.claude', 'skills');
  writeSkillFixture(globalSkillsDir, 'leftover-skill');

  const app = express();
  app.use(express.json());
  app.use(createActivationRouter({ repoRoot, piecemakerHome, userHome }));

  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/activation/library/adopt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistant: 'claude',
        family: 'skill',
        id: 'leftover-skill',
      }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(fs.existsSync(path.join(globalSkillsDir, 'leftover-skill')), false);
  } finally {
    server.close();
  }
});

test('POST /activation/library/adopt rejects agent+codex', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const app = express();
  app.use(express.json());
  app.use(createActivationRouter({ repoRoot, piecemakerHome, userHome }));

  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${base}/activation/library/adopt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assistant: 'codex',
        family: 'agent',
        id: 'any',
      }),
    });
    assert.equal(response.status, 400);
  } finally {
    server.close();
  }
});

test('GET /activation called twice does not migrate any leftover', async () => {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-repo-'));
  const piecemakerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-home-'));
  const workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-ws-'));
  const userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-user-'));

  const globalSkillsDir = path.join(userHome, '.claude', 'skills');
  writeSkillFixture(globalSkillsDir, 'leftover-skill');

  const app = express();
  app.use(express.json());
  app.use(createActivationRouter({ repoRoot, piecemakerHome, userHome }));

  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    let response = await fetch(`${base}/activation?workspacePath=${encodeURIComponent(workspacePath)}`);
    let snapshot = await response.json();
    assert.equal(snapshot.globalLeftovers.skills.length, 1);

    response = await fetch(`${base}/activation?workspacePath=${encodeURIComponent(workspacePath)}`);
    snapshot = await response.json();
    assert.equal(snapshot.globalLeftovers.skills.length, 1);
    assert(fs.existsSync(path.join(globalSkillsDir, 'leftover-skill')));
  } finally {
    server.close();
  }
});
