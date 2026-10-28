import { randomUUID } from 'node:crypto';
import { rename, rm, stat, writeFile } from 'node:fs/promises';

import JSZip from 'jszip';

export async function readDocxDocumentVersion(filePath: string): Promise<number> {
  return (await stat(filePath)).mtimeMs;
}

async function normalizeFontThemes(buffer: Buffer): Promise<Buffer> {
  const archive = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const part of archive.file(/^word\/.*\.xml$/)) {
    const original = await part.async('string');
    const normalized = original.replace(/<w:rFonts\b[^>]*>/g, tag => tag.replace(/\bw:csTheme=/g, 'w:cstheme='));
    if (normalized === original) continue;
    archive.file(part.name, normalized);
    changed = true;
  }
  return changed ? archive.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) : buffer;
}

export class DocxDocumentConflictError extends Error {}

const pendingWrites = new Map<string, Promise<number>>();

export function saveDocxDocument(filePath: string, buffer: Buffer, expectedVersion?: number): Promise<number> {
  const previous = pendingWrites.get(filePath) ?? Promise.resolve();
  const operation: Promise<number> = previous.catch(() => {}).then(() => writeDocxDocument(filePath, buffer, expectedVersion)).finally(() => {
    if (pendingWrites.get(filePath) === operation) pendingWrites.delete(filePath);
  });
  pendingWrites.set(filePath, operation);
  return operation;
}

async function writeDocxDocument(filePath: string, buffer: Buffer, expectedVersion?: number): Promise<number> {
  const normalized = await normalizeFontThemes(buffer);
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, normalized);
    if (expectedVersion !== undefined && await readDocxDocumentVersion(filePath) !== expectedVersion) {
      throw new DocxDocumentConflictError('Le document a été modifié ailleurs. Vos modifications sont conservées dans l’éditeur.');
    }
    await rename(temporaryPath, filePath);
    return await readDocxDocumentVersion(filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
