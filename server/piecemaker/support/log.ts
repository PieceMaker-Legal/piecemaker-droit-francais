import fs from 'node:fs';
import path from 'node:path';
import { format } from 'node:util';

export const SUPPORT_LOG_FILE = 'piecemaker.log';
export const PREVIOUS_SUPPORT_LOG_FILE = 'piecemaker-version-precedente.log';
const VERSION_FILE = 'version-journal.txt';
const MAX_LOG_BYTES = 50 * 1024 * 1024;
const LEVELS = ['log', 'info', 'warn', 'error'] as const;

let installed = false;

function readVersion(directory: string): string | null {
  try {
    return fs.readFileSync(path.join(directory, VERSION_FILE), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function startNewLogIfNeeded(directory: string, version: string): void {
  const current = path.join(directory, SUPPORT_LOG_FILE);
  const size = fs.existsSync(current) ? fs.statSync(current).size : 0;
  if (size && (readVersion(directory) !== version || size > MAX_LOG_BYTES)) {
    fs.renameSync(current, path.join(directory, PREVIOUS_SUPPORT_LOG_FILE));
  }
  fs.writeFileSync(path.join(directory, VERSION_FILE), version);
}

export function startSupportLog(directory: string, version: string): void {
  if (installed) return;
  installed = true;
  fs.mkdirSync(directory, { recursive: true });
  startNewLogIfNeeded(directory, version);
  const file = path.join(directory, SUPPORT_LOG_FILE);
  let written = fs.existsSync(file) ? fs.statSync(file).size : 0;
  const append = (level: string, args: unknown[]) => {
    if (written > MAX_LOG_BYTES) return;
    const line = `${new Date().toISOString()} [${level}] ${format(...args).replace(/\x1b\[[0-9;]*m/g, '')}\n`;
    written += Buffer.byteLength(line);
    try {
      fs.appendFileSync(file, written > MAX_LOG_BYTES ? `${new Date().toISOString()} [warn] Journal plein, écriture suspendue jusqu’au prochain démarrage.\n` : line);
    } catch {
      written = MAX_LOG_BYTES + 1;
    }
  };
  append('info', [`Démarrage de PieceMaker ${version} (${process.platform} ${process.arch}, Node ${process.version})`]);
  for (const level of LEVELS) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      original(...args);
      append(level, args);
    };
  }
  process.on('uncaughtExceptionMonitor', (error) => append('fatal', [error]));
}
