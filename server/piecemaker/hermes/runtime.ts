import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import type { providerRuntimeService } from '@/modules/providers/index.js';
import { getHermesHome } from '@/modules/providers/list/hermes/hermes-home.js';
import { hermesGatewayService } from '@/modules/providers/services/hermes-gateway.service.js';

import { preparePieceMakerHermesProfile, runHermesCommand, selectPieceMakerHermesProfile } from './profile.js';

export function installHermesPieceMaker(runtime: Pick<typeof providerRuntimeService, 'run'>, applicationRoot: string) {
  const run = runtime.run.bind(runtime);
  selectPieceMakerHermesProfile();
  let installation: Promise<void> | undefined;
  const projects = new Set<string>();
  const source = path.join(applicationRoot, 'server/piecemaker/hermes/plugin');
  const plugin = () => path.join(getHermesHome(), 'plugins/piecemaker');
  const instanceHome = process.env.CLOUDCLI_HOME || process.env.PIECEMAKER_HOME;
  const instance = createHash('sha256').update(instanceHome || applicationRoot).digest('hex').slice(0, 16);

  const writeBinding = () => {
    const directory = path.join(plugin(), 'bindings');
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const target = path.join(directory, `${instance}.json`);
    fs.writeFileSync(`${target}.${process.pid}.tmp`, JSON.stringify({
      pid: process.pid, projects: [...projects], node: process.execPath, home: instanceHome,
      port: process.env.SERVER_PORT || process.env.PORT || 3003,
      cli: path.join(applicationRoot, 'server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/pm.mjs'),
      guard: path.join(applicationRoot, 'server/piecemaker/hermes/guard.mjs'),
    }), { mode: 0o600 });
    fs.renameSync(`${target}.${process.pid}.tmp`, target);
  };

  const prepare = async () => {
    await preparePieceMakerHermesProfile(applicationRoot);
    const directory = plugin();
    if (fs.existsSync(directory) && fs.readdirSync(directory).length && !fs.existsSync(path.join(directory, '.piecemaker-owned'))) {
      throw new Error('Le plugin Hermes piecemaker existe déjà et appartient à une autre installation.');
    }
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const name of ['plugin.yaml', '__init__.py', 'piecemaker.py', 'bridge.mjs']) {
      const target = path.join(directory, name);
      const bytes = fs.readFileSync(path.join(source, name));
      if (fs.existsSync(target) && fs.readFileSync(target).equals(bytes)) continue;
      if (fs.existsSync(target) && !fs.existsSync(path.join(directory, '.piecemaker-owned'))) {
        throw new Error('Le plugin Hermes piecemaker existe déjà et appartient à une autre installation.');
      }
      fs.writeFileSync(`${target}.${process.pid}.tmp`, bytes, { mode: 0o600 });
      fs.renameSync(`${target}.${process.pid}.tmp`, target);
    }
    fs.writeFileSync(path.join(directory, '.piecemaker-owned'), '1\n', { mode: 0o600 });
    fs.cpSync(path.join(applicationRoot, 'server/piecemaker/vendor/skills/Skill-PieceMaker'), path.join(directory, 'skills/piecemaker'), { recursive: true });
    const result = await runHermesCommand(['plugins', 'enable', 'piecemaker']);
    if (/restart the gateway/i.test(result.stdout)) throw new Error('Hermes doit recharger son plugin PieceMaker avant cette session.');
    if (instanceHome) writeBinding();
  };

  const ensure = () => {
    installation ??= prepare().catch((error) => { installation = undefined; throw error; });
    return installation;
  };

  // The gateway runs in the same profile, and reminders need this instance's port.
  hermesGatewayService.setPreflight(ensure);
  if (instanceHome && fs.existsSync(path.join(plugin(), '.piecemaker-owned'))) writeBinding();

  runtime.run = async (provider, command, options, writer) => {
    if (String(provider) !== 'hermes') return run(provider, command, options, writer);
    const cwd = path.resolve(String(options.cwd || options.projectPath || process.cwd()));
    if (!instanceHome) throw new Error('CLOUDCLI_HOME est requis pour raccorder Hermes à cette instance PieceMaker.');
    await ensure();
    projects.add(cwd);
    writeBinding();
    return run(provider, command, options, writer);
  };

  return { ensure };
}
