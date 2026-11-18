import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

/**
 * Plannotator (https://github.com/backnotprop/plannotator, MIT OR Apache-2.0) : surface locale
 * d'annotation des artifacts. Binaire de release épinglé, vérifié par SHA-256, installé dans
 * `~/.piecemaker/plannotator/<version>/`. Lancé sans télémétrie, sans partage en ligne, sans
 * vérification de mise à jour et sans Jina Reader : rien du dossier ne quitte la machine.
 */

export const PLANNOTATOR = {
  version: 'v0.29.0',
  repository: 'backnotprop/plannotator',
  license: 'MIT OR Apache-2.0',
  sha256: {
    'darwin-arm64': 'c383a5ff5338af20ced2c0090926e0ecd6a6019dcdd4112901bbb859e4186c06',
    'darwin-x64': '3d6da648a26887753fc959b547a7654fbe20200de5eb1aea93d839fee79173fa',
    'linux-x64': 'f2c575e7ae219472a45f53adb667ebb6eff13c2d89726d992d1f984a81161391',
    'linux-arm64': '54086386c8bd6335a133bcc3f9ed28ef4ba861cf072b70cef32d0e1d124829fb',
    'win32-x64': 'da1366fc3aa77910a2fff4c7be69bd81169b97b766801a353d5d5ec0bc27718a',
  },
};

/** Variables qui coupent tout appel sortant de Plannotator. */
export const PRIVATE_ENV = {
  DO_NOT_TRACK: '1',
  NO_ANON_PING: '1',
  PLANNOTATOR_SHARE: 'disabled',
  PLANNOTATOR_UPDATE_CHECK: '0',
};

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

export function platformKey(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null;
  const cpu = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null;
  const key = os && cpu ? `${os}-${cpu}` : null;
  return key && PLANNOTATOR.sha256[key] ? key : null;
}

export function assetName(key) {
  return key.startsWith('win32') ? `plannotator-${key}.exe` : `plannotator-${key}`;
}

export function openPlannotator({ home = path.join(os.homedir(), '.piecemaker'), fetchImpl = globalThis.fetch, spawnImpl = spawn, platform = process.platform, arch = process.arch, env = process.env } = {}) {
  const key = platformKey(platform, arch);
  const folder = path.join(home, 'plannotator', PLANNOTATOR.version);
  const binary = path.join(folder, platform === 'win32' ? 'plannotator.exe' : 'plannotator');

  function installed() {
    if (env.PIECEMAKER_PLANNOTATOR_BIN) return fs.existsSync(env.PIECEMAKER_PLANNOTATOR_BIN) ? env.PIECEMAKER_PLANNOTATOR_BIN : null;
    return fs.existsSync(binary) ? binary : null;
  }

  return {
    binary,
    status() {
      return { version: PLANNOTATOR.version, license: PLANNOTATOR.license, platform: key, installed: Boolean(installed()), binary: installed() ?? binary, private_env: PRIVATE_ENV };
    },

    /** Télécharge la release épinglée et vérifie son empreinte avant de la rendre exécutable. */
    async install() {
      if (installed()) return this.status();
      if (!key) fail('failed_precondition', `Plannotator ${PLANNOTATOR.version} has no build for ${platform}-${arch}.`);
      const url = `https://github.com/${PLANNOTATOR.repository}/releases/download/${PLANNOTATOR.version}/${assetName(key)}`;
      const response = await fetchImpl(url, { redirect: 'follow' });
      if (!response.ok) fail('unavailable', `download of ${url} failed (${response.status}).`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const digest = createHash('sha256').update(bytes).digest('hex');
      if (digest !== PLANNOTATOR.sha256[key]) fail('data_loss', `Plannotator checksum mismatch for ${assetName(key)}: expected ${PLANNOTATOR.sha256[key]}, got ${digest}. Nothing was installed.`);
      fs.mkdirSync(folder, { recursive: true });
      const temporary = `${binary}.${randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(temporary, bytes, { mode: 0o755 });
      fs.renameSync(temporary, binary);
      return this.status();
    },

    /**
     * Ouvre la revue d'un fichier dans le navigateur, sans attendre : la décision de l'avocat arrive
     * dans `resultFile` ({decision, feedback}), lue ensuite par `collect`.
     */
    start(file, resultFile, { cwd } = {}) {
      const bin = installed() ?? fail('failed_precondition', 'Plannotator is not installed: run ArtifactComments annotate with install=true, or install it from the Artifacts tab.');
      fs.mkdirSync(path.dirname(resultFile), { recursive: true });
      const args = ['annotate', file, '--gate', '--json', '--no-jina', '--result-file', resultFile, ...(file.endsWith('.html') ? ['--render-html'] : [])];
      const child = spawnImpl(bin, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true, env: { ...env, ...PRIVATE_ENV } });
      child.unref?.();
      return { pid: child.pid ?? null, args };
    },
  };
}
