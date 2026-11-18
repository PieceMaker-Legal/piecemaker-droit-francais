import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { getHermesHome, getHermesRoot } from '@/modules/providers/list/hermes/hermes-home.js';

const execute = promisify(execFile);

export const HERMES_PROFILE = 'piecemaker';
export const RAPPELS_JOB = 'piecemaker-rappels';
export const RAPPELS_SCRIPT = 'piecemaker-rappels.py';
const OWNED = '.piecemaker-owned';

type Run = (args: string[], env?: NodeJS.ProcessEnv) => Promise<{ stdout: string; stderr: string }>;

/** The Hermes command line, without the trailing `acp` of `HERMES_CLI_PATH`. */
export function hermesCommand(): string[] {
  const parts = (process.env.HERMES_CLI_PATH || 'hermes acp').trim().split(/\s+/);
  if (parts.at(-1) === 'acp') parts.pop();
  return parts;
}

export const runHermesCommand: Run = async (args, env = process.env) => {
  const [command, ...base] = hermesCommand();
  const { stdout, stderr } = await execute(command, [...base, ...args], { env, timeout: 120000, maxBuffer: 1024 * 1024 });
  return { stdout: String(stdout), stderr: String(stderr) };
};

/**
 * Points every Hermes call of this server at the dedicated « piecemaker »
 * profile. Kept as is when the user already chose a home with HERMES_HOME.
 * Returns true when the dedicated profile is used.
 */
export function selectPieceMakerHermesProfile(): boolean {
  if (process.env.HERMES_HOME) return process.env.PIECEMAKER_HERMES_PROFILE === HERMES_PROFILE;
  process.env.HERMES_HOME = path.join(getHermesRoot(), 'profiles', HERMES_PROFILE);
  process.env.PIECEMAKER_HERMES_PROFILE = HERMES_PROFILE;
  return true;
}

/**
 * Creates the dedicated profile once (a clone of the user's configuration:
 * models and credentials, without messaging channels), then keeps its memory
 * off. Hermes memory is shared by every session of a profile: a fact from one
 * dossier would come back in another. The user's own profile is never written.
 */
export async function preparePieceMakerHermesProfile(applicationRoot: string, run: Run = runHermesCommand): Promise<void> {
  const home = getHermesHome();
  const dedicated = process.env.PIECEMAKER_HERMES_PROFILE === HERMES_PROFILE;
  if (dedicated && !fs.existsSync(path.join(home, OWNED))) {
    if (fs.existsSync(path.join(home, 'config.yaml'))) {
      throw new Error(`Le profil Hermes « ${HERMES_PROFILE} » existe déjà et n’a pas été créé par PieceMaker.`);
    }
    const rootEnv = { ...process.env };
    delete rootEnv.HERMES_HOME;
    await run(['profile', 'create', HERMES_PROFILE, '--clone'], rootEnv)
      .catch(() => run(['profile', 'create', HERMES_PROFILE], rootEnv));
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(home, OWNED), '1\n', { mode: 0o600 });
  }
  if (dedicated) {
    // A clone copies the source memories: empty them in this profile only.
    for (const name of ['MEMORY.md', 'USER.md']) {
      const file = path.join(home, 'memories', name);
      if (fs.existsSync(file) && fs.statSync(file).size) fs.writeFileSync(file, '');
    }
    for (const key of ['memory.memory_enabled', 'memory.user_profile_enabled']) {
      await run(['config', 'set', key, 'false']);
    }
  }
  const scripts = path.join(home, 'scripts');
  fs.mkdirSync(scripts, { recursive: true, mode: 0o700 });
  const bytes = fs.readFileSync(path.join(applicationRoot, 'server/piecemaker/hermes/rappels.py'));
  const target = path.join(scripts, RAPPELS_SCRIPT);
  if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes)) fs.writeFileSync(target, bytes, { mode: 0o600 });
}

export type RappelsStatus = { actif: boolean; heure: string | null; destination: string | null };

type CronJob = { id?: string; name?: string; schedule?: unknown; deliver?: unknown };

const rappelsJobs = (): CronJob[] => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(getHermesHome(), 'cron/jobs.json'), 'utf8')) as { jobs?: CronJob[] };
    return (data.jobs ?? []).filter((job) => job.name === RAPPELS_JOB && job.id);
  } catch {
    return [];
  }
};

const scheduleText = (schedule: unknown): string => {
  if (typeof schedule === 'string') return schedule;
  const record = schedule as Record<string, unknown> | null;
  return String(record?.expr ?? record?.expression ?? record?.cron ?? record?.display ?? '');
};

export function readRappels(): RappelsStatus {
  const job = rappelsJobs()[0];
  if (!job) return { actif: false, heure: null, destination: null };
  const [minute, hour] = scheduleText(job.schedule).trim().split(/\s+/);
  const heure = /^\d+$/.test(hour ?? '') && /^\d+$/.test(minute ?? '') ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` : null;
  return { actif: true, heure, destination: typeof job.deliver === 'string' ? job.deliver : null };
}

/**
 * Daily reminder of the deadlines of every dossier, sent by Hermes to the
 * phone. The job runs the script without a model (`--no-agent`); an empty
 * output sends nothing. Hermes runs it while its gateway is running.
 */
export async function writeRappels(input: { actif: boolean; heure?: string; destination?: string }, run: Run = runHermesCommand): Promise<RappelsStatus> {
  const heure = input.heure ?? '08:00';
  const destination = input.destination ?? 'telegram';
  if (input.actif) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(heure)) throw new TypeError('heure : HH:MM attendue.');
    if (!/^[a-z][a-z_-]*(:[\w@.+-]+)?$/.test(destination)) throw new TypeError('destination : plateforme Hermes, par exemple telegram.');
  }
  for (const job of rappelsJobs()) await run(['cron', 'remove', String(job.id)]);
  if (input.actif) {
    const [hour, minute] = heure.split(':').map(Number);
    await run(['cron', 'create', `${minute} ${hour} * * *`, '--name', RAPPELS_JOB, '--no-agent',
      '--script', RAPPELS_SCRIPT, '--deliver', destination, '--failure-deliver', 'local']);
  }
  return readRappels();
}
