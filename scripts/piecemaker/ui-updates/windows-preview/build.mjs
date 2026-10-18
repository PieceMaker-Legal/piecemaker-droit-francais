import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { buildDesktopApp } from '../../../../desktop-bootstrap/lib/build.mjs';
import { generateCertificates } from '../../../../desktop-bootstrap/lib/certificates.mjs';
import { archiveHash, decodeArchive } from '../../../../desktop-bootstrap/overlay/electron-piecemaker/ui-updates/package.mjs';

const source = fileURLToPath(new URL('../../../../', import.meta.url));
const templates = fileURLToPath(new URL('./', import.meta.url));
const output = path.resolve(process.env.PIECEMAKER_TEST_OUTPUT);
const assets = path.resolve(process.env.PIECEMAKER_PREBUILT_ASSET_DIR);
if (process.platform !== 'win32' || process.env.GITHUB_REF !== 'refs/heads/MAJ-continue') throw new Error('Preview builds run only on the Windows MAJ-continue CI runner.');
const productFile = path.join(source, 'product.config.json');
const previewProduct = JSON.parse(await fs.readFile(productFile));
Object.assign(previewProduct, { name: 'PieceMaker Test MAJ', shortName: 'PieceMakerTestMAJ', pageTitle: 'PieceMaker Test MAJ', slug: 'piecemaker-test-maj', appId: 'legal.piecemaker.testmaj', protocol: 'piecemaker-test-maj', desktopPort: 3217, dataDirectoryName: '.piecemaker-maj-test', repository: 'PieceMaker-Legal/piecemaker-test-maj-isolated' });
await fs.writeFile(productFile, JSON.stringify(previewProduct, null, 2));
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, 'openssl.cnf'), '[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=PieceMaker Preview Local\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,digitalSignature,keyEncipherment,keyCertSign\nsubjectAltName=DNS:localhost,IP:127.0.0.1\n');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30', '-keyout', path.join(output, 'localhost.key'), '-out', path.join(output, 'localhost.crt'), '-config', path.join(output, 'openssl.cnf')], { stdio: 'ignore' });
for (const name of ['localhost.key', 'localhost.crt']) await fs.copyFile(path.join(output, name), path.join(assets, name));
await generateCertificates();

async function replace(file, original, replacement) {
  const text = await fs.readFile(file, 'utf8');
  if (text.split(original).length !== 2) throw new Error(`Staging substitution is not unique: ${path.basename(file)}`);
  await fs.writeFile(file, text.replace(original, replacement));
}

const built = await buildDesktopApp(source, { windowsInstaller: true, prepareStage: async (stage) => {
  const productFile = path.join(stage, 'product.config.json');
  const product = JSON.parse(await fs.readFile(productFile));
  await fs.writeFile(productFile, JSON.stringify(product, null, 2));
  const packageFile = path.join(stage, 'package.json');
  const manifest = JSON.parse(await fs.readFile(packageFile));
  manifest.main = 'electron-piecemaker/test-main.mjs';
  Object.assign(manifest.build, { appId: product.appId, productName: product.name, executableName: product.shortName, artifactName: 'PieceMaker-Test-MAJ-${version}-win-${arch}.${ext}', extraMetadata: { ...manifest.build.extraMetadata, main: manifest.main } });
  manifest.build.extraResources = [...(manifest.build.extraResources || []), { from: assets, to: 'test-assets' }, { from: path.join(source, 'release/desktop'), to: 'test-assets', filter: ['piecemaker-runtime-components-*.tar.gz'] }];
  await fs.writeFile(packageFile, JSON.stringify(manifest, null, 2));
  await fs.copyFile(path.join(templates, 'test-main.mjs'), path.join(stage, manifest.main));
  await replace(path.join(stage, 'electron-piecemaker/main.js'), 'await installWindowsUpdater({ app, dialog });', 'process.env.PIECEMAKER_DESKTOP_UPDATE_URL = "http://127.0.0.1:39148/disabled";');
  const configFile = path.join(stage, 'electron-piecemaker/ui-update-runtime.json');
  const config = JSON.parse(await fs.readFile(configFile));
  Object.assign(config, { publicKey: publicKey.export({ type: 'spki', format: 'pem' }), feed: 'https://127.0.0.1:39147' });
  await fs.writeFile(configFile, JSON.stringify(config, null, 2));
  await fs.writeFile(path.join(output, 'test-runtime.json'), JSON.stringify({ runtime: config.runtime, executable: product.shortName + '.exe', productName: product.name, dataDirectory: product.dataDirectoryName }, null, 2));
  const entries = [];
  async function visit(directory, prefix = '') {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await visit(path.join(directory, entry.name), name + '/');
      else if (entry.isFile()) entries.push([name, (await fs.readFile(path.join(directory, entry.name))).toString('base64')]);
      else throw new Error('Special files are forbidden in preview UI');
    }
  }
  await visit(path.join(stage, 'dist'));
  const baseline = Buffer.from(entries.find(([name]) => name === 'index.html')[1], 'base64').toString();
  await fs.mkdir(path.join(output, 'updates'));
  for (const mode of ['valid', 'broken']) {
    const html = mode === 'valid'
      ? baseline.replace('<body>', '<body><div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#166534;color:white;padding:8px;text-align:center">TEST MAJ : interface signée chargée depuis le cache local</div>')
      : '<!doctype html><html><body><div id="root"><p>Test du retour arrière</p></div><script>throw new Error("Simulated startup exception")</script></body></html>';
    const archive = gzipSync(JSON.stringify(entries.map(([name, content]) => [name, name === 'index.html' ? Buffer.from(html).toString('base64') : content])));
    const sha256 = archiveHash(archive);
    const metadata = { format: 1, runtime: config.runtime, sequence: mode === 'valid' ? 1 : 2, sha256, archive: `ui-${sha256}.json.gz`, bytes: archive.length };
    decodeArchive(archive, metadata);
    const payload = JSON.stringify(metadata);
    await fs.writeFile(path.join(output, 'updates', metadata.archive), archive);
    await fs.writeFile(path.join(output, 'updates', `${mode}.json`), JSON.stringify({ payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') }));
  }
} });

const release = path.join(source, 'release/desktop');
const installer = (await fs.readdir(release)).find((name) => /^PieceMaker-Test-MAJ-.*\.exe$/.test(name));
if (!installer) throw new Error('Test installer is missing');
await fs.copyFile(path.join(release, installer), path.join(output, installer));
for (const file of ['Lancer-test.cmd', 'Lancer-test.ps1', 'feed.mjs', 'LISEZ-MOI.txt']) await fs.copyFile(path.join(templates, file), path.join(output, file));
console.log(JSON.stringify({ built, installer, output }));
