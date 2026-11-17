import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { agentInstructionsTemplate, ensureAgentInstructionFiles, startAgentInstructionsMigration } from './agent-instructions.js';

const SHARED = '/home/avocat/.piecemaker/CLAUDE.md';

async function withProject(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'agent-instructions-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const read = (root: string, name: string) => readFile(path.join(root, name), 'utf8');
const CLAUDE_IMPORTS = `@AGENTS.md\n@${SHARED}\n`;

test('creates AGENTS.md from the template and a CLAUDE.md that imports it', () => withProject(async (root) => {
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['CLAUDE.md', 'AGENTS.md']);
  assert.equal(await read(root, 'AGENTS.md'), agentInstructionsTemplate());
  assert.doesNotMatch(await read(root, 'AGENTS.md'), /^@/m);
  assert.equal(await read(root, 'CLAUDE.md'), CLAUDE_IMPORTS);
}));

test('moves a lone CLAUDE.md into AGENTS.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'consignes du dossier\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['AGENTS.md']);
  assert.equal(await read(root, 'AGENTS.md'), 'consignes du dossier\n');
  assert.equal(await read(root, 'CLAUDE.md'), CLAUDE_IMPORTS);
}));

test('adds the import next to an existing AGENTS.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes codex\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['CLAUDE.md']);
  assert.equal(await read(root, 'AGENTS.md'), 'consignes codex\n');
  assert.equal(await read(root, 'CLAUDE.md'), CLAUDE_IMPORTS);
}));

test('AGENTS.md wins over a CLAUDE.md that diverged', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'consignes Claude\n');
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes Codex\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), []);
  assert.equal(await read(root, 'AGENTS.md'), 'consignes Codex\n');
  assert.equal(await read(root, 'CLAUDE.md'), CLAUDE_IMPORTS);
}));

test('keeps Claude-specific lines written below the import', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes codex\n');
  await writeFile(path.join(root, 'CLAUDE.md'), `${CLAUDE_IMPORTS}\nPropre à Claude\n`);
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), []);
  assert.equal(await read(root, 'CLAUDE.md'), `${CLAUDE_IMPORTS}\nPropre à Claude\n`);
}));

test('adds the shared import to a CLAUDE.md that only imports AGENTS.md, keeping its own lines', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes codex\n');
  await writeFile(path.join(root, 'CLAUDE.md'), '@AGENTS.md\n\nPropre à Claude\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), []);
  assert.equal(await read(root, 'CLAUDE.md'), `${CLAUDE_IMPORTS}\nPropre à Claude\n`);
  assert.equal(await read(root, 'AGENTS.md'), 'consignes codex\n');
}));

test('never overwrites an existing AGENTS.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'parties, juridiction, échéances\n');
  await ensureAgentInstructionFiles(root, SHARED);
  await ensureAgentInstructionFiles(root, SHARED);
  assert.equal(await read(root, 'AGENTS.md'), 'parties, juridiction, échéances\n');
}));

test('updates the old suivi rule in an existing AGENTS.md and nothing else', () => withProject(async (root) => {
  const oldRule = '5° Suivi dossiers: Les échéances et les dates qui les font courir vont dans le suivi du dossier, .piecemaker/suivi.yaml, vérifié par pm suivi verifier (voir la skill piecemaker) ; l’avocat les voit pour tous ses dossiers dans l’onglet Échéances.';
  await writeFile(path.join(root, 'AGENTS.md'), `Ma règle sur suivi.yaml\n${oldRule}\n`);
  await ensureAgentInstructionFiles(root, SHARED);
  const lines = agentInstructionsTemplate().split('\n');
  const rule = lines.find((line) => line.startsWith('5° '));
  const discretion = lines.find((line) => line.startsWith('7° '));
  assert.match(discretion ?? '', /^7° Discrétion/);
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), `Ma règle sur suivi.yaml\n${rule}\n${discretion}\n`);
  await ensureAgentInstructionFiles(root, SHARED);
  assert.equal(await readFile(path.join(root, 'AGENTS.md'), 'utf8'), `Ma règle sur suivi.yaml\n${rule}\n${discretion}\n`);
}));

test('replaces the old project memory rule, which kept deadlines and stage in a frontmatter', () => withProject(async (root) => {
  const oldRule = '4° Suivi projets: Pour chaque projet demandé par l’utilisateur, crée puis maintiens un fichier Markdown servant de mémoire. Un projet correspond à un acte précis et identifié : jeu de conclusions, contrat, etc. Référence sa mémoire dans ce document avec son chemin et sa date de dernière mise à jour. Son frontmatter YAML indique le template utilisé, les échéances et l’étape en cours.';
  await writeFile(path.join(root, 'AGENTS.md'), `Ma règle\r\n${oldRule}\r\n`);
  await ensureAgentInstructionFiles(root, SHARED);
  const rule = agentInstructionsTemplate().split('\n').find((line) => line.startsWith('4° '));
  assert.match(rule ?? '', /\.piecemaker\/memoires\/<nom>\.md.*sans frontmatter.*pm memoire verifier/);
  assert.equal(await read(root, 'AGENTS.md'), `Ma règle\r\n${rule}\r\n`);
}));

