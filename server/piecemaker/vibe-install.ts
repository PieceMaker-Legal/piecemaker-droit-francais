import fs from 'node:fs';
import path from 'node:path';

import crossSpawn from 'cross-spawn';
import express, { type Request, type Response } from 'express';

import {
  currentVibeCliHost,
  isVibeInstalled,
  piecemakerVibeBinDirectory,
  piecemakerVibeDirectory,
  type VibeCliHost,
} from '@/shared/vibe-cli.js';

export const VIBE_PACKAGE = 'mistral-vibe==3.0.2';

const SUPPORTED_PYTHON_MINORS = [12, 13];
const PROBE_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;

export type CommandResult = { code: number; output: string };

export type VibeInstallHost = {
  cli: VibeCliHost;
  run: (command: string, args: string[], timeoutMs: number) => Promise<CommandResult>;
  removeDirectory: (directory: string) => void;
};

function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = crossSpawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: timeoutMs,
      env: { ...process.env, PIP_DISABLE_PIP_VERSION_CHECK: '1', PYTHONUNBUFFERED: '1' },
    });
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => chunks.push(chunk));
    child.on('error', (error) => resolve({ code: 1, output: error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, output: Buffer.concat(chunks).toString('utf8') }));
  });
}

export function currentVibeInstallHost(): VibeInstallHost {
  return {
    cli: currentVibeCliHost(),
    run: runCommand,
    removeDirectory: (directory) => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

function pathApi(host: VibeCliHost) {
  return host.platform === 'win32' ? path.win32 : path.posix;
}

function configuredPython(host: VibeCliHost): string | null {
  try {
    const configFile = pathApi(host).join(pathApi(host).dirname(piecemakerVibeDirectory(host)), 'config.json');
    const { pythonPath } = JSON.parse(host.readFileSync(configFile, 'utf8')) as { pythonPath?: unknown };
    return typeof pythonPath === 'string' && pythonPath && host.existsSync(pythonPath) ? pythonPath : null;
  } catch {
    return null;
  }
}

export function pythonCandidates(host: VibeCliHost): string[] {
  const configured = configuredPython(host);
  const system = host.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
  return [...(configured ? [configured] : []), ...system];
}

export function pythonVersionIsSupported(output: string): boolean {
  const match = output.match(/Python 3\.(\d+)\b/);
  return Boolean(match && SUPPORTED_PYTHON_MINORS.includes(Number(match[1])));
}

async function findPython(host: VibeInstallHost): Promise<string | null> {
  for (const candidate of pythonCandidates(host.cli)) {
    const result = await host.run(candidate, ['--version'], PROBE_TIMEOUT_MS);
    if (result.code === 0 && pythonVersionIsSupported(result.output)) return candidate;
  }
  return null;
}

function failureDetail(result: CommandResult): string {
  const lines = result.output.trim().split(/\r?\n/).filter(Boolean);
  return lines.slice(-6).join('\n');
}

async function performInstall(host: VibeInstallHost): Promise<void> {
  let sharedPython: string | null = null;
  let sharedRuntime = false;
  try {
    const config = JSON.parse(host.cli.readFileSync(pathApi(host.cli).join(pathApi(host.cli).dirname(piecemakerVibeDirectory(host.cli)), 'config.json'), 'utf8'));
    sharedRuntime = config.pythonRuntime?.kind === 'shared';
    if (sharedRuntime && typeof config.pythonPath === 'string') sharedPython = config.pythonPath;
  } catch {}
  if (sharedRuntime) {
    if (!sharedPython) throw new Error('Environnement Python commun introuvable. Réinstallez les composants de cette version.');
    const result = await host.run(sharedPython, ['-c', `from importlib.metadata import version; assert version("mistral-vibe") == ${JSON.stringify(VIBE_PACKAGE.split('==')[1])}`], PROBE_TIMEOUT_MS);
    if (result.code !== 0 || !isVibeInstalled(host.cli)) throw new Error('Le composant Mistral de l’environnement Python commun est indisponible. Réinstallez le composant Python de cette version de PieceMaker.');
    return;
  }
  const python = await findPython(host);
  if (!python) {
    throw new Error('Python 3.12 ou 3.13 est introuvable sur ce poste : impossible d’installer Mistral Vibe.');
  }
  const directory = piecemakerVibeDirectory(host.cli);
  const executable = host.cli.platform === 'win32' ? 'python.exe' : 'python';
  const venvPython = pathApi(host.cli).join(piecemakerVibeBinDirectory(host.cli), executable);
  host.removeDirectory(directory);
  const steps: Array<[string, string[], string]> = [
    [python, ['-m', 'venv', directory], 'La création de l’environnement Python de Vibe a échoué'],
    [venvPython, ['-m', 'pip', 'install', '--only-binary=:all:', VIBE_PACKAGE], 'Le téléchargement de Mistral Vibe a échoué'],
  ];
  for (const [command, args, message] of steps) {
    const result = await host.run(command, args, INSTALL_TIMEOUT_MS);
    if (result.code !== 0) {
      host.removeDirectory(directory);
      throw new Error(`${message} :\n${failureDetail(result)}`);
    }
  }
  if (!isVibeInstalled(host.cli)) {
    host.removeDirectory(directory);
    throw new Error('Mistral Vibe a été téléchargé mais ne démarre pas.');
  }
}

let pendingInstall: Promise<void> | null = null;

export function installVibe(host: VibeInstallHost = currentVibeInstallHost()): Promise<void> {
  pendingInstall ??= performInstall(host).finally(() => {
    pendingInstall = null;
  });
  return pendingInstall;
}

export function createVibeInstallRouter(host: () => VibeInstallHost = currentVibeInstallHost) {
  const router = express.Router();
  router.get('/vibe', (_req: Request, res: Response) => {
    res.json({ installed: isVibeInstalled(host().cli), installing: pendingInstall !== null });
  });
  router.post('/vibe/install', async (_req: Request, res: Response) => {
    try {
      await installVibe(host());
      res.json({ installed: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
  return router;
}
