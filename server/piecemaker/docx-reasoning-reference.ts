import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';

export type DocxModelReference = { path: string; sha256: string };
export const modelHash = (code: string) => createHash('sha256').update(code).digest('hex');

export function validateModelReference(value: unknown): asserts value is DocxModelReference {
  if (!value || typeof value !== 'object' || !('path' in value) || typeof value.path !== 'string' || !value.path || !('sha256' in value) || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sha256)) throw new TypeError('Référence de modèle invalide.');
  const file = value.path;
  if (path.posix.isAbsolute(file) || path.win32.isAbsolute(file) || file.includes('\\') || file.split('/').some((part) => !part || part === '.' || part === '..' || /^\.env(?:\.|$)/iu.test(part)) || !file.endsWith('.js')) throw new TypeError('Chemin de modèle relatif au dossier requis.');
}

export async function readReferencedModel(cwd: string, reference: DocxModelReference) {
  validateModelReference(reference);
  if (!cwd) throw new TypeError('Le dossier PieceMaker est requis pour retrouver le modèle externe.');
  const root = await realpath(cwd);
  const file = await realpath(path.resolve(root, reference.path));
  if (!file.startsWith(root + path.sep) || !file.endsWith('.js') || path.relative(root, file).split(path.sep).some((part) => /^\.env(?:\.|$)/iu.test(part))) throw new TypeError('Le modèle externe doit rester dans le dossier PieceMaker.');
  const handle = await open(file, 'r');
  try {
    if (!(await handle.stat()).isFile()) throw new TypeError('Le modèle externe doit être un fichier.');
    const code = await handle.readFile('utf8');
    return { code, sha256: modelHash(code) };
  } finally { await handle.close(); }
}

export async function resolveReferencedModel(cwd: string, reference: DocxModelReference) {
  let source;
  try { source = await readReferencedModel(cwd, reference); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new TypeError('Modèle externe absent : restaurer le fichier référencé dans le dossier.');
    throw error;
  }
  if (source.sha256 !== reference.sha256) throw new TypeError('Modèle externe modifié : la version liée au document doit être réexaminée.');
  return source.code;
}
