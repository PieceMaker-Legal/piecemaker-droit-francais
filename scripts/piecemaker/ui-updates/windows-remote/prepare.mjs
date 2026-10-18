import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { archiveHash, decodeArchive, verifyManifest } from '../../../../desktop-bootstrap/overlay/electron-piecemaker/ui-updates/package.mjs';

const input = path.resolve(process.argv[2]);
const output = path.resolve(process.env.PIECEMAKER_TEST_OUTPUT);
const templates = path.dirname(fileURLToPath(import.meta.url));
const privateKey = createPrivateKey(process.env.PIECEMAKER_PREVIEW_UI_SIGNING_KEY);
const publicKey = await fs.readFile(path.join(templates, 'public-key.pem'), 'utf8');
if (!createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).equals(createPublicKey(publicKey).export({ type: 'spki', format: 'der' }))) throw new Error('Preview signing key mismatch');
const runtime = JSON.parse(await fs.readFile(path.join(input, 'test-runtime.json'))).runtime;
if (runtime !== 'desktop-2.0.47') throw new Error('Unexpected test runtime');
const config = { runtime, publicKey, feed: 'https://github.com/PieceMaker-Legal/piecemaker-droit-francais/releases/download/test-maj-ui-desktop-2.0.47' };
await fs.mkdir(path.join(output, 'updates'), { recursive: true });
await fs.mkdir(path.join(output, 'remote'), { recursive: true });
await fs.writeFile(path.join(output, 'remote-runtime.json'), JSON.stringify(config, null, 2));
for (const file of ['activer.mjs', 'Activer-MAJ-distantes.cmd', 'LISEZ-MOI.txt']) await fs.copyFile(path.join(templates, file), path.join(output, file));
for (const file of ['test-runtime.json', 'localhost.crt', 'localhost.key', 'feed.mjs']) await fs.copyFile(path.join(input, file), path.join(output, file));
for (const mode of ['valid', 'broken']) {
  const original = JSON.parse(JSON.parse(await fs.readFile(path.join(input, 'updates', `${mode}.json`))).payload);
  const files = decodeArchive(await fs.readFile(path.join(input, 'updates', original.archive)), original);
  if (mode === 'valid') {
    const html = files.get('index.html').toString();
    if (html.split('<body>').length !== 2) throw new Error('Unique body element expected');
    files.set('index.html', Buffer.from(html.replace('<body>', '<body><button id="piecemaker-test-maj-blue" style="position:fixed;right:28px;bottom:28px;z-index:2147483647;background:#0066ff;color:#fff;border:4px solid #fff;border-radius:18px;padding:28px 40px;font:bold 28px system-ui;box-shadow:0 8px 32px #0008;cursor:pointer">TEST MAJ — BOUTON BLEU</button><script defer src="/piecemaker-test-maj.js"></script>')));
    files.set('piecemaker-test-maj.js', Buffer.from('document.getElementById("piecemaker-test-maj-blue").addEventListener("click",event=>{event.currentTarget.textContent="MAJ DISTANTE OK !";});'));
  }
  const bytes = gzipSync(JSON.stringify([...files].map(([name, content]) => [name, content.toString('base64')])));
  const sha256 = archiveHash(bytes);
  const archive = `ui-${sha256}.json.gz`;
  const envelope = (sequence) => {
    const payload = JSON.stringify({ format: 1, runtime, sequence, sha256, archive, bytes: bytes.length });
    const signed = { payload, signature: sign(null, Buffer.from(payload), privateKey).toString('base64') };
    decodeArchive(bytes, verifyManifest(signed, config));
    return JSON.stringify(signed);
  };
  await fs.writeFile(path.join(output, 'updates', archive), bytes);
  await fs.writeFile(path.join(output, 'updates', `${mode}.json`), envelope(mode === 'valid' ? 1 : 2));
  if (mode === 'valid') {
    await fs.writeFile(path.join(output, 'remote', archive), bytes);
    await fs.writeFile(path.join(output, 'remote', 'ui-update.json'), envelope(3));
  }
}
console.log('Signed blue-button UI prepared for the isolated preview channel.');
