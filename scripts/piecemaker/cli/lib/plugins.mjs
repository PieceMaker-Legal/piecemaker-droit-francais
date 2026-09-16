import fs from 'node:fs';
import path from 'node:path';

import { APP } from './config.mjs';
import { runInherited } from './exec.mjs';
import { runtimeEnv } from './node-runtime.mjs';

const INSTALL_TIMEOUT = 2 * 60_000;

export const PLUGINS = [
  { id: 'piecemaker-timesheet', label: 'Plugin Timesheet' },
  { id: 'piecemaker-tampon', label: 'Plugin Bordereau' },
];

export async function installPlugins(runtime, report) {
  for (const plugin of PLUGINS) {
    const installer = path.join(APP.directory, 'plugins', plugin.id, 'install.mjs');
    if (!fs.existsSync(installer)) {
      report.warn(`${plugin.label} — source introuvable`);
      continue;
    }

    report.step(`${plugin.label} — installation`);
    const result = await runInherited(runtime.nodePath, [installer, APP.directory], {
      cwd: APP.directory,
      env: runtimeEnv(runtime),
      timeout: INSTALL_TIMEOUT,
    });

    if (result.timedOut) report.warn(`${plugin.label} — délai dépassé`);
    else if (result.error) report.warn(`${plugin.label} — échec de démarrage : ${result.error.message}`);
    else if (result.code !== 0) report.warn(`${plugin.label} — échec (code ${result.code})`);
    else report.ok(`${plugin.label} — installé`);
  }
}
