/**
 * La levée de protection vise le dossier : elle couvre ses pièces, y compris
 * celles déposées après coup, et sa réactivation rend au cabinet le classement
 * exact qu'il avait choisi.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const protection = require('../vendor/piecemaker-plugin/scripts/lib/protection.cjs');
const { activateBypass, bypassState, deactivateBypass } = require('./bypass.cjs');

function caseWithPieces() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-bypass-'));
  fs.mkdirSync(path.join(root, 'Correspondance'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'paquet'), { recursive: true });
  fs.writeFileSync(path.join(root, 'assignation.pdf'), 'pdf');
  fs.writeFileSync(path.join(root, 'Correspondance', 'lettre.docx'), 'docx');
  fs.writeFileSync(path.join(root, 'note.md'), '# note');
  fs.writeFileSync(path.join(root, 'node_modules', 'paquet', 'index.js'), 'module.exports = {};');
  return root;
}

test('la levée couvre le dossier sans réécrire le classement des pièces', () => {
  const root = caseWithPieces();
  protection.writeProtection(root, { unprotected: [], resources: [] });
  const before = fs.readFileSync(protection.protectionFile(root), 'utf8');

  activateBypass(root, protection);
  assert.equal(protection.isProtectedFile(path.join(root, 'assignation.pdf'), root), false);
  assert.equal(protection.isProtectedFile(path.join(root, 'Correspondance', 'lettre.docx'), root), false);
  assert.equal(fs.readFileSync(protection.protectionFile(root), 'utf8'), before);
  assert.equal(bypassState(root, protection).active, true);
});

test('une pièce déposée pendant la levée en bénéficie sans nouvelle action', () => {
  const root = caseWithPieces();
  activateBypass(root, protection);

  fs.writeFileSync(path.join(root, 'conclusions.pdf'), 'pdf');
  assert.equal(protection.isProtectedFile(path.join(root, 'conclusions.pdf'), root), false);

  deactivateBypass(root, protection);
  assert.equal(protection.isProtectedFile(path.join(root, 'conclusions.pdf'), root), true);
});

test('la réactivation restitue exactement le classement d’avant', () => {
  const root = caseWithPieces();
  fs.writeFileSync(path.join(root, 'conclusions.pdf'), 'pdf');
  protection.writeProtection(root, { unprotected: ['assignation.pdf'], resources: ['Correspondance/lettre.docx'] });
  const before = fs.readFileSync(protection.protectionFile(root), 'utf8');
  assert.equal(protection.isProtectedFile(path.join(root, 'conclusions.pdf'), root), true);

  activateBypass(root, protection);
  assert.equal(protection.isProtectedFile(path.join(root, 'conclusions.pdf'), root), false);

  const state = deactivateBypass(root, protection);
  assert.equal(fs.readFileSync(protection.protectionFile(root), 'utf8'), before);
  assert.equal(state.active, false);
  assert.equal(fs.existsSync(path.join(root, '.piecemaker', 'protection-bypass.json')), false);
  assert.equal(protection.isProtectedFile(path.join(root, 'conclusions.pdf'), root), true);
});

test('une seconde levée ne déplace pas la date de la première', () => {
  const root = caseWithPieces();
  const savedAt = activateBypass(root, protection).savedAt;
  assert.equal(activateBypass(root, protection).savedAt, savedAt);
});

test('un dossier levé par la version précédente retrouve sa photographie', () => {
  const root = caseWithPieces();
  protection.writeProtection(root, { unprotected: ['assignation.pdf'], resources: [] });
  const before = fs.readFileSync(protection.protectionFile(root), 'utf8');

  fs.mkdirSync(path.join(root, '.piecemaker'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.piecemaker', 'protection-bypass.json'),
    JSON.stringify({ version: 1, savedAt: '2026-01-01T00:00:00.000Z', unprotected: ['assignation.pdf'], resources: [] }),
    'utf8',
  );
  protection.writeProtection(root, { unprotected: ['assignation.pdf', 'Correspondance/lettre.docx'] });

  deactivateBypass(root, protection);
  assert.equal(fs.readFileSync(protection.protectionFile(root), 'utf8'), before);
});

test('réactiver sans levée en cours ne touche à rien', () => {
  const root = caseWithPieces();
  protection.writeProtection(root, { unprotected: ['assignation.pdf'], resources: [] });
  const before = fs.readFileSync(protection.protectionFile(root), 'utf8');
  assert.equal(deactivateBypass(root, protection).active, false);
  assert.equal(fs.readFileSync(protection.protectionFile(root), 'utf8'), before);
});

test('les routes valident leur entrée et rendent l’état du dossier', async () => {
  const express = require('express');
  const { createProtectionBypassRouter } = require('./routes.cjs');

  const root = caseWithPieces();
  const app = express();
  app.use(express.json());
  app.use(createProtectionBypassRouter({
    resolveCase: (reference) => {
      if (reference !== 'dossier-test') throw new Error('Ce dossier juridique n’est pas enregistré.');
      return { id: 'dossier-test', root };
    },
    protection,
  }));

  const server = app.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/protection/bypass`;
  const put = (body) => fetch(base, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  try {
    assert.equal((await put({ case: 'dossier-test' })).status, 400);
    assert.equal((await put({ case: 'inconnu', active: true })).status, 400);

    assert.equal((await (await put({ case: 'dossier-test', active: true })).json()).active, true);
    assert.equal(protection.isProtectedFile(path.join(root, 'assignation.pdf'), root), false);

    const state = await (await fetch(`${base}?case=dossier-test`)).json();
    assert.equal(state.active, true);
    assert.equal(state.case, 'dossier-test');

    assert.equal((await (await put({ case: 'dossier-test', active: false })).json()).active, false);
    assert.equal(protection.isProtectedFile(path.join(root, 'assignation.pdf'), root), true);
  } finally {
    server.close();
  }
});
