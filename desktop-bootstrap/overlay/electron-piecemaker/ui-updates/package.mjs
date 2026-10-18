import { createHash, verify } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_CONTENT_BYTES = 96 * 1024 * 1024;

export function archiveHash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function verifyManifest(envelope, config) {
  if (typeof envelope.payload !== 'string' || envelope.payload.length > 8192
    || typeof envelope.signature !== 'string'
    || !verify(null, Buffer.from(envelope.payload), config.publicKey, Buffer.from(envelope.signature, 'base64'))) {
    throw new Error('Signature de mise à jour invalide.');
  }
  const manifest = JSON.parse(envelope.payload);
  if (manifest.format !== 1 || manifest.runtime !== config.runtime
    || !Number.isSafeInteger(manifest.sequence) || manifest.sequence < 1
    || !/^[a-f0-9]{64}$/.test(manifest.sha256)
    || manifest.archive !== `ui-${manifest.sha256}.json.gz`
    || !Number.isSafeInteger(manifest.bytes) || manifest.bytes < 1 || manifest.bytes > MAX_ARCHIVE_BYTES) {
    throw new Error('Mise à jour incompatible ou manifeste invalide.');
  }
  return manifest;
}

export function decodeArchive(bytes, manifest) {
  if (bytes.length !== manifest.bytes || archiveHash(bytes) !== manifest.sha256) {
    throw new Error('Archive de mise à jour altérée.');
  }
  const entries = JSON.parse(gunzipSync(bytes, { maxOutputLength: MAX_CONTENT_BYTES }));
  if (!Array.isArray(entries) || entries.length > 10000) throw new Error('Archive invalide.');
  const files = new Map();
  let size = 0;
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error('Entrée invalide.');
    const [name, content] = entry;
    if (typeof name !== 'string' || name.length > 512
      || !/^[a-zA-Z0-9_@./-]+$/.test(name)
      || name.split('/').some((part) => !part || part === '.' || part === '..')
      || files.has(name) || typeof content !== 'string') {
      throw new Error('Chemin ou contenu invalide dans le paquet.');
    }
    const file = Buffer.from(content, 'base64');
    if (file.toString('base64') !== content) throw new Error('Contenu base64 invalide.');
    size += file.length;
    if (size > MAX_CONTENT_BYTES) throw new Error('Paquet trop volumineux.');
    files.set(name, file);
  }
  if (!files.get('index.html')?.length) throw new Error('Interface absente du paquet.');
  return files;
}

export async function downloadBytes(url, limit, fetcher = fetch) {
  if (new URL(url).protocol !== 'https:') throw new Error('HTTPS requis pour les mises à jour.');
  const response = await fetcher(url, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error(`Téléchargement impossible (${response.status}).`);
  if (response.url && new URL(response.url).protocol !== 'https:') throw new Error('Redirection non sécurisée.');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Téléchargement trop volumineux.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
