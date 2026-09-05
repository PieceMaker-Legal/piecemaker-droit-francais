'use strict';

/**
 * Bibliothèque de skills et d'agents PieceMaker, et leur installation par
 * dossier. Ni Claude Code ni Codex ne chargent jamais `~/.claude/skills`
 * pour cette fonctionnalité : la bibliothèque vit sous
 * `<repoRoot>/piecemaker-plugin/{skills,agents}` (les composants déjà
 * édités par la vue Fichiers, `repoRoot` = `VENDOR_ROOT` de `router.cjs`) et
 * sous `<piecemakerHome>/library/{skills,agents}` (composants propres à
 * l'utilisateur). En cas de même identifiant des deux côtés, la bibliothèque
 * utilisateur l'emporte.
 *
 * Un composant installé dans un dossier en est une copie indépendante : la
 * désinstallation ne touche jamais la bibliothèque, et une réinstallation
 * écrase la copie du dossier pour la mettre à jour.
 *
 * `globalLeftovers` recense ce qui traîne encore dans les emplacements
 * globaux historiques (`~/.claude/skills`, `~/.claude/agents`,
 * `~/.codex/skills`), à l'exclusion de ce que fournit un plugin de
 * marketplace (résolu sous `~/.claude/plugins` ou `~/.codex/plugins`) — la
 * bascule du plugin gouverne ce cas, pas nous. `adoptGlobalComponent` est le
 * seul moyen de les faire entrer dans la bibliothèque ; jamais automatique.
 */
const fs = require('node:fs');
const path = require('node:path');

const { ActivationError } = require('./errors.cjs');
const { displayPath, safeChildPath, copyComponent, moveComponent, removeIfExists } = require('./paths.cjs');
const { listSkillEntries, listAgentEntries, readSkillDefinition, readAgentDefinition } = require('./markdown.cjs');

function pieceMakerLibraryDirs(repoRoot) {
  return {
    skills: path.join(repoRoot, 'piecemaker-plugin', 'skills'),
    agents: path.join(repoRoot, 'piecemaker-plugin', 'agents'),
  };
}

function userLibraryDirs(piecemakerHome) {
  return {
    skills: path.join(piecemakerHome, 'library', 'skills'),
    agents: path.join(piecemakerHome, 'library', 'agents'),
  };
}

function classifyPluginOrigin(entryPath, pluginsRoot) {
  let real;
  try {
    real = fs.realpathSync(entryPath);
  } catch {
    real = path.resolve(entryPath);
  }
  const resolvedRoot = path.resolve(pluginsRoot);
  if (real !== resolvedRoot && !real.startsWith(`${resolvedRoot}${path.sep}`)) return null;
  const cacheRoot = path.join(resolvedRoot, 'cache');
  const relative = path.relative(cacheRoot, real);
  const segments = relative.split(path.sep).filter(Boolean);
  if (relative.startsWith('..') || segments.length < 2) return { pluginId: 'plugin' };
  const [marketplace, pluginName] = segments;
  return { pluginId: `${pluginName}@${marketplace}` };
}

