import fs from 'node:fs/promises';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const destination = path.resolve(process.argv[2] || '');
const root = fileURLToPath(new URL('../../../', import.meta.url));
const relative = path.relative(root, destination);
if (!process.argv[2] || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
  throw new Error('Indiquer un chemin de clé privée hors du dépôt.');
}
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
const physicalParent = await fs.realpath(path.dirname(destination));
const physicalRoot = await fs.realpath(root);
const parentRelative = path.relative(physicalRoot, physicalParent);
if (parentRelative === '' || (!parentRelative.startsWith(`..${path.sep}`) && parentRelative !== '..' && !path.isAbsolute(parentRelative))) {
  throw new Error('Le dossier réel de la clé privée doit être hors du dépôt.');
}
await fs.writeFile(destination, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
