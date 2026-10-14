import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';

const cliDir = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin');
const clis = { npm: 'npm-cli.js', npx: 'npx-cli.js' };

function redirect(original) {
  return function redirected(file, args, ...rest) {
    const cli = clis[file] && path.join(cliDir, clis[file]);
    if (!cli || !Array.isArray(args) || !fs.existsSync(cli)) return original.call(this, file, args, ...rest);
    return original.call(this, process.execPath, [cli, ...args], ...rest);
  };
}

for (const name of ['execFile', 'execFileSync', 'spawn', 'spawnSync']) {
  childProcess[name] = redirect(childProcess[name]);
}
syncBuiltinESMExports();
