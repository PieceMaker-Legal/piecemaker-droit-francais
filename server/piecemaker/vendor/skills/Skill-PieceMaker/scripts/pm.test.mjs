import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { findVendor, parseArgv, run } from './pm.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

test('parseArgv sépare drapeaux, booléens et positionnels', () => {
  assert.deepEqual(parseArgv(['sql', '--requete', 'SELECT 1', '--dossier', '/tmp']), {
    flags: { requete: 'SELECT 1', dossier: '/tmp' },
    positional: ['sql'],
  });
  assert.deepEqual(parseArgv(['conversion', '--force', 'contrat.pdf']), {
    flags: { force: true },
    positional: ['conversion', 'contrat.pdf'],
  });
  assert.equal(parseArgv(['chronologie', 'modifier', '--date', '']).flags.date, '');
  assert.equal(parseArgv(['--help']).flags.help, true);
});

test('findVendor résout le vendor voisin et PIECEMAKER_VENDOR', () => {
  const vendor = findVendor({ here: HERE, cwd: os.tmpdir(), env: {} });
  assert.equal(vendor, path.resolve(HERE, '..', '..', '..'));
  const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-skill-vendor-'));
  fs.mkdirSync(path.join(isolated, 'installer', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(isolated, 'installer', 'lib', 'conversion-client.mjs'), '');
  assert.equal(findVendor({ here: os.tmpdir(), cwd: os.tmpdir(), env: { PIECEMAKER_VENDOR: isolated } }), isolated);
  fs.rmSync(isolated, { recursive: true, force: true });
});

test('sql et chronologie passent par sqlFn', async () => {
  const calls = [];
  const deps = {
    sqlFn: async (input) => {
      calls.push(input);
      return 'ok';
    },
    chronologieSql: (input) => `SQL:${input.action}:${input.piece}:${input.date}`,
  };
  assert.equal(await run(['sql', '--requete', 'SELECT label FROM piecemaker_nodes'], { deps }), 'ok');
  assert.deepEqual(calls[0], { requete: 'SELECT label FROM piecemaker_nodes', cwd: process.cwd() });
  await run(['chronologie', 'modifier', '--piece', 'doc:1', '--date', '2024-03-01'], { deps });
  assert.equal(calls[1].requete, 'SQL:modifier:doc:1:2024-03-01');
});

test('afficher vérifie le fichier et refuse une cible vide', async () => {
  const deps = { exists: (file) => file === path.resolve(process.cwd(), 'Actes/lettre.docx') };
  assert.equal(
    await run(['afficher', '--fichier', 'Actes/lettre.docx'], { deps }),
    'Affiché dans le volet de lecture : Actes/lettre.docx',
  );
  await assert.rejects(() => run(['afficher', '--fichier', 'absent.docx'], { deps }), /introuvable/);
  assert.equal(await run(['afficher', '--volet', 'chronologie'], { deps }), 'Volet affiché : chronologie');
  await assert.rejects(() => run(['afficher'], { deps }), /fichier ou un volet/);
});

test('tabular_review ouvre localement et transmet le reste', async () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-skill-tr-'));
  fs.mkdirSync(path.join(dossier, 'Tabular Review'));
  fs.writeFileSync(path.join(dossier, 'Tabular Review', 'analyse-exemple.json'), '{}');
  const calls = [];
  const deps = {
    reviewFile: (root, fichier) => {
      const name = path.basename(String(fichier ?? ''));
      if (!fs.existsSync(path.join(root, 'Tabular Review', name))) throw new Error(`introuvable : ${name}`);
      return name;
    },
    tabularFn: async (input) => {
      calls.push(input);
      if (input.action === 'documents') return ['Pièces/bail.md'];
      return { projet: 'p-1' };
    },
  };
  const opened = await run(['tabular_review', 'ouvrir', '--fichier', 'analyse-exemple.json', '--dossier', dossier], { deps });
  assert.match(opened, /analyse-exemple\.json/);
  await assert.rejects(() => run(['tabular_review', 'ouvrir', '--fichier', 'absente.json', '--dossier', dossier], { deps }), /introuvable/);
  const prepared = await run([
    'tabular_review', 'preparer', '--dossier', dossier, '--mode', 'recherche', '--nom', 'Faute grave',
    '--recherche', '{"query":"faute","sources":["cassation"]}',
  ], { deps });
  assert.equal(prepared, '{"projet":"p-1"}');
  assert.deepEqual(calls[0].recherche, { query: 'faute', sources: ['cassation'] });
  assert.equal(await run(['tabular_review', 'documents', '--dossier', dossier], { deps }), 'Pièces/bail.md');
  fs.rmSync(dossier, { recursive: true, force: true });
});

test('conversion lance le CLI piecemaker', async () => {
  const calls = [];
  const deps = {
    execFn: async (args, cwd) => {
      calls.push({ args, cwd });
      return { code: 0, stdout: '{"result":{"documents":1}}', stderr: '' };
    },
  };
  const text = await run(['conversion', '--force', 'contrat.pdf', '--dossier', '/tmp/affaire'], { deps });
  assert.equal(text, '{"result":{"documents":1}}');
  assert.deepEqual(calls[0], {
    args: ['conversion', '--json', '--case', '/tmp/affaire', 'contrat.pdf', '--force'],
    cwd: '/tmp/affaire',
  });
});
