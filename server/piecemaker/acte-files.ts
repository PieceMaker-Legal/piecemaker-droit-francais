import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ReasoningSnapshot } from '../../shared/piecemaker-reasoning.js';
import { describeReasoning, parseReasoningDocument, printReasoningDocument, resolveReasoningFile, stripAnnotations } from '../modules/piecemaker-reasoning/index.js';

import { exportActeDocx, readActeDocx, rebaseActeDocx } from './acte-docx.js';
import { alreadyMerged, flatOf, flattenActe, mergeActe, rebuildActe } from './acte-merge.js';

type ActeAction = { commande: string; cwd: string; fichier?: string; sortie?: string; modele?: string; raisonnement?: string };
type Verified = Pick<ReasoningSnapshot, 'issues' | 'code'> & { dismissed?: ReasoningSnapshot['dismissed'] };
type Raw = Record<string, unknown>;

const inside = (root: string, file: string) => file.startsWith(root + path.sep);
const exists = (file: string) => stat(file).then(() => true, () => false);

async function resolveDocx(root: string, file: unknown, output = false) {
  if (typeof file !== 'string' || !file || !file.toLowerCase().endsWith('.docx')) throw new TypeError('Un chemin .docx est requis.');
  const resolved = path.resolve(root, file);
  if (!inside(root, resolved)) throw new TypeError('Chemin refusé hors du dossier.');
  const actual = output && !(await exists(resolved)) ? path.join(await realpath(path.dirname(resolved)), path.basename(resolved)) : await realpath(resolved);
  if (!inside(root, actual) || !actual.toLowerCase().endsWith('.docx')) throw new TypeError('Lien symbolique hors du dossier.');
  return actual;
}

async function readModel(file: string): Promise<Raw | null> {
  const code = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
  if (code === null) return null;
  const value = stripAnnotations(parseReasoningDocument(code).value);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new TypeError('Le raisonnement n’est pas un objet : lance d’abord pm raisonnement verifier.');
  return value as Raw;
}

const writeModel = async (file: string, value: Raw) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${printReasoningDocument(value)}\n`, 'utf8');
};
const count = (acte: unknown) => flattenActe(acte).reduce((total, entry) => ({ sections: total.sections + 1, paragraphes: total.paragraphes + flatOf(entry).texte.length }), { sections: 0, paragraphes: 0 });

export async function runActeAction(input: ActeAction, check: (cwd: string, name: string) => Promise<Verified>) {
  if (!['exporter', 'fusionner', 'importer'].includes(input?.commande) || typeof input.cwd !== 'string') throw new TypeError('Commande attendue : exporter, fusionner ou importer.');
  if (input.raisonnement !== undefined && typeof input.raisonnement !== 'string') throw new TypeError('raisonnement : nom du fichier, sans .yaml.');
  const root = await realpath(input.cwd);
  const found = await resolveReasoningFile(root, input.raisonnement);
  if (!found) throw new TypeError(input.commande === 'importer' ? 'Aucun raisonnement : indique --raisonnement <nom> pour créer .piecemaker/raisonnements/<nom>.yaml.' : 'Aucun raisonnement : écris .piecemaker/raisonnements/<nom>.yaml.');
  const verify = (cwd: string) => check(cwd, found.name);

  if (input.commande === 'exporter') {
    if (!(await readModel(found.file))) throw new TypeError(`Aucun raisonnement : écris .piecemaker/raisonnements/${found.name}.yaml.`);
    const verified = await verify(root);
    const model = (await readModel(found.file))!;
    const entries = flattenActe(model.acte);
    if (!entries.length) throw new TypeError('Le raisonnement ne contient pas d’acte : ajoute acte: [sections].');
    const blocking = verified.issues.filter((issue) => issue.kind === 'erreur' && issue.path.startsWith('acte'));
    if (blocking.length) throw new TypeError(`L’acte n’est pas imprimable tant que ces erreurs demeurent :\n${blocking.map((issue) => `- ${issue.path} : ${issue.text}`).join('\n')}`);
    const output = await resolveDocx(root, input.sortie, true);
    const sections = entries.map(flatOf);
    let template: Uint8Array | undefined;
    let layout = 'par défaut';
    if (await exists(output)) {
      const current = await readFile(output);
      const read = await readActeDocx(current, 'fusion');
      if (!read.base) throw new TypeError(`${path.relative(root, output)} existe et n’a pas été produit depuis l’acte : choisis une autre --sortie.`);
      if (!alreadyMerged(sections, read.base, read.sections)) throw new TypeError(`${path.relative(root, output)} contient des retouches qui ne sont pas encore dans le raisonnement : lance d’abord pm acte fusionner --fichier ${path.relative(root, output)}.`);
      template = current;
      layout = 'celle du DOCX remplacé';
    } else if (input.modele) {
      template = await readFile(await resolveDocx(root, input.modele));
      layout = `celle de ${input.modele}`;
    }
    await writeFile(output, await exportActeDocx(sections, template));
    return { fichier: path.relative(root, output), ...count(model.acte), mise_en_page: layout, manques: verified.issues.filter((issue) => issue.kind === 'manque' && issue.path.startsWith('acte')).length };
  }

  const file = await resolveDocx(root, input.fichier);
  const bytes = await readFile(file);

  if (input.commande === 'fusionner') {
    const read = await readActeDocx(bytes, 'fusion');
    if (!read.base) throw new TypeError('Ce DOCX n’a pas été produit depuis l’acte : pour reprendre un acte existant, utilise pm acte importer.');
    const model = await readModel(found.file);
    if (!model) throw new TypeError(`Aucun raisonnement : .piecemaker/raisonnements/${found.name}.yaml est introuvable.`);
    const merged = await mergeActe(model.acte, read.base, read.sections);
    model.acte = merged.acte;
    await writeModel(found.file, model);
    await writeFile(file, await rebaseActeDocx(bytes, read.sections));
    const verified = await verify(root);
    return { rapport: merged.rapport, remarques: read.remarques, verification: describeReasoning(verified) };
  }

  const read = await readActeDocx(bytes, 'import');
  if ((await readActeDocx(bytes, 'fusion').catch(() => null))?.base) throw new TypeError('Ce DOCX a été produit depuis l’acte : utilise pm acte fusionner.');
  if (!read.sections.length) throw new TypeError('Aucun texte lisible dans ce DOCX.');
  const model = await readModel(found.file) ?? {};
  if (Array.isArray(model.acte) && model.acte.length) throw new TypeError('Le raisonnement contient déjà un acte : retire acte pour en importer un autre, ou fusionne le DOCX qui en est issu.');
  model.acte = rebuildActe(read.sections.map((section) => ({ raw: { ...(section.intitule ? { intitule: section.intitule } : {}), ...(section.texte.length ? { texte: section.texte } : {}) }, depth: section.depth })));
  await writeModel(found.file, model);
  const verified = await verify(root);
  return { ...count(model.acte), remarques: read.remarques, verification: describeReasoning(verified) };
}
