import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'win32') throw new Error('Ce paquet doit être préparé sur Windows.');
const output = process.env.PIECEMAKER_SDK_OUTPUT;
if (!output) throw new Error('PIECEMAKER_SDK_OUTPUT est absent.');
const sources = path.dirname(fileURLToPath(import.meta.url));
const rootPackage = JSON.parse(await fs.readFile(new URL('../../../package.json', import.meta.url)));
const sdkVersion = rootPackage.dependencies['@mistralai/mistralai'];
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'package.json'), JSON.stringify({ name: 'piecemaker-mistral-sdk-trial', private: true, type: 'module', dependencies: { '@mistralai/mistralai': sdkVersion } }, null, 2));
const nodeDirectory = path.dirname(process.execPath);
await fs.copyFile(process.execPath, path.join(output, 'node.exe'));
await fs.copyFile(path.join(nodeDirectory, 'LICENSE'), path.join(output, 'NODE-LICENSE.txt'));
for (const name of ['browser-login.mjs', 'browser-login.test.mjs', 'sdk.test.mjs', 'try.mjs', 'Tester-Mistral.cmd', 'README.md']) {
  await fs.copyFile(path.join(sources, name), path.join(output, name));
}
const npmCli = path.join(nodeDirectory, 'node_modules/npm/bin/npm-cli.js');
execFileSync(process.execPath, [npmCli, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: output, stdio: 'inherit' });
execFileSync(path.join(output, 'node.exe'), ['--test', 'browser-login.test.mjs', 'sdk.test.mjs'], { cwd: output, stdio: 'inherit' });
await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify({ platform: process.platform, arch: process.arch, node: process.version, sdk: sdkVersion, commit: process.env.GITHUB_SHA, offlineTestsPassed: true, accountSignInTested: false }, null, 2));
