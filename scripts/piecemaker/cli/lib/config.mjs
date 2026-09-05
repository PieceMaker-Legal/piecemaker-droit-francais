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

export const INSTALLER = {
  key: 'installer',
  label: 'Socle PieceMaker Installer (proxy PII, MCP, GLiNER)',
  directory: process.env.PIECEMAKER_INSTALLER_DIR || path.join(home, 'PieceMaker'),
  remote: 'https://github.com/PieceMaker-Legal/PieceMaker-Installer.git',
  branch: 'main',
};

export const PORTS = {
  litellm: numberFromEnv('PIECEMAKER_LITELLM_PORT', 4000),
  admin: numberFromEnv('PIECEMAKER_ADMIN_PORT', 43098),
  appServer: numberFromEnv('PIECEMAKER_APP_PORT', 3003),
  appClient: numberFromEnv('PIECEMAKER_VITE_PORT', 5173),
};

export const APP_URL = `http://localhost:${PORTS.appClient}`;
export const ADMIN_URL = `https://localhost:${PORTS.admin}/admin/`;

export const MINIMUM_NODE_MAJOR = 20;
