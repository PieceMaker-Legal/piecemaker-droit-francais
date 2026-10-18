import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { createPublicKey } from 'node:crypto';
import { buildDesktopApp } from '../../../../desktop-bootstrap/lib/build.mjs';
import { generateCertificates } from '../../../../desktop-bootstrap/lib/certificates.mjs';
import { archiveHash, decodeArchive } from '../../../../desktop-bootstrap/overlay/electron-piecemaker/ui-updates/package.mjs';

if (process.platform !== 'win32' || process.env.GITHUB_REF !== 'refs/heads/MAJ-continue') throw new Error('Validation installer requires the isolated Windows branch runner.');
const source = fileURLToPath(new URL('../../../../', import.meta.url));
const templates = fileURLToPath(new URL('./', import.meta.url));
const output = path.resolve(process.env.PIECEMAKER_TEST_OUTPUT);
const assets = path.resolve(process.env.PIECEMAKER_PREBUILT_ASSET_DIR);
const publicKey = await fs.readFile(new URL('../windows-remote/public-key.pem', import.meta.url), 'utf8');
if (createPublicKey(publicKey).asymmetricKeyType !== 'ed25519') throw new Error('Invalid validation public key');
const productFile = path.join(source, 'product.config.json');
const product = JSON.parse(await fs.readFile(productFile));
Object.assign(product, { name: 'PieceMaker Validation', shortName: 'PieceMakerValidation', pageTitle: 'PieceMaker Validation', slug: 'piecemaker-validation', appId: 'legal.piecemaker.validation', protocol: 'piecemaker-validation', desktopPort: 3218, dataDirectoryName: '.piecemaker-validation', repository: 'PieceMaker-Legal/piecemaker-validation-isolated' });
await fs.writeFile(productFile, JSON.stringify(product, null, 2));
await fs.mkdir(output, { recursive: true });
await generateCertificates();
async function replace(file, original, replacement) {
  const text = await fs.readFile(file, 'utf8');
  if (text.split(original).length !== 2) throw new Error(`Nonunique validation substitution: ${path.basename(file)}`);
  await fs.writeFile(file, text.replace(original, replacement));
}
const built = await buildDesktopApp(source, { windowsInstaller: true, prepareStage: async (stage) => {
  const packageFile = path.join(stage, 'package.json');
  const manifest = JSON.parse(await fs.readFile(packageFile));
  manifest.main = 'electron-piecemaker/validation-main.mjs';
  Object.assign(manifest.build, { appId: product.appId, productName: product.name, executableName: product.shortName, artifactName: 'PieceMaker-Validation-${version}-win-${arch}.${ext}', extraMetadata: { ...manifest.build.extraMetadata, main: manifest.main } });
  manifest.build.extraResources = [...(manifest.build.extraResources || []), { from: assets, to: 'validation-assets', filter: ['*.tar.gz', '*.json', '*.sha256', '*.exe', '*.node'] }, { from: path.join(source, 'release/desktop'), to: 'validation-assets', filter: ['piecemaker-runtime-components-*.tar.gz'] }];
  await fs.writeFile(packageFile, JSON.stringify(manifest, null, 2));
  await fs.copyFile(path.join(templates, 'main.mjs'), path.join(stage, manifest.main));
  await fs.copyFile(path.join(templates, 'uninstall.mjs'), path.join(stage, 'electron/piecemakerUninstall.js'));
  await replace(path.join(stage, 'electron-piecemaker/main.js'), 'await installWindowsUpdater({ app, dialog });', 'process.env.PIECEMAKER_DESKTOP_UPDATE_URL = "http://127.0.0.1:9/disabled-validation";');
  await replace(path.join(stage, 'server/piecemaker/anonymizer/service.cjs'), "path.join(os.homedir(), '.piecemaker', 'certs')", "path.join(process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker'), 'certs')");
  const compiledService = path.join(stage, 'dist-server/server/piecemaker/anonymizer/service.cjs');
  try {
    await fs.access(compiledService);
    await replace(compiledService, "path.join(os.homedir(), '.piecemaker', 'certs')", "path.join(process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker'), 'certs')");
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const configFile = path.join(stage, 'electron-piecemaker/ui-update-runtime.json');
  const config = JSON.parse(await fs.readFile(configFile));
  Object.assign(config, { publicKey, feed: `https://github.com/PieceMaker-Legal/piecemaker-droit-francais/releases/download/validation-ui-${config.runtime}` });
  await fs.writeFile(configFile, JSON.stringify(config, null, 2));
  await fs.copyFile(configFile, path.join(output, 'validation-runtime.json'));
  const entries = [];
  async function visit(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), name + '/');
      else if (entry.isFile()) entries.push([name, (await fs.readFile(path.join(directory, entry.name))).toString('base64')]);
      else throw new Error('Special files forbidden in UI baseline');
    }
  }
  await visit(path.join(stage, 'dist'));
  const archive = gzipSync(JSON.stringify(entries));
  const sha256 = archiveHash(archive);
  decodeArchive(archive, { bytes: archive.length, sha256 });
  await fs.writeFile(path.join(output, 'ui-baseline.json.gz'), archive);
  await fs.writeFile(path.join(output, 'ui-baseline.sha256'), sha256 + '\n');
} });
const release = path.join(source, 'release/desktop');
const installer = (await fs.readdir(release)).find((name) => /^PieceMaker-Validation-.*\.exe$/.test(name));
if (!installer) throw new Error('Full validation installer missing');
await fs.copyFile(path.join(release, installer), path.join(output, installer));
console.log(JSON.stringify({ built, installer, output }));
