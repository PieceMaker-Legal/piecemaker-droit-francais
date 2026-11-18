import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import type { Source } from '../shared.js';
import { PlaybookError } from '../domain/model.js';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_TEXT = 180000;

export function safePath(project: string, relative: string, exists = true): string {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => !part || part === '..' || part.startsWith('.'))) {
    throw new PlaybookError('Chemin de document invalide.');
  }
  let current = project;
  for (const part of relative.split(/[\\/]/)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new PlaybookError('Les liens symboliques ne sont pas autorisés.');
  }
  const rel = path.relative(project, current);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new PlaybookError('Document hors du dossier.');
  if (exists && (!fs.existsSync(current) || !fs.statSync(current).isFile())) throw new PlaybookError('Document introuvable.', 404);
  return current;
}

export function listDocuments(project: string): string[] {
  const queue = [{ directory: project, depth: 0 }];
  const result: string[] = [];
  while (queue.length && result.length < 5000) {
    const { directory, depth } = queue.shift()!;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name.startsWith('~$') || ['node_modules', 'Playbooks', 'Revues contractuelles', 'Tabular Review'].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory() && depth < 12) queue.push({ directory: file, depth: depth + 1 });
      if (entry.isFile() && /\.(docx|md|txt|pdf)$/i.test(entry.name)) result.push(path.relative(project, file).split(path.sep).join('/'));
    }
  }
  return result.sort((a, b) => a.localeCompare(b, 'fr'));
}

function localName(node: Node): string { return node.nodeName.split(':').at(-1) ?? ''; }

function children(node: Node): Node[] { return Array.from(node.childNodes); }

function wordText(node: Node): string {
  const name = localName(node);
  if (name === 'del' || name === 'moveFrom') return '';
  if (name === 't') return node.textContent ?? '';
  if (name === 'tab') return '\t';
  if (name === 'br' || name === 'cr') return '\n';
  return children(node).map(wordText).join('');
}

async function documentXml(bytes: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(bytes).catch(() => { throw new PlaybookError('Le fichier Word est illisible ou invalide.'); });
  const entry = zip.file('word/document.xml');
  if (!entry) throw new PlaybookError('Ce fichier n’est pas un document Word valide.');
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts: Buffer[] = [];
    const stream = entry.nodeStream() as Readable;
    stream.on('data', (part: Buffer) => {
      size += part.length;
      if (size > 8 * 1024 * 1024) stream.destroy(new PlaybookError('Le contenu Word dépasse la limite de lecture.'));
      else parts.push(part);
    });
    stream.once('error', reject);
    stream.once('end', () => resolve(Buffer.concat(parts).toString('utf8')));
  });
}

export async function readDocx(bytes: Buffer): Promise<Source[]> {
  const xml = await documentXml(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new PlaybookError('Déclarations XML non autorisées.');
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const body = doc.getElementsByTagName('w:body')[0];
  if (!body) throw new PlaybookError('Corps du document Word absent.');
  const sources: Source[] = [];
  let table = 0;
  for (const node of children(body as unknown as Node)) {
    if (localName(node) === 'p') {
      const text = wordText(node).trim();
      if (text) sources.push({ id: `P${sources.length + 1}`, text, location: `Paragraphe ${sources.length + 1}` });
    }
    if (localName(node) === 'tbl') {
      table += 1;
      children(node).filter((child) => localName(child) === 'tr').forEach((row, ri) => {
        children(row).filter((child) => localName(child) === 'tc').forEach((cell, ci) => {
          const text = children(cell).map(wordText).join('\n').trim();
          if (text) sources.push({ id: `T${table}R${ri + 1}C${ci + 1}`, text, location: `Tableau ${table}, ligne ${ri + 1}, cellule ${ci + 1}` });
        });
      });
    }
  }
  return sources;
}

export async function readDocument(project: string, relative: string): Promise<{ bytes: Buffer; sources: Source[]; text: string; type: string }> {
  let file = safePath(project, relative);
  const type = path.extname(file).toLowerCase();
  if (!['.docx', '.md', '.txt', '.pdf'].includes(type)) throw new PlaybookError('Utilisez un document Word, Markdown, texte ou un PDF déjà converti.');
  if (type === '.pdf') {
    const markdown = relative.replace(/\.pdf$/i, '.md');
    try { file = safePath(project, markdown); }
    catch { throw new PlaybookError('Convertissez d’abord ce PDF avec PieceMaker. Son Markdown doit se trouver à côté du PDF.'); }
  }
  if (fs.statSync(file).size > MAX_FILE_BYTES) throw new PlaybookError('Le document dépasse 25 Mo.');
  const bytes = fs.readFileSync(file);
  const sources = type === '.docx' ? await readDocx(bytes) : bytes.toString('utf8').split(/\n\s*\n/)
    .map((text) => text.trim()).filter(Boolean).map((text, index) => ({ id: `P${index + 1}`, text, location: `Bloc ${index + 1}` }));
  const text = sources.map((source) => source.text).join('\n\n');
  if (!text.trim()) throw new PlaybookError('Document sans texte exploitable. Convertissez les scans avec PieceMaker avant la revue.');
  if (text.length > MAX_TEXT) throw new PlaybookError('Le document dépasse 180 000 caractères. Réduisez le périmètre de la revue.');
  return { bytes, sources, text, type };
}