test('points rule 6° of a previous template to the Feature tool', () => withProject(async (root) => {
  const template = agentInstructionsTemplate();
  const previous = template
    .replace('seul l’avocat l’accepte.', 'seul l’avocat l’accepte (voir la skill piecemaker).')
    .replace('pm memoire verifier la contrôle.', 'pm memoire verifier la contrôle (voir la skill piecemaker).')
    .replace('pm suivi_dossiers verifier ;', 'pm suivi_dossiers verifier (voir la skill piecemaker) ;')
    .replace('échéances → outil Feature : quickstart, puis lis les pages qu’il indique', 'échéances, raisonnement → skill piecemaker');
  assert.equal(previous.split('(voir la skill piecemaker)').length, 4);
  await writeFile(path.join(root, 'AGENTS.md'), `${previous}\n`);
  await ensureAgentInstructionFiles(root, SHARED);
  assert.equal(await read(root, 'AGENTS.md'), `${template}\n`);
}));

test('drops raisonnement from the Feature line of a previous template', () => withProject(async (root) => {
  const template = agentInstructionsTemplate();
  await writeFile(path.join(root, 'AGENTS.md'), `${template.replace('échéances → outil Feature', 'échéances, raisonnement → outil Feature')}\n`);
  await ensureAgentInstructionFiles(root, SHARED);
  assert.equal(await read(root, 'AGENTS.md'), `${template}\n`);
}));

test('adds the tools rule once to an AGENTS.md written from the template and keeps custom lines', () => withProject(async (root) => {
  const template = agentInstructionsTemplate();
  const withoutToolsRule = template.slice(0, template.indexOf('\n6° Outils:'));
  await writeFile(path.join(root, 'AGENTS.md'), `${withoutToolsRule}\nMa règle du dossier\n`);
  await ensureAgentInstructionFiles(root, SHARED);
  await ensureAgentInstructionFiles(root, SHARED);
  assert.equal(await read(root, 'AGENTS.md'), `${withoutToolsRule}\nMa règle du dossier\n${template.slice(withoutToolsRule.length + 1)}\n`);
}));

test('adds the delegation line once to a previous tools rule, keeping CRLF', () => withProject(async (root) => {
  const template = agentInstructionsTemplate();
  const lines = template.split('\n');
  const delegation = lines.find((line) => line.includes('sous-agent research-maker'));
  assert.ok(delegation);
  const previous = lines.filter((line) => line !== delegation).join('\r\n');
  await writeFile(path.join(root, 'AGENTS.md'), `${previous}\r\n`);
  await ensureAgentInstructionFiles(root, SHARED);
  await ensureAgentInstructionFiles(root, SHARED);
  assert.equal(await read(root, 'AGENTS.md'), `${lines.join('\r\n')}\r\n`);
}));

test('replaces the previous delegation lines without duplicating them', () => withProject(async (root) => {
  const template = agentInstructionsTemplate();
  const current = template.split('\n').find((line) => line.includes('sous-agent research-maker'))!;
  const tail = '. Lis leur compte rendu et la vérification qui le suit ; relance le sous-agent si une erreur subsiste. Sans sous-agent activé, fais-le toi-même avec le skill.';
  const research = ' ; question de droit → sous-agent research-maker';
  const deep = ' ; examen complet d’un point de droit dans la jurisprudence → sous-agent deep-research-maker';
  const reasoning = '- Index des pièces → sous-agent index-maker ; raisonnement d’un acte → sous-agent reasoning-maker, puis premise-maker pour les prémisses de son programme Catala';
  for (const line of [
    `- Index des pièces → sous-agent index-maker ; prémisses d’un programme Catala → sous-agent premise-maker${research}${deep}${tail}`,
    `- Index des pièces → sous-agent index-maker ; programme Catala d’un acte → sous-agent reasoning-maker, puis premise-maker pour ses prémisses${research}${deep}${tail}`,
    `${reasoning}${research}${deep}${tail}`,
    `${reasoning}${research}${tail}`,
  ]) {
    await writeFile(path.join(root, 'AGENTS.md'), template.replace(current, line));
    await ensureAgentInstructionFiles(root, SHARED);
    assert.equal(await read(root, 'AGENTS.md'), template);
  }
}));

test('leaves a tools rule rewritten by the lawyer untouched',() => withProject(async (root) => {
  const content = `${agentInstructionsTemplate().split('\n')[0]}\n6° Outils: ma propre table\n`;
  await writeFile(path.join(root, 'AGENTS.md'), content);
  await ensureAgentInstructionFiles(root, SHARED);
  assert.equal(await read(root, 'AGENTS.md'), content);
}));

