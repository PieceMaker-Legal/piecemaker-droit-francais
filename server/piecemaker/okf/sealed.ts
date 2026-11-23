import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ClassificationFolder } from '../../../plugins/piecemaker-tabular-review/src/shared.js';
import { DEFAULT_CLASSIFICATION, REVIEW_FOLDER } from '../../../plugins/piecemaker-tabular-review/src/shared.js';

// ~/.piecemaker/ontologie.json, commun à tous les dossiers : l'arborescence, sous un sceau.

const home = (): string => process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker');
export const ontologyFile = (): string => path.join(home(), 'ontologie.json');
const keyFile = (): string => path.join(home(), 'ontologie.cle');

export function sealKey(create: boolean): Buffer | null {
  const filePath = keyFile();
  if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
  if (!create) return null;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  return fs.readFileSync(filePath);
}

export const sealOf = (key: Buffer, content: unknown): string => createHmac('sha256', key).update(JSON.stringify(content)).digest('hex');

/** Ce que couvre le sceau. Un fichier antérieur au catalogue des natures ne scellait que les relations. */
export function sealedContent(stored: Record<string, unknown>): unknown {
  if (stored.relations === undefined && stored.documentTypes === undefined) return stored.arborescence === undefined ? {} : { arborescence: stored.arborescence };
  if (stored.documentTypes === undefined) return stored.relations;
  return { relations: stored.relations, documentTypes: stored.documentTypes, ...(stored.arborescence === undefined ? {} : { arborescence: stored.arborescence }) };
}

function sealed(key: Buffer | null, content: unknown, seal: unknown): boolean {
  if (!key || typeof seal !== 'string') return false;
  const expected = Buffer.from(sealOf(key, content));
  const actual = Buffer.from(seal);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export type SealedRead = { stored: Record<string, unknown> | null; tampered: boolean };

/** Le fichier tel qu'il est enregistré (null sans fichier) et si son sceau ne correspond pas. */
export function readSealed(): SealedRead {
  const filePath = ontologyFile();
  if (!fs.existsSync(filePath)) return { stored: null, tampered: false };
  const stored = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '')) as Record<string, unknown>;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new TypeError('ontologie : donner un objet.');
  return { stored, tampered: !sealed(sealKey(false), sealedContent(stored), stored.sceau) };
}

const MAX_FOLDERS = 30;
const MAX_NAME = 200;
const MAX_EXPLANATION = 500;
const RESERVED = ['Non classé'];

function folderName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : '';
  const segments = name.split('/').map((segment) => segment.trim());
  const invalid = !name || name.length > MAX_NAME || segments[0] === REVIEW_FOLDER
    || segments.some((segment) => !segment || segment.startsWith('.') || /[:*?"<>|\u0000-\u001f]/.test(segment));
  if (invalid) throw new TypeError(`Nom de dossier invalide : ${String(value)}`);
  return segments.join('/');
}

export function normalizeArborescence(value: unknown): ClassificationFolder[] {
  if (!Array.isArray(value) || !value.length) throw new TypeError('L’arborescence contient au moins un dossier.');
  if (value.length > MAX_FOLDERS) throw new TypeError(`L’arborescence contient au plus ${MAX_FOLDERS} dossiers.`);
  const folders = value.map((entry) => {
    const input = (entry ?? {}) as Record<string, unknown>;
    const type = typeof input.type === 'string' ? input.type.trim().normalize('NFC') : '';
    if (type && (type.length > 60 || RESERVED.includes(type) || /[\/\\\u0000-\u001f]/.test(type))) throw new TypeError('Type principal invalide.');
    return { ...(type ? { type } : {}), name: folderName(input.name), explanation: typeof input.explanation === 'string' ? input.explanation.trim().slice(0, MAX_EXPLANATION) : '' };
  });
  if (new Set(folders.map((folder) => folder.name.toLowerCase())).size !== folders.length) throw new TypeError('Deux dossiers portent le même nom.');
  return folders;
}

/** L'arborescence commune : celle de l'ontologie scellée, sinon l'arborescence par défaut. */
export function readArborescence(): ClassificationFolder[] {
  try {
    const { stored, tampered } = readSealed();
    if (!tampered && stored?.arborescence !== undefined) return normalizeArborescence(stored.arborescence);
  } catch {}
  return DEFAULT_CLASSIFICATION;
}
