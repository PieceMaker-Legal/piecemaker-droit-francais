'use strict';

/**
 * Bibliothèque de skills et d'agents PieceMaker, et leur installation par
 * dossier. Claude Code ne charge jamais `~/.claude/skills` pour cette
 * fonctionnalité : la bibliothèque vit sous
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
 * Les agents vivent dans la bibliothèque au format markdown (un fichier par
 * agent, entête YAML + corps), le même format que Claude Code consomme
 * directement. Codex CLI a depuis rattrapé son retard et charge lui aussi
 * des agents par dossier (`~/.codex/agents`, `<projet>/.codex/agents`), mais
 * dans un format TOML autonome (`name`, `description`,
 * `developer_instructions`) distinct du markdown de Claude. Plutôt que de
 * dupliquer la bibliothèque en deux formats, l'installation pour Codex
 * convertit à la volée : le frontmatter devient `name`/`description`, et le
 * corps markdown devient `developer_instructions`. La bibliothèque source
 * reste donc unique ; seule la copie installée change de format selon
 * l'assistant cible.
 *
 * `globalLeftovers` recense ce qui traîne encore dans les emplacements
 * globaux historiques (`~/.claude/skills`, `~/.claude/agents`,
 * `~/.codex/skills`), à l'exclusion de ce que fournit un plugin de
 * marketplace (résolu sous `~/.claude/plugins` ou `~/.codex/plugins`) — la
 * bascule du plugin gouverne ce cas, pas nous. `adoptGlobalComponent` est le
 * seul moyen de les faire entrer dans la bibliothèque ; jamais automatique.
 * Codex n'a pas encore de plugins de marketplace au moment de ce
 * commentaire ; `~/.codex/agents` n'est donc pas encore couvert par
 * `globalLeftovers`, ce qui reste cohérent tant que ce chemin n'existe que
 * depuis peu côté Codex.
 */
const fs = require('node:fs');
const path = require('node:path');
const TOML = require('@iarna/toml');
const matter = require('gray-matter');

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
        codex: fs.existsSync(path.join(workspacePath, '.codex', 'agents', `${id}.toml`)),
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

