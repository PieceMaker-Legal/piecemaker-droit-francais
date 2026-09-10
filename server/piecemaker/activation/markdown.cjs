'use strict';

/**
 * Lecture d'un composant skill (dossier + `SKILL.md`) ou agent : nom et
 * description via l'entête YAML pour un agent markdown (Claude, `.md`), ou
 * via les clés racine pour un agent TOML (Codex, `.toml`) — avec repli sur
 * l'identifiant si l'entête/les clés sont absentes ou illisibles.
 * `gray-matter` et `@iarna/toml` sont appelés directement ici (plutôt que via
 * `server/shared/frontmatter.ts`, un module ESM/TS que ce module CommonJS ne
 * peut pas `require`), avec les mêmes moteurs JS/JSON désactivés par
 * sécurité pour le frontmatter YAML.
 */
const fs = require('node:fs');
const path = require('node:path');

const matter = require('gray-matter');
const TOML = require('@iarna/toml');

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

// Un agent Codex custom est un fichier TOML autonome dont `name` et
// `description` vivent à la racine du document (pas de frontmatter/corps
// séparés comme pour un agent markdown Claude).
function readTomlDefinitionFromFile(filePath, fallbackId) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const parsed = TOML.parse(content);
    const data = parsed && typeof parsed === 'object' ? parsed : {};
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

// `format` distingue les agents markdown (Claude, un fichier `.md` par
// agent) des agents TOML (Codex, un fichier `.toml` par agent) : les deux
// familles vivent dans la même bibliothèque PieceMaker mais avec une
// extension et une lecture différentes.
function listAgentEntries(dir, { format = 'markdown' } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const extensionPattern = format === 'toml' ? /\.toml$/i : /\.md$/i;
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && extensionPattern.test(entry.name))
    .map((entry) => ({
      id: entry.name.replace(extensionPattern, ''),
      entryPath: path.join(dir, entry.name),
      format,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function readSkillDefinition(skillDir, fallbackId) {
  return readDefinitionFromFile(path.join(skillDir, 'SKILL.md'), fallbackId);
}

function readAgentDefinition(agentFile, fallbackId, { format = 'markdown' } = {}) {
  return format === 'toml'
    ? readTomlDefinitionFromFile(agentFile, fallbackId)
    : readDefinitionFromFile(agentFile, fallbackId);
}

module.exports = {
  listSkillEntries,
  listAgentEntries,
  readSkillDefinition,
  readAgentDefinition,
};