function mergeEntries(pieceMakerEntries, libraryEntries) {
  const byId = new Map();
  for (const entry of pieceMakerEntries) byId.set(entry.id, { ...entry, origin: 'piecemaker' });
  for (const entry of libraryEntries) byId.set(entry.id, { ...entry, origin: 'library' });
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function buildLibrarySkills(workspacePath, repoRoot, piecemakerHome, userHome) {
  const pieceMakerDir = pieceMakerLibraryDirs(repoRoot).skills;
  const libraryDir = userLibraryDirs(piecemakerHome).skills;
  const merged = mergeEntries(listSkillEntries(pieceMakerDir), listSkillEntries(libraryDir));
  return merged.map(({ id, entryPath, origin }) => {
    const definition = readSkillDefinition(entryPath, id);
    return {
      id,
      name: definition.name,
      description: definition.description,
      origin,
      source: displayPath(entryPath, userHome),
      installed: {
        claude: fs.existsSync(path.join(workspacePath, '.claude', 'skills', id, 'SKILL.md')),
        codex: fs.existsSync(path.join(workspacePath, '.codex', 'skills', id, 'SKILL.md')),
      },
    };
  });
}

function buildLibraryAgents(workspacePath, repoRoot, piecemakerHome, userHome) {
  const pieceMakerDir = pieceMakerLibraryDirs(repoRoot).agents;
  const libraryDir = userLibraryDirs(piecemakerHome).agents;
  const merged = mergeEntries(listAgentEntries(pieceMakerDir), listAgentEntries(libraryDir));
  return merged.map(({ id, entryPath, origin }) => {
    const definition = readAgentDefinition(entryPath, id);
    return {
      id,
      name: definition.name,
      description: definition.description,
      origin,
      source: displayPath(entryPath, userHome),
      installed: {
        claude: fs.existsSync(path.join(workspacePath, '.claude', 'agents', `${id}.md`)),
        codex: null,
      },
    };
  });
}

function buildLibrary(workspacePath, { repoRoot, piecemakerHome, userHome }) {
  return {
    skills: buildLibrarySkills(workspacePath, repoRoot, piecemakerHome, userHome),
    agents: buildLibraryAgents(workspacePath, repoRoot, piecemakerHome, userHome),
  };
}

function leftoversFrom(dir, { assistant, family, pluginsRoot, userHome }) {
  const entries = family === 'agent' ? listAgentEntries(dir) : listSkillEntries(dir);
  const result = [];
  for (const entry of entries) {
    if (classifyPluginOrigin(entry.entryPath, pluginsRoot)) continue;
    const definition = family === 'agent' ? readAgentDefinition(entry.entryPath, entry.id) : readSkillDefinition(entry.entryPath, entry.id);
    result.push({
      id: entry.id,
      name: definition.name,
      description: definition.description,
      assistant,
      family,
      source: displayPath(entry.entryPath, userHome),
    });
  }
  return result;
}

function listGlobalLeftovers(userHome) {
  const claudePluginsRoot = path.join(userHome, '.claude', 'plugins');
  const codexPluginsRoot = path.join(userHome, '.codex', 'plugins');
  const claudeSkills = leftoversFrom(path.join(userHome, '.claude', 'skills'), { assistant: 'claude', family: 'skill', pluginsRoot: claudePluginsRoot, userHome });
  const claudeAgents = leftoversFrom(path.join(userHome, '.claude', 'agents'), { assistant: 'claude', family: 'agent', pluginsRoot: claudePluginsRoot, userHome });
  const codexSkills = leftoversFrom(path.join(userHome, '.codex', 'skills'), { assistant: 'codex', family: 'skill', pluginsRoot: codexPluginsRoot, userHome });
  return {
    skills: [...claudeSkills, ...codexSkills],
    agents: claudeAgents,
  };
}

function resolveLibrarySource(id, family, { repoRoot, piecemakerHome }) {
  const pieceMakerDirs = pieceMakerLibraryDirs(repoRoot);
  const libraryDirs = userLibraryDirs(piecemakerHome);
  if (family === 'skill') {
    const fromLibrary = safeChildPath(libraryDirs.skills, id);
    if (fs.existsSync(path.join(fromLibrary, 'SKILL.md'))) return { path: fromLibrary, isDirectory: true };
    const fromPieceMaker = safeChildPath(pieceMakerDirs.skills, id);
    if (fs.existsSync(path.join(fromPieceMaker, 'SKILL.md'))) return { path: fromPieceMaker, isDirectory: true };
    return null;
  }
  const fromLibrary = safeChildPath(libraryDirs.agents, id, '.md');
  if (fs.existsSync(fromLibrary)) return { path: fromLibrary, isDirectory: false };
  const fromPieceMaker = safeChildPath(pieceMakerDirs.agents, id, '.md');
  if (fs.existsSync(fromPieceMaker)) return { path: fromPieceMaker, isDirectory: false };
  return null;
}

function targetRootFor(workspacePath, assistant, family) {
  if (assistant === 'claude' && family === 'skill') return path.join(workspacePath, '.claude', 'skills');
  if (assistant === 'claude' && family === 'agent') return path.join(workspacePath, '.claude', 'agents');
  if (assistant === 'codex' && family === 'skill') return path.join(workspacePath, '.codex', 'skills');
  throw new ActivationError(400, 'Codex n’a pas d’agents par dossier.');
}

function installLibraryComponent({ workspacePath, assistant, family, id, installed, repoRoot, piecemakerHome, userHome }) {
  if (assistant === 'codex' && family === 'agent') {
    throw new ActivationError(400, 'Codex n’a pas d’agents par dossier.');
  }
  const root = targetRootFor(workspacePath, assistant, family);
  const suffix = family === 'agent' ? '.md' : '';
  const target = safeChildPath(root, id, suffix);

  if (installed) {
    const source = resolveLibrarySource(id, family, { repoRoot, piecemakerHome });
    if (!source) throw new ActivationError(400, 'Composant introuvable dans la bibliothèque.');
    copyComponent(source.path, target, { isDirectory: source.isDirectory });
  } else {
    removeIfExists(target);
  }

  const library = buildLibrary(workspacePath, { repoRoot, piecemakerHome, userHome });
  const list = family === 'skill' ? library.skills : library.agents;
  return list.find((item) => item.id === id) ?? null;
}

function adoptGlobalComponent({ assistant, family, id, userHome, piecemakerHome }) {
  if (assistant === 'codex' && family === 'agent') {
    throw new ActivationError(400, 'Codex n’a pas d’agents.');
  }
  const sourceRoot = assistant === 'codex' ? path.join(userHome, '.codex', 'skills') : path.join(userHome, '.claude', family === 'agent' ? 'agents' : 'skills');
  const suffix = family === 'agent' ? '.md' : '';
  const source = safeChildPath(sourceRoot, id, suffix);
  if (!fs.existsSync(source)) {
    throw new ActivationError(400, 'Composant introuvable.');
  }
  const pluginsRoot = assistant === 'codex' ? path.join(userHome, '.codex', 'plugins') : path.join(userHome, '.claude', 'plugins');
  if (classifyPluginOrigin(source, pluginsRoot)) {
    throw new ActivationError(400, 'Fourni par un plugin de marketplace : c’est la bascule du plugin qui gouverne, pas l’adoption.');
  }

  const destRoot = userLibraryDirs(piecemakerHome)[family === 'agent' ? 'agents' : 'skills'];
  const dest = safeChildPath(destRoot, id, suffix);
  if (fs.existsSync(dest)) {
    throw new ActivationError(400, 'Un composant du même identifiant existe déjà dans la bibliothèque.');
  }
  moveComponent(source, dest, { isDirectory: family === 'skill' });
  return { id, assistant, family };
}

module.exports = {
  buildLibrary,
  listGlobalLeftovers,
  installLibraryComponent,
  adoptGlobalComponent,
  classifyPluginOrigin,
  pieceMakerLibraryDirs,
  userLibraryDirs,
};
