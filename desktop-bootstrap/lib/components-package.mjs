import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { digestRuntimeComponent } from '../overlay/electron-piecemaker/runtime-components.mjs';

const SCOPES = ['@openai', '@anthropic-ai'];

function runTar(tarCommand, args, cwd) {
  const result = spawnSync(tarCommand, args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `tar exited with status ${result.status}`);
  return result.stdout;
}

function installedPackages(stageDir) {
  const packages = [];
  for (const scope of SCOPES) {
    const scopeDir = path.join(stageDir, 'node_modules', scope);
    if (!fs.existsSync(scopeDir)) continue;
    for (const entry of fs.readdirSync(scopeDir, { withFileTypes: true })) {
      if (entry.isDirectory()) packages.push({ name: `${scope}/${entry.name}`, relative: `node_modules/${scope}/${entry.name}` });
    }
  }
  return packages;
}

export async function packageRuntimeComponents(stageDir, {
  repository,
  releaseTag,
  outputDir,
  platform = process.platform,
  arch = process.arch,
  tarCommand = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar',
}) {
  const packages = installedPackages(stageDir);
  if (!packages.length) throw new Error('No runtime component packages found.');
  const names = packages.map((entry) => entry.name).sort();
  const packageManifests = Object.fromEntries(packages.map(({ name, relative }) => {
    const manifest = JSON.parse(fs.readFileSync(path.join(stageDir, relative, 'package.json'), 'utf8'));
    return [name, { name: manifest.name, version: manifest.version }];
  }));
  const treeRoot = path.join(stageDir, 'node_modules');
  const files = [];
  for (const scope of SCOPES) {
    const scopePath = path.join(treeRoot, scope);
    if (fs.existsSync(scopePath)) files.push(scopePath);
  }
  const id = await digestRuntimeComponent(treeRoot, files.map((file) => path.basename(file)));
  const assetName = `piecemaker-runtime-components-${platform}-${arch}-${id}.tar.gz`;
  fs.mkdirSync(outputDir, { recursive: true });
  const archive = path.join(outputDir, assetName);
  runTar(tarCommand, ['-czf', archive, ...files.map((file) => path.relative(stageDir, file))], stageDir);
  const archiveSha256 = await digestFile(archive);
  const manifest = {
    repository,
    releaseTag,
    components: [{ id, sha256: archiveSha256, assetName, packageNames: names, packageManifests }],
  };
  fs.writeFileSync(path.join(stageDir, 'runtime-components.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const scope of SCOPES) fs.rmSync(path.join(treeRoot, scope), { recursive: true, force: true });
  return manifest;
}

async function digestFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
