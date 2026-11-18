import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { providerRuntimeService } from '@/modules/providers/index.js';

const execute = promisify(execFile);

export function installHermesPieceMaker(runtime: Pick<typeof providerRuntimeService, 'run'>, applicationRoot: string) {
  const run = runtime.run.bind(runtime);
  let installation: Promise<void> | undefined;
  const projects = new Set<string>();
  const source = path.join(applicationRoot, 'server/piecemaker/hermes/plugin');
  const home = process.env.HERMES_HOME || (process.env.HERMES_PROFILE
    ? path.join(os.homedir(), '.hermes/profiles', process.env.HERMES_PROFILE)
    : path.join(os.homedir(), '.hermes'));
  const plugin = path.join(home, 'plugins/piecemaker');
  const instanceHome = process.env.CLOUDCLI_HOME || process.env.PIECEMAKER_HOME;
  const instance = createHash('sha256').update(instanceHome || applicationRoot).digest('hex').slice(0, 16);

  const prepare = async () => {
    if (fs.existsSync(plugin) && fs.readdirSync(plugin).length && !fs.existsSync(path.join(plugin, '.piecemaker-owned'))) {
      throw new Error('Le plugin Hermes piecemaker existe déjà et appartient à une autre installation.');
    }
    fs.mkdirSync(plugin, { recursive: true, mode: 0o700 });
    for (const name of ['plugin.yaml', '__init__.py', 'piecemaker.py', 'bridge.mjs']) {
      const target = path.join(plugin, name);
      const bytes = fs.readFileSync(path.join(source, name));
      if (fs.existsSync(target) && fs.readFileSync(target).equals(bytes)) continue;
      if (fs.existsSync(target) && !fs.existsSync(path.join(plugin, '.piecemaker-owned'))) {
        throw new Error('Le plugin Hermes piecemaker existe déjà et appartient à une autre installation.');
      }
      fs.writeFileSync(`${target}.${process.pid}.tmp`, bytes, { mode: 0o600 });
      fs.renameSync(`${target}.${process.pid}.tmp`, target);
    }
    fs.writeFileSync(path.join(plugin, '.piecemaker-owned'), '1\n', { mode: 0o600 });
    fs.cpSync(path.join(applicationRoot, 'server/piecemaker/vendor/skills/Skill-PieceMaker'), path.join(plugin, 'skills/piecemaker'), { recursive: true });
    const [command, ...args] = (process.env.HERMES_CLI_PATH || 'hermes acp').trim().split(/\s+/);
    if (args.at(-1) === 'acp') args.pop();
    const result = await execute(command, [...args, 'plugins', 'enable', 'piecemaker'], { timeout: 60000, maxBuffer: 1024 * 1024 });
    if (/restart the gateway/i.test(result.stdout)) throw new Error('Hermes doit recharger son plugin PieceMaker avant cette session.');
  };

  runtime.run = async (provider, command, options, writer) => {
    if (String(provider) !== 'hermes') return run(provider, command, options, writer);
    const cwd = path.resolve(String(options.cwd || options.projectPath || process.cwd()));
    if (!instanceHome) throw new Error('CLOUDCLI_HOME est requis pour raccorder Hermes à cette instance PieceMaker.');
    installation ??= prepare().catch((error) => { installation = undefined; throw error; });
    await installation;
    projects.add(cwd);
    const directory = path.join(plugin, 'bindings');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, `${instance}.json`);
    fs.writeFileSync(`${target}.${process.pid}.tmp`, JSON.stringify({
      pid: process.pid, projects: [...projects], node: process.execPath, home: instanceHome,
      port: process.env.SERVER_PORT || process.env.PORT || 3003,
      cli: path.join(applicationRoot, 'server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/pm.mjs'),
      guard: path.join(applicationRoot, 'server/piecemaker/hermes/guard.mjs'),
    }), { mode: 0o600 });
    fs.renameSync(`${target}.${process.pid}.tmp`, target);
    return run(provider, command, options, writer);
  };
}
