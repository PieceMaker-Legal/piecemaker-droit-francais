import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const current = manifest.version;
const requested = process.env.RELEASE_INCREMENT || '';

function major(version) {
  const value = Number(String(version).split('.')[0]);
  return Number.isFinite(value) ? value : 0;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (major(current) < 2) {
  fail(`La version ${current} suit la numérotation CloudCLI. PieceMaker publie à partir de 2.0.0.`);
}

if (/^\d/.test(requested) && major(requested) < 2) {
  fail(`L'incrément ${requested} suit la numérotation CloudCLI. Indiquez une version 2.x ou plus.`);
}

console.log(`Version PieceMaker retenue : ${requested || current} (paquet ${current}).`);
