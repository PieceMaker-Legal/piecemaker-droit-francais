import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function quote(value: string) { return `'${value.replace(/'/g, `'\\''`)}'`; }

export function installDocxCommand(home: string, applicationRoot: string, env: NodeJS.ProcessEnv = process.env) {
  const directory = path.join(home, 'docx-bin');
  const current = fileURLToPath(import.meta.url);
  const entry = path.join(path.dirname(current), `docx-cli-entry${path.extname(current)}`);
  const loader = current.endsWith('.ts') ? ['--import', createRequire(import.meta.url).resolve('tsx')] : [];
  const command = [process.execPath, ...loader, entry];
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'docx'), `#!/bin/sh\n[ -z "\${NO_COLOR+x}" ] || unset FORCE_COLOR\nELECTRON_RUN_AS_NODE=1 exec ${command.map(quote).join(' ')} "$@"\n`, { mode: 0o755 });
  fs.chmodSync(path.join(directory, 'docx'), 0o755);
  if (process.platform === 'win32') fs.writeFileSync(path.join(directory, 'docx.cmd'), `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n${command.map((arg) => `"${arg}"`).join(' ')} %*\r\n`);
  const key = Object.keys(env).find((name) => name.toUpperCase() === 'PATH') ?? 'PATH';
  env[key] = [directory, ...(env[key] ?? '').split(path.delimiter).filter((item) => item && item !== directory)].join(path.delimiter);
  env.PIECEMAKER_DOCX_WRAPPER_DIR = directory;
  env.PIECEMAKER_DOCX_CASE_FOLDERS = path.join(applicationRoot, 'server/piecemaker/vendor/piecemaker-plugin/scripts/lib/case-folders.cjs');
  return directory;
}
