import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IS_MAC, IS_WINDOWS, PRODUCT_NAME, bootstrapHome } from './paths.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ESTIMATED_STEPS = 14;

let state = null;
let stateFile = '';

function progressDir() {
  return process.env.PIECEMAKER_BOOTSTRAP_HOME || bootstrapHome;
}

export function progressStatusPath() {
  return path.join(progressDir(), 'progress.json');
}

function progressPidPath() {
  return path.join(progressDir(), 'progress.pid');
}

export function progressWindowEnabled() {
  if (process.env.PIECEMAKER_NO_PROGRESS === '1') return false;
  if (process.env.CI === 'true' || process.env.CI === '1') return false;
  return true;
}

function writeStatus() {
  if (!state) return;
  const file = progressStatusPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = `${JSON.stringify(state)}\n`;
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, payload, 'utf8');
  try {
    fs.renameSync(temporary, file);
  } catch {
    fs.writeFileSync(file, payload, 'utf8');
    fs.rmSync(temporary, { force: true });
  }
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function windowStillRunning() {
  try {
    const pid = Number.parseInt(fs.readFileSync(progressPidPath(), 'utf8'), 10);
    return processAlive(pid);
  } catch {
    return false;
  }
}

function rememberPid(pid) {
  if (!pid) return;
  fs.writeFileSync(progressPidPath(), `${pid}\n`, 'utf8');
}

function attachLauncher(child) {
  child.on('error', (error) => {
    process.stderr.write(`Fenêtre de progression indisponible (${error.message}).\n`);
  });
  child.unref();
  rememberPid(child.pid);
}

function launchDarwin(statusPath) {
  const script = path.join(here, 'progress-darwin.py');
  attachLauncher(spawn('/usr/bin/python3', [script, statusPath, String(process.pid)], {
    detached: true,
    stdio: 'ignore',
  }));
}

function launchWindows(statusPath) {
  const source = path.join(here, 'progress-win32.ps1');
  const copy = path.join(progressDir(), 'progress.ps1');
  fs.writeFileSync(copy, `\ufeff${fs.readFileSync(source, 'utf8')}`, 'utf8');
  attachLauncher(spawn('powershell.exe', [
    '-NoProfile',
    '-STA',
    '-ExecutionPolicy', 'Bypass',
    '-File', copy,
    '-StatusPath', statusPath,
    '-ParentPid', String(process.pid),
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }));
}

function launchWindow() {
  if (!progressWindowEnabled() || windowStillRunning()) return;
  const statusPath = progressStatusPath();
  try {
    if (IS_MAC) launchDarwin(statusPath);
    else if (IS_WINDOWS) launchWindows(statusPath);
  } catch (error) {
    process.stderr.write(`Fenêtre de progression indisponible (${error.message}).\n`);
  }
}

function readExistingStatus() {
  try {
    const existing = JSON.parse(fs.readFileSync(progressStatusPath(), 'utf8'));
    if (existing?.state === 'running') return existing;
  } catch {
    return null;
  }
  return null;
}

export function openProgressWindow({ version } = {}) {
  const file = progressStatusPath();
  if (state && stateFile === file) {
    if (version) state.version = version;
    state.pid = process.pid;
    writeStatus();
    launchWindow();
    return;
  }
  stateFile = file;
  const existing = readExistingStatus();
  state = {
    title: `Installation de ${PRODUCT_NAME}`,
    version: version || existing?.version || '',
    step: existing?.step || 'Démarrage…',
    detail: existing?.detail || '',
    current: Number(existing?.current) || 0,
    total: Number(existing?.total) || ESTIMATED_STEPS,
    state: 'running',
    error: '',
    pid: process.pid,
  };
  writeStatus();
  launchWindow();
}

export function noteProgress({ step, detail, increment } = {}) {
  if (!state || state.state !== 'running') return;
  if (increment) {
    state.current += 1;
    if (state.current >= state.total) state.total = state.current + 1;
    state.detail = '';
  }
  if (step) state.step = step;
  if (detail !== undefined) state.detail = detail;
  writeStatus();
}

export function finishProgress({ ok, message, error } = {}) {
  if (!state) return;
  state.current = state.total;
  state.pid = process.pid;
  if (ok) {
    state.state = 'done';
    state.step = message || `${PRODUCT_NAME} est installé.`;
    state.detail = '';
    state.error = '';
  } else {
    state.state = 'failed';
    state.step = 'Installation interrompue';
    state.error = error || "L'installation a échoué.";
    state.detail = state.error;
  }
  writeStatus();
  state = null;
  stateFile = '';
}
