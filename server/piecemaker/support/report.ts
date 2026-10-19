import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express, { type Request, type Response } from 'express';

import {
  currentVibeCliHost,
  findVibeApiKey,
  piecemakerVibeBinDirectory,
  resolveVibeExecutable,
  vibeBinDirectoryCandidates,
  vibeEnvFilePath,
} from '@/shared/vibe-cli.js';

import { pythonCandidates, VIBE_PACKAGE, vibeInstallState } from '../vibe-install.js';

import { PREVIOUS_SUPPORT_LOG_FILE, SUPPORT_LOG_FILE } from './log.js';

const PROBE_TIMEOUT_MS = 10_000;
const MAX_CURRENT_LOG_BYTES = 10 * 1024 * 1024;
const PREVIOUS_LOG_LINES = 500;

export type SupportReportOptions = {
  logDirectory: string;
  version: string;
  anonymizerStatus: () => Record<string, unknown>;
  pseudonymize: (text: string) => string;
};

function probe(command: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' }, (error, stdout, stderr) => {
      const output = `${stdout}${stderr}`.trim().split(/\r?\n/).slice(-3).join(' | ');
      resolve(error ? `échec (${error.message.split(/\r?\n/)[0]})${output ? ` : ${output}` : ''}` : output || 'aucune sortie');
    });
  });
}

function exists(filePath: string): string {
  return fs.existsSync(filePath) ? 'présent' : 'absent';
}

async function mistralDiagnostic(): Promise<string[]> {
  const host = currentVibeCliHost();
  const windows = process.platform === 'win32';
  const executable = resolveVibeExecutable(host);
  const pinnedBin = piecemakerVibeBinDirectory(host);
  const install = vibeInstallState();
  const lines = ['Emplacements de Vibe examinés, dans l’ordre :'];
  for (const directory of vibeBinDirectoryCandidates(host)) {
    lines.push(`  ${directory} : vibe ${exists(path.join(directory, windows ? 'vibe.exe' : 'vibe'))}, python ${exists(path.join(directory, windows ? 'python.exe' : 'python'))}`);
  }
  lines.push(
    `Vibe utilisé par le chat : ${executable}`,
    `Vibe ${VIBE_PACKAGE} de PieceMaker utilisé : ${path.dirname(executable) === pinnedBin ? 'oui (affichage en direct)' : 'non (réponses sans affichage en direct)'}`,
    `vibe --version : ${await probe(executable, ['--version'])}`,
    `Clé API Mistral : ${findVibeApiKey(host) ?? 'introuvable'}`,
    `Fichier ${vibeEnvFilePath(host)} : ${exists(vibeEnvFilePath(host))}`,
    `Installation par PieceMaker : ${install.installing ? `en cours (${install.step ?? 'étape inconnue'})` : 'aucune en cours'}${install.error ? ` ; dernier échec : ${install.error}` : ''}`,
  );
  for (const python of pythonCandidates(host)) {
    lines.push(`${python} --version : ${await probe(python, ['--version'])}`);
  }
  return lines;
}

function readLogTail(filePath: string, maxBytes: number): string {
  try {
    const size = fs.statSync(filePath).size;
    const start = Math.max(0, size - maxBytes);
    const descriptor = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(size - start);
      fs.readSync(descriptor, buffer, 0, buffer.length, start);
      return `${start ? `[${start} octets plus anciens omis]\n` : ''}${buffer.toString('utf8')}`;
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    return '(aucun journal)';
  }
}

export function maskUserPaths(text: string, homedir = os.homedir(), username = os.userInfo().username): string {
  let masked = text;
  for (const variant of new Set([homedir, homedir.replace(/\\/g, '/'), homedir.replace(/\\/g, '\\\\')])) {
    if (variant.length > 1) masked = masked.split(variant).join('~');
  }
  if (username.length >= 3) {
    masked = masked.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'giu'), '$1<utilisateur>');
  }
  return masked;
}

export async function buildSupportReport(description: string, options: SupportReportOptions): Promise<string> {
  const anonymizer = options.anonymizerStatus();
  const previousLog = readLogTail(path.join(options.logDirectory, PREVIOUS_SUPPORT_LOG_FILE), 1024 * 1024)
    .split(/\r?\n/).slice(-PREVIOUS_LOG_LINES).join('\n');
  const sections = [
    'Rapport d’assistance PieceMaker',
    `Créé le ${new Date().toISOString()}`,
    '',
    '== Description du problème ==',
    description.trim() || '(aucune description)',
    '',
    '== Poste ==',
    `PieceMaker ${options.version}`,
    `${os.type()} ${os.release()} ${process.arch}, Node ${process.version}`,
    `Mémoire : ${(os.freemem() / 1e9).toFixed(1)} Go libres sur ${(os.totalmem() / 1e9).toFixed(1)} Go`,
    `Proxy d’anonymisation : ${anonymizer.enabled ? 'actif' : 'inactif'} (${String(anonymizer.reason ?? 'raison inconnue')}), écoute ${anonymizer.listening ? 'oui' : 'non'}`,
    '',
    '== Mistral ==',
    ...(await mistralDiagnostic()),
    '',
    `== Journal depuis la mise à jour (${SUPPORT_LOG_FILE}) ==`,
    readLogTail(path.join(options.logDirectory, SUPPORT_LOG_FILE), MAX_CURRENT_LOG_BYTES),
    '',
    `== ${PREVIOUS_LOG_LINES} dernières lignes de la version précédente ==`,
    previousLog,
  ];
  return options.pseudonymize(maskUserPaths(sections.join('\n')));
}

export function createSupportRouter(options: SupportReportOptions) {
  const router = express.Router();
  router.post('/support/report', express.json(), async (req: Request, res: Response) => {
    const description = typeof req.body?.description === 'string' ? req.body.description : '';
    try {
      const content = await buildSupportReport(description, options);
      const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
      res.json({ filename: `piecemaker-assistance-${stamp}.txt`, content });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  return router;
}
