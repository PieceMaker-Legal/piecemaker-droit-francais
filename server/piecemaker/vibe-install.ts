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

export const VIBE_PACKAGE = 'mistral-vibe==2.25.0';

const SUPPORTED_PYTHON_MINORS = [12, 13];
const PROBE_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 15 * 60_000;

export type CommandResult = { code: number; output: string };

export type VibeInstallHost = {
  cli: VibeCliHost;
  run: (command: string, args: string[], timeoutMs: number) => Promise<CommandResult>;
  removeDirectory: (directory: string) => void;
};

export function installEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...env, PIP_DISABLE_PIP_VERSION_CHECK: '1', PYTHONUNBUFFERED: '1' };
  for (const key of Object.keys(result)) {
    if (/^https?_proxy$/i.test(key) && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/i.test(result[key] ?? '')) delete result[key];
  }
  return result;
}

function killTree(child: ReturnType<typeof crossSpawn>): void {
  if (process.platform === 'win32' && child.pid) {
    crossSpawn.sync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  child.kill('SIGKILL');
}

export function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = crossSpawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: installEnvironment(process.env),
    });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      killTree(child);
      finish({ code: 1, output: `${Buffer.concat(chunks).toString('utf8')}\nDélai dépassé (${Math.round(timeoutMs / 1000)} s) : ${command} ${args.join(' ')}` });
    }, timeoutMs);
    const take = (chunk: Buffer) => {
      chunks.push(chunk);
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        if (line.trim()) console.log(`[Vibe install] ${line.trim()}`);
      }
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    child.on('error', (error) => finish({ code: 1, output: error.message }));
    child.on('close', (code) => finish({ code: code ?? 1, output: Buffer.concat(chunks).toString('utf8') }));
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

let installStep: string | null = null;
let lastInstallError: string | null = null;

async function performInstall(host: VibeInstallHost): Promise<void> {
  installStep = 'Recherche de Python 3.12 ou 3.13';
  const python = await findPython(host);
  if (!python) {
    throw new Error('Python 3.12 ou 3.13 est introuvable sur ce poste : impossible d’installer Mistral Vibe.');
  }
  const directory = piecemakerVibeDirectory(host.cli);
  const executable = host.cli.platform === 'win32' ? 'python.exe' : 'python';
  const venvPython = pathApi(host.cli).join(piecemakerVibeBinDirectory(host.cli), executable);
  host.removeDirectory(directory);
  const steps: Array<[string, string[], string, string]> = [
    [python, ['-m', 'venv', directory], 'La création de l’environnement Python de Vibe a échoué', `Création de l’environnement Python (${python})`],
    [venvPython, ['-m', 'pip', 'install', '--only-binary=:all:', VIBE_PACKAGE], 'Le téléchargement de Mistral Vibe a échoué', `Téléchargement de ${VIBE_PACKAGE}`],
  ];
  for (const [command, args, message, step] of steps) {
    installStep = step;
    console.log(`[Vibe install] ${step}`);
    const result = await host.run(command, args, INSTALL_TIMEOUT_MS);
    if (result.code !== 0) {
      host.removeDirectory(directory);
      throw new Error(`${message} :\n${failureDetail(result)}`);
    }
  }
  installStep = 'Vérification du démarrage de Vibe';
  if (!isVibeInstalled(host.cli)) {
    host.removeDirectory(directory);
    throw new Error('Mistral Vibe a été téléchargé mais ne démarre pas.');
  }
}

let pendingInstall: Promise<void> | null = null;

export function installVibe(host: VibeInstallHost = currentVibeInstallHost()): Promise<void> {
  if (!pendingInstall) lastInstallError = null;
  pendingInstall ??= performInstall(host).catch((error: unknown) => {
    lastInstallError = error instanceof Error ? error.message : String(error);
    console.error(`[Vibe install] ${lastInstallError}`);
    throw error;
  }).finally(() => {
    pendingInstall = null;
    installStep = null;
  });
  return pendingInstall;
}

export function vibeInstallState(): { installing: boolean; step: string | null; error: string | null } {
  return { installing: pendingInstall !== null, step: installStep, error: lastInstallError };
}

export function createVibeInstallRouter(host: () => VibeInstallHost = currentVibeInstallHost) {
  const router = express.Router();
  router.get('/vibe', (_req: Request, res: Response) => {
    res.json({ installed: isVibeInstalled(host().cli), installing: pendingInstall !== null, step: installStep, error: lastInstallError });
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
