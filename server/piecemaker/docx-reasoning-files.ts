import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseLiteral } from '../modules/piecemaker-reasoning/format.js';

import { prepareDocxReasoning } from './docx-reasoning-prepare.js';
import { checkDocxReasoning } from './docx-reasoning-check.js';
import { readDocxReasoning } from './docx-reasoning.js';

type DocxAction = { commande: string; cwd: string; fichier: string; liens?: string; sortie?: string; modele?: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const inside = (root: string, file: string) => file.startsWith(root + path.sep);

async function resolveFile(root: string, file: unknown, extension: string, output = false) {
  if (typeof file !== 'string' || !file || !file.toLowerCase().endsWith(extension)) throw new TypeError(`Un chemin ${extension} est requis.`);
  const resolved = path.resolve(root, file);
  if (!inside(root, resolved) || /^\.env(?:\.|$)/i.test(path.basename(resolved))) throw new TypeError('Chemin refusé hors du dossier ou fichier réservé.');
  const actual = output ? path.join(await realpath(path.dirname(resolved)), path.basename(resolved)) : await realpath(resolved);
  if (!inside(root, actual) || !actual.toLowerCase().endsWith(extension) || /^\.env(?:\.|$)/i.test(path.basename(actual))) throw new TypeError('Lien symbolique hors du dossier ou fichier réservé.');
  return actual;
}

export async function runDocxReasoningAction(input: DocxAction) {
  if (!['preparer', 'comparer', 'extraire', 'verifier'].includes(input?.commande) || typeof input.cwd !== 'string') throw new TypeError('Commande DOCX attendue : preparer, comparer, extraire ou verifier.');
  const root = await realpath(input.cwd);
  const file = await resolveFile(root, input.fichier, '.docx');
  const bytes = await readFile(file);
  if (input.commande === 'verifier') return { canonique: 'docx', ...(await checkDocxReasoning(bytes)) };
  if (input.commande === 'preparer') {
    const modelPath = await resolveFile(root, input.modele ?? '.piecemaker/raisonnement.js', '.js');
    const linksPath = await resolveFile(root, input.liens, '.json');
    const output = await resolveFile(root, input.sortie, '.docx', true);
    const code = await readFile(modelPath, 'utf8');
    const prepared = await prepareDocxReasoning(bytes, code, JSON.parse(await readFile(linksPath, 'utf8')));
    await writeFile(output, prepared, { flag: 'wx' });
    return { fichier: path.relative(root, output), canonique: 'docx', modele_dossier_modifie: false, empreinte_modele: hash(code) };
  }
  const model = await readDocxReasoning(bytes);
  if (input.commande === 'extraire') {
    parseLiteral(model.code);
    const output = await resolveFile(root, input.sortie, '.js', true);
    await writeFile(output, model.code, { flag: 'wx' });
    return { fichier: path.relative(root, output), canonique: 'docx', empreinte_modele: hash(model.code) };
  }
  let source: string;
  try { source = await readFile(await resolveFile(root, input.modele ?? '.piecemaker/raisonnement.js', '.js'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { canonique: 'docx', etat: 'modele_dossier_absent', identique: false, empreinte_docx: hash(model.code) };
  }
  return { canonique: 'docx', etat: source === model.code ? 'identique' : 'divergent', identique: source === model.code, empreinte_docx: hash(model.code), empreinte_dossier: hash(source) };
}
