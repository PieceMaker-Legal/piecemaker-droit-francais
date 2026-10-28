import { createCipheriv, createDecipheriv, publicEncrypt, privateDecrypt, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

export async function encryptPackage(input, output, publicKey) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const wrappedKey = publicEncrypt({ key: publicKey, oaepHash: 'sha256' }, key);
  const header = Buffer.from(JSON.stringify({ format: 1, iv: iv.toString('base64'), key: wrappedKey.toString('base64') }));
  const size = Buffer.alloc(4);
  size.writeUInt32BE(header.length);
  const handle = await fs.promises.open(output, 'wx', 0o600);
  try {
    await handle.writeFile(Buffer.concat([size, header]));
  } finally {
    await handle.close();
  }
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(header);
  try {
    await pipeline(fs.createReadStream(input), cipher, fs.createWriteStream(output, { flags: 'a' }));
    await fs.promises.appendFile(output, cipher.getAuthTag());
  } catch (error) {
    await fs.promises.rm(output, { force: true });
    throw error;
  }
}

export async function decryptPackage(input, output, privateKey) {
  const handle = await fs.promises.open(input, 'r');
  let header;
  let tag;
  let length;
  let size;
  try {
    const prefix = Buffer.alloc(4);
    await handle.read(prefix, 0, 4, 0);
    length = prefix.readUInt32BE();
    size = (await handle.stat()).size;
    if (length > 16384 || size <= length + 20) throw new Error('Invalid encrypted package.');
    header = Buffer.alloc(length);
    await handle.read(header, 0, length, 4);
    tag = Buffer.alloc(16);
    await handle.read(tag, 0, 16, size - 16);
  } finally {
    await handle.close();
  }
  const metadata = JSON.parse(header.toString());
  if (metadata.format !== 1) throw new Error('Unsupported encrypted package format.');
  const key = privateDecrypt({ key: privateKey, oaepHash: 'sha256' }, Buffer.from(metadata.key, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(metadata.iv, 'base64'));
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  const destination = await fs.promises.open(output, 'wx', 0o600);
  try {
    await pipeline(fs.createReadStream(input, { start: 4 + length, end: size - 17 }), decipher, destination.createWriteStream());
  } catch (error) {
    await fs.promises.rm(output, { force: true });
    throw error;
  } finally {
    await destination.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, input, output, keyFile] = process.argv.slice(2);
  if (!['encrypt', 'decrypt'].includes(mode) || !input || !output) throw new Error('Usage: private-package.mjs encrypt|decrypt input output [key-file]');
  const key = keyFile ? await fs.promises.readFile(keyFile) : process.env.WINDOWS_VALIDATION_PACKAGE_PUBLIC_KEY;
  if (!key) throw new Error('Validation package key is required.');
  await (mode === 'encrypt' ? encryptPackage : decryptPackage)(input, output, key);
}
