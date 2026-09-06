import os from 'node:os';
import path from 'node:path';

const home = os.homedir();

const numberFromEnv = (name, fallback) => {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const PIECEMAKER_HOME = process.env.PIECEMAKER_HOME || path.join(home, '.piecemaker');
export const LOG_DIR = path.join(PIECEMAKER_HOME, 'logs');
export const BIN_DIR = path.join(PIECEMAKER_HOME, 'bin');

export const APP = {
  key: 'app',
  label: 'Application PieceMaker (droit français)',
  directory: process.env.PIECEMAKER_APP_DIR || path.join(home, 'Documents', 'GitHub', 'piecemaker-droit-francais'),
  remote: 'https://github.com/PieceMaker-Legal/piecemaker-droit-francais.git',
  branch: 'main',
};

export const INSTALLER_ENTRY = path.join(APP.directory, 'server', 'piecemaker', 'vendor', 'installer', 'bin', 'piecemaker.mjs');

export const PORTS = {
  appServer: numberFromEnv('PIECEMAKER_APP_PORT', 3003),
  appClient: numberFromEnv('PIECEMAKER_VITE_PORT', 5173),
};

export const APP_URL = `http://localhost:${PORTS.appClient}`;

export const MINIMUM_NODE_MAJOR = 20;