test('points the rules of an existing AGENTS.md to arborescence.json and keeps custom lines', () => withProject(async (root) => {
  const oldGeneralRule = '2° Instructions générales: Au début de chaque session, lis ~/.piecemaker/custom/perso.md. Ce fichier, hors dépôt, contient les instructions générales de l’utilisateur, son arborescence habituelle dans ses dossiers, ses méthodes de travail. S’il manque, propose de le créer ; il commence toujours par la mention « Pour remplir ce document, lire @cold-start-interview.md ». Maintiens-le lorsque l’utilisateur précise ou modifie une consigne générale. 200 lignes max, synthétique.';
  const oldTreeRule = '3° Arborescence: Respecte arborescence convenue dans perso.md. Si absente, proposes en une à partir des dossiers existants, proposes des améliorations si ambigüe et fais-la valider avant de déplacer des fichiers. Les Markdown sous .piecemaker sont des fichiers techniques, pas les pièces originales : ne les déplace pas.';
  await writeFile(path.join(root, 'AGENTS.md'), `Ma règle sur perso.md\r\n${oldGeneralRule}\r\n${oldTreeRule}\r\n`);
  await ensureAgentInstructionFiles(root, SHARED);
  const [, , generalRule, treeRule] = agentInstructionsTemplate().split('\n');
  assert.match(treeRule, /\.piecemaker\/arborescence\.json/);
  assert.doesNotMatch(generalRule, /arborescence/);
  assert.equal(await read(root, 'AGENTS.md'), `Ma règle sur perso.md\r\n${generalRule}\r\n${treeRule}\r\n`);
}));

test('tells the agent of an existing AGENTS.md to propose the tree, not replace it', () => withProject(async (root) => {
  const replaceRule = '3° Arborescence: Respecte l’arborescence du dossier, enregistrée dans .piecemaker/arborescence.json : l’avocat la règle dans l’index du dossier, tu la lis dans ce fichier et tu la remplaces avec pm dossier arborescence (voir la skill piecemaker), un « / » dans un nom crée un sous-dossier. Si absente, proposes en une à partir des dossiers existants, proposes des améliorations si ambigüe et fais-la valider avant de déplacer des fichiers. Les Markdown sous .piecemaker sont des fichiers techniques, pas les pièces originales : ne les déplace pas.';
  await writeFile(path.join(root, 'AGENTS.md'), `${replaceRule}\n`);
  await ensureAgentInstructionFiles(root, SHARED);
  const treeRule = agentInstructionsTemplate().split('\n')[3];
  assert.match(treeRule, /seul l’avocat l’accepte/);
  assert.equal(await read(root, 'AGENTS.md'), `${treeRule}\n`);
}));

test('leaves the shared import out of an AGENTS.md moved from CLAUDE.md',() => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), `@${SHARED}\n\nconsignes du dossier\n`);
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['AGENTS.md']);
  assert.equal(await read(root, 'AGENTS.md'), '\nconsignes du dossier\n');
  assert.equal(await read(root, 'CLAUDE.md'), CLAUDE_IMPORTS);
}));

test('never copies the import into AGENTS.md itself', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), '@AGENTS.md\n');
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), ['AGENTS.md']);
  assert.equal(await read(root, 'AGENTS.md'), agentInstructionsTemplate());
}));

test('replaces a CLAUDE.md symlink with the import without touching AGENTS.md', () => withProject(async (root) => {
  await writeFile(path.join(root, 'AGENTS.md'), 'consignes\n');
  await symlink('AGENTS.md', path.join(root, 'CLAUDE.md'));
  await ensureAgentInstructionFiles(root, SHARED);
  assert.ok((await lstat(path.join(root, 'CLAUDE.md'))).isFile());
  assert.equal(await read(root, 'CLAUDE.md'), CLAUDE_IMPORTS);
  assert.equal(await read(root, 'AGENTS.md'), 'consignes\n');
}));

test('leaves an AGENTS.md symlinked to CLAUDE.md untouched', () => withProject(async (root) => {
  await writeFile(path.join(root, 'CLAUDE.md'), 'lien\n');
  await symlink('CLAUDE.md', path.join(root, 'AGENTS.md'));
  assert.deepEqual(await ensureAgentInstructionFiles(root, SHARED), []);
  assert.equal(await read(root, 'CLAUDE.md'), 'lien\n');
}));

test('the migration converts existing CLAUDE.md files and hands each project to the callback once', () => withProject(async (root) => {
  const withClaude = path.join(root, 'avec');
  const without = path.join(root, 'sans');
  await mkdir(withClaude);
  await mkdir(without);
  await writeFile(path.join(withClaude, 'CLAUDE.md'), 'consignes\n');
  const seen: string[] = [];
  const stop = startAgentInstructionsMigration(() => [withClaude, without, path.join(root, 'absent')], SHARED, (projectRoot) => seen.push(projectRoot));
  try {
    assert.deepEqual(seen, [withClaude, without]);
    for (let attempt = 0; attempt < 100 && (await read(withClaude, 'CLAUDE.md')) !== CLAUDE_IMPORTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(await read(withClaude, 'CLAUDE.md'), CLAUDE_IMPORTS);
    assert.equal(await read(withClaude, 'AGENTS.md'), 'consignes\n');
    await assert.rejects(read(without, 'CLAUDE.md'));
  } finally {
    stop();
  }
}));
