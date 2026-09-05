'use strict';

/**
 * Lecture d'un composant skill (dossier + `SKILL.md`) ou agent (fichier
 * `.md`) : nom et description via l'entête YAML, avec repli sur
 * l'identifiant si l'entête est absente ou illisible. `gray-matter` est
 * appelé directement ici (plutôt que via `server/shared/frontmatter.ts`, un
 * module ESM/TS que ce module CommonJS ne peut pas `require`), avec les
 * mêmes moteurs JS/JSON désactivés par sécurité.
 */
const fs = require('node:fs');
const path = require('node:path');

const matter = require('gray-matter');

const frontmatterOptions = {
  language: 'yaml',
  engines: {
    js: () => ({}),
    javascript: () => ({}),
    json: () => ({}),
  },
};

function readDefinitionFromFile(filePath, fallbackId) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = matter(content, frontmatterOptions);
    const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
    const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackId;
    const description = typeof data.description === 'string' ? data.description : undefined;
    return { name, description };
  } catch {
    return { name: fallbackId, description: undefined };
  }
}

function listSkillEntries(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .filter((entry) => fs.existsSync(path.join(dir, entry.name, 'SKILL.md')))
    .map((entry) => ({ id: entry.name, entryPath: path.join(dir, entry.name) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function listAgentEntries(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && /\.md$/i.test(entry.name))
    .map((entry) => ({ id: entry.name.replace(/\.md$/i, ''), entryPath: path.join(dir, entry.name) }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function readSkillDefinition(skillDir, fallbackId) {
  return readDefinitionFromFile(path.join(skillDir, 'SKILL.md'), fallbackId);
}

function readAgentDefinition(agentFile, fallbackId) {
  return readDefinitionFromFile(agentFile, fallbackId);
}

module.exports = {
  listSkillEntries,
  listAgentEntries,
  readSkillDefinition,
  readAgentDefinition,
};