function leftoversFrom(dir, { assistant, family, pluginsRoot, userHome, format }) {
  const entries = family === 'agent' ? listAgentEntries(dir, { format }) : listSkillEntries(dir);
  const result = [];
  for (const entry of entries) {
    if (classifyPluginOrigin(entry.entryPath, pluginsRoot)) continue;
    const definition = family === 'agent'
      ? readAgentDefinition(entry.entryPath, entry.id, { format })
      : readSkillDefinition(entry.entryPath, entry.id);
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
  const claudeAgents = leftoversFrom(path.join(userHome, '.claude', 'agents'), { assistant: 'claude', family: 'agent', pluginsRoot: claudePluginsRoot, userHome, format: 'markdown' });
  const codexSkills = leftoversFrom(path.join(userHome, '.codex', 'skills'), { assistant: 'codex', family: 'skill', pluginsRoot: codexPluginsRoot, userHome });
  const codexAgents = leftoversFrom(path.join(userHome, '.codex', 'agents'), { assistant: 'codex', family: 'agent', pluginsRoot: codexPluginsRoot, userHome, format: 'toml' });
  return {
    skills: [...claudeSkills, ...codexSkills],
    agents: [...claudeAgents, ...codexAgents],
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
  // La bibliothèque d'agents reste au format markdown quel que soit
  // l'assistant cible ; l'adaptation vers le format TOML de Codex se fait
  // séparément, au moment de l'installation (voir `writeCodexAgentFile`).
  const fromLibrary = safeChildPath(libraryDirs.agents, id, '.md');
  if (fs.existsSync(fromLibrary)) return { path: fromLibrary, isDirectory: false };
  const fromPieceMaker = safeChildPath(pieceMakerDirs.agents, id, '.md');
  if (fs.existsSync(fromPieceMaker)) return { path: fromPieceMaker, isDirectory: false };
  return null;
}

// Convertit un agent markdown de la bibliothèque (entête YAML `name`/
// `description` + corps en instructions libres) vers le format TOML attendu
// par un agent custom Codex (`name`, `description`, `developer_instructions`
// à la racine du document, sans séparation entête/corps).
function convertMarkdownAgentToCodexToml(markdownContent, fallbackId) {
  const parsed = matter(markdownContent, {
    language: 'yaml',
    engines: { js: () => ({}), javascript: () => ({}), json: () => ({}) },
  });
  const data = parsed.data && typeof parsed.data === 'object' ? parsed.data : {};
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackId;
  const description = typeof data.description === 'string' && data.description.trim()
    ? data.description.trim()
    : `Agent PieceMaker « ${name} ».`;
  const developerInstructions = parsed.content.trim() || description;
  return TOML.stringify({ name, description, developer_instructions: developerInstructions });
}

function targetRootFor(workspacePath, assistant, family) {
  if (assistant === 'claude' && family === 'skill') return path.join(workspacePath, '.claude', 'skills');
  if (assistant === 'claude' && family === 'agent') return path.join(workspacePath, '.claude', 'agents');
  if (assistant === 'codex' && family === 'skill') return path.join(workspacePath, '.codex', 'skills');
  if (assistant === 'codex' && family === 'agent') return path.join(workspacePath, '.codex', 'agents');
  throw new ActivationError(400, 'Combinaison assistant/famille inconnue.');
}

function installLibraryComponent({ workspacePath, assistant, family, id, installed, repoRoot, piecemakerHome, userHome }) {
  const root = targetRootFor(workspacePath, assistant, family);
  const suffix = family === 'agent' ? (assistant === 'codex' ? '.toml' : '.md') : '';
  const target = safeChildPath(root, id, suffix);

  if (installed) {
    const source = resolveLibrarySource(id, family, { repoRoot, piecemakerHome });
    if (!source) throw new ActivationError(400, 'Composant introuvable dans la bibliothèque.');
    if (family === 'agent' && assistant === 'codex') {
      // Un agent Codex n'est pas une copie octet-pour-octet de la source :
      // c'est une conversion de format. On écrit directement le TOML généré
      // plutôt que de passer par `copyComponent`, qui ne fait que copier un
      // fichier ou un dossier tel quel.
      const markdownContent = fs.readFileSync(source.path, 'utf8');
      const tomlContent = convertMarkdownAgentToCodexToml(markdownContent, id);
      removeIfExists(target);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, tomlContent, 'utf8');
    } else {
      copyComponent(source.path, target, { isDirectory: source.isDirectory });
    }
  } else {
    removeIfExists(target);
  }

  const library = buildLibrary(workspacePath, { repoRoot, piecemakerHome, userHome });
  const list = family === 'skill' ? library.skills : library.agents;
  return list.find((item) => item.id === id) ?? null;
}

function adoptGlobalComponent({ assistant, family, id, userHome, piecemakerHome }) {
  const sourceRoot = family === 'agent'
    ? path.join(userHome, assistant === 'codex' ? '.codex' : '.claude', 'agents')
    : path.join(userHome, assistant === 'codex' ? '.codex' : '.claude', 'skills');
  const suffix = family === 'agent' ? (assistant === 'codex' ? '.toml' : '.md') : '';
  const source = safeChildPath(sourceRoot, id, suffix);
  if (!fs.existsSync(source)) {
    throw new ActivationError(400, 'Composant introuvable.');
  }
  const pluginsRoot = assistant === 'codex' ? path.join(userHome, '.codex', 'plugins') : path.join(userHome, '.claude', 'plugins');
  if (classifyPluginOrigin(source, pluginsRoot)) {
    throw new ActivationError(400, 'Fourni par un plugin de marketplace : c’est la bascule du plugin qui gouverne, pas l’adoption.');
  }

  // La bibliothèque d'agents reste au format markdown : un agent Codex
  // orphelin (TOML) ne peut pas être « adopté » tel quel dans une
  // bibliothèque markdown sans perdre `developer_instructions` de manière
  // silencieuse. Tant qu'aucune conversion inverse n'est implémentée,
  // l'adoption d'un agent Codex est refusée explicitement plutôt que de
  // produire une bibliothèque incohérente.
  if (family === 'agent' && assistant === 'codex') {
    throw new ActivationError(400, 'L’adoption d’un agent Codex (TOML) dans la bibliothèque n’est pas encore prise en charge.');
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
