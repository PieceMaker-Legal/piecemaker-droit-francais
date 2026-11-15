import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REGISTRY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'herisson.json');

export const FEATURES = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).features.map((feature) => ({ ...feature, pattern: new RegExp(feature.cible) }));

export function featureOf(absolute) {
  const parts = String(absolute).replace(/\\/g, '/').split('/.piecemaker/');
  if (parts.length < 2) return null;
  const relative = parts.pop();
  const root = parts.join('/.piecemaker/');
  for (const feature of FEATURES) {
    const match = feature.pattern.exec(relative);
    if (match) return { feature, root, nom: match.groups?.nom ?? '' };
  }
  return null;
}

export function verifierArgs(found) {
  return found.feature.verifier.map((arg) => arg.replace('{nom}', found.nom));
}
