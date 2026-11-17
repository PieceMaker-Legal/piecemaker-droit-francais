import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PIECEMAKER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REGISTRY = path.join(PIECEMAKER_ROOT, 'vendor', 'piecemaker-plugin', 'herisson.json');

export const CATALOGUE = JSON.parse(fs.readFileSync(REGISTRY, 'utf8')).catalogue;

const skillFolder = (skill) => path.join(PIECEMAKER_ROOT, skill.chemin);

function skillName(skill) {
  const match = /^name:\s*(.+)$/m.exec(fs.readFileSync(path.join(skillFolder(skill), 'SKILL.md'), 'utf8'));
  return match ? match[1].trim() : path.basename(skill.chemin);
}

export function featureNamed(name) {
  const feature = CATALOGUE.find((entry) => entry.nom === name);
  if (!feature) throw new Error(`unknown feature "${name}". Features: ${CATALOGUE.map((entry) => entry.nom).join(', ')}.`);
  return feature;
}

export function listFeatures() {
  return CATALOGUE.map((feature) => ({ name: feature.nom, title: feature.titre, description: feature.description, tab: feature.volet, skills: feature.skills.map(skillName) }));
}

function referencesOf(skill) {
  const folder = path.join(skillFolder(skill), 'references');
  const all = fs.existsSync(folder) ? fs.readdirSync(folder).filter((file) => file.endsWith('.md')).sort() : [];
  return skill.references ?? all;
}

export function readFeature(name) {
  const feature = featureNamed(name);
  return {
    name: feature.nom,
    title: feature.titre,
    description: feature.description,
    tab: feature.volet,
    skills: feature.skills.map((skill) => ({
      name: skillName(skill),
      instructions: fs.readFileSync(path.join(skillFolder(skill), 'SKILL.md'), 'utf8'),
      references: referencesOf(skill).map((file) => `${skillName(skill)}/references/${file}`),
    })),
  };
}

export function readReference(name, reference) {
  const feature = featureNamed(name);
  const [skillPart, ...rest] = String(reference || '').split('/');
  const skill = feature.skills.find((entry) => skillName(entry) === skillPart);
  const relative = rest.join('/');
  if (!skill || !relative || relative.split('/').some((segment) => segment === '..' || !segment)) throw new Error(`unknown reference "${reference}" for feature ${name}. Use a path given by Feature read.`);
  const file = path.join(skillFolder(skill), relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`no file "${reference}".`);
  return fs.readFileSync(file, 'utf8');
}
