/**
 * Enregistrement local des skills PieceMaker pour la CLI Codex.
 *
 * Les dossiers sont liés dans ~/.codex/skills afin que les modifications du
 * dépôt soient immédiatement visibles. Une copie est utilisée lorsque les
 * liens symboliques sont indisponibles. Un skill personnel homonyme n'est
 * jamais remplacé.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import TOML from '@iarna/toml';

const PLUGIN_DIRECTORY = 'piecemaker-plugin';
const PLUGIN_SKILL_PATH = /(^|[\\/])piecemaker-plugin[\\/]skills[\\/][^\\/]+$/;

function pluginRoot(repoRoot) {
  return path.join(repoRoot, PLUGIN_DIRECTORY);
}

function codexSkillsDirectory(userHome) {
  return path.join(userHome, '.codex', 'skills');
}

function receiptFile(userHome) {
  return path.join(userHome, '.codex', '.piecemaker-skills.json');
}

export function codexHooksFile(userHome = os.homedir()) {
  return path.join(userHome, '.codex', 'hooks.json');
}

function readCodexHooks(userHome, event = 'PreToolUse') {
  const file = codexHooksFile(userHome);
  if (!fs.existsSync(file)) return { file, document: { hooks: {} } };
  try {
    const document = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      return { file, error: 'hooks-invalides' };
    }
    if (document.hooks === undefined) document.hooks = {};
    if (!document.hooks || typeof document.hooks !== 'object' || Array.isArray(document.hooks)
      || (document.hooks[event] !== undefined && !Array.isArray(document.hooks[event]))) {
      return { file, error: 'hooks-invalides' };
    }
    return { file, document };
  } catch {
    return { file, error: 'hooks-json-invalide' };
  }
}

/** Même script que la protection Claude Code : contrat PreToolUse deny identique. */
function codexProtectionScript(repoRoot) {
  return path.join(pluginRoot(repoRoot), 'scripts', 'protect-originals.mjs');
}

function isPieceMakerProtection(handler) {
  const command = typeof handler?.command === 'string' ? handler.command : '';
  const commandWindows = typeof handler?.commandWindows === 'string' ? handler.commandWindows : '';
  return (command.includes('protect-originals.mjs') || commandWindows.includes('protect-originals.mjs'))
    && (command.includes('PIECEMAKER_HOOK_CLIENT=codex') || commandWindows.includes('PIECEMAKER_HOOK_CLIENT=codex'));
}

function codexProtectionGroup(repoRoot) {
  const script = codexProtectionScript(repoRoot);
  return {
    matcher: '*',
    hooks: [{
      type: 'command',
      command: `PIECEMAKER_HOOK_CLIENT=codex node ${JSON.stringify(script)}`,
      commandWindows: `set "PIECEMAKER_HOOK_CLIENT=codex" && node ${JSON.stringify(script)}`,
      timeout: 5,
      statusMessage: 'Protection des pièces originales PieceMaker',
    }],
  };
}

export function codexProtectionHookStatus(repoRoot, userHome = os.homedir()) {
  return codexHookGroupStatus(userHome, codexProtectionGroup(repoRoot), isPieceMakerProtection);
}

export function codexLegalSearchHookStatus(repoRoot, userHome = os.homedir()) {
  return codexHookGroupStatus(userHome, codexLegalSearchGroup(repoRoot), isPieceMakerLegalSearch);
}

function codexHookGroupStatus(userHome, expected, owned, event = 'PreToolUse') {
  const loaded = readCodexHooks(userHome, event);
  if (loaded.error) return { ok: false, changed: false, file: loaded.file, reason: loaded.error };
  const groups = Array.isArray(loaded.document.hooks[event])
    ? loaded.document.hooks[event]
    : [];
  const managed = groups.flatMap((group) => Array.isArray(group?.hooks) ? group.hooks : [])
    .filter(owned);
  const exact = groups.some((group) => group?.matcher === expected.matcher
    && Array.isArray(group.hooks)
    && group.hooks.some((handler) => JSON.stringify(handler) === JSON.stringify(expected.hooks[0])));
  return {
    ok: exact && managed.length === 1,
    changed: false,
    file: loaded.file,
    reason: exact && managed.length === 1 ? null : 'hook-absent-ou-perime',
  };
}

/** Fusionne uniquement le refus PreToolUse de lecture des pièces ; tous les hooks personnels sont conservés. */
export function installCodexProtectionHook(repoRoot, userHome = os.homedir()) {
  return installCodexHookGroup(userHome, codexProtectionGroup(repoRoot), isPieceMakerProtection);
}

function isPieceMakerLegalSearch(handler) {
  const command = typeof handler?.command === 'string' ? handler.command : '';
  return command.includes('guard-legal-search.mjs') && command.includes('PIECEMAKER_HOOK_CLIENT=codex');
}

function codexLegalSearchGroup(repoRoot) {
  const script = path.join(pluginRoot(repoRoot), 'scripts', 'guard-legal-search.mjs');
  return {
    matcher: 'mcp__.*legifrance.*__Search_.*',
    hooks: [{
      type: 'command',
      command: `PIECEMAKER_HOOK_CLIENT=codex node ${JSON.stringify(script)}`,
      commandWindows: `set "PIECEMAKER_HOOK_CLIENT=codex" && node ${JSON.stringify(script)}`,
      timeout: 5,
      statusMessage: 'Recherche Légifrance réservée à research-maker',
    }],
  };
}

/** Réserve les recherches Légifrance au sous-agent research-maker ; tous les hooks personnels sont conservés. */
export function installCodexLegalSearchHook(repoRoot, userHome = os.homedir()) {
  return installCodexHookGroup(userHome, codexLegalSearchGroup(repoRoot), isPieceMakerLegalSearch);
}

function isPieceMakerOntologyGuard(handler) {
  const command = typeof handler?.command === 'string' ? handler.command : '';
  return command.includes('guard-ontologie.mjs') && command.includes('PIECEMAKER_HOOK_CLIENT=codex');
}

function codexOntologyGuardGroup(repoRoot) {
  const script = path.join(pluginRoot(repoRoot), 'scripts', 'guard-ontologie.mjs');
  return {
    matcher: '^(Bash|apply_patch)$',
    hooks: [{
      type: 'command',
      command: `PIECEMAKER_HOOK_CLIENT=codex node ${JSON.stringify(script)}`,
      commandWindows: `set "PIECEMAKER_HOOK_CLIENT=codex" && node ${JSON.stringify(script)}`,
      timeout: 30,
      statusMessage: 'Ontologie, arborescence et fiches OKF : modification transformée en proposition pour l’avocat',
    }],
  };
}

export function installCodexOntologyGuardHook(repoRoot, userHome = os.homedir()) {
  return installCodexHookGroup(userHome, codexOntologyGuardGroup(repoRoot), isPieceMakerOntologyGuard);
}

export function codexOntologyGuardHookStatus(repoRoot, userHome = os.homedir()) {
  return codexHookGroupStatus(userHome, codexOntologyGuardGroup(repoRoot), isPieceMakerOntologyGuard);
}

function isPieceMakerSubagentCheck(handler) {
  const command = typeof handler?.command === 'string' ? handler.command : '';
  return command.includes('verify-subagent.mjs') && command.includes('PIECEMAKER_HOOK_CLIENT=codex');
}

function codexSubagentCheckGroup(repoRoot) {
  const script = path.join(pluginRoot(repoRoot), 'scripts', 'verify-subagent.mjs');
  return {
    matcher: '^(premise-maker|index-maker|research-maker|deep-research-maker)$',
    hooks: [{
      type: 'command',
      command: `PIECEMAKER_HOOK_CLIENT=codex node ${JSON.stringify(script)}`,
      commandWindows: `set "PIECEMAKER_HOOK_CLIENT=codex" && node ${JSON.stringify(script)}`,
      timeout: 60,
      statusMessage: 'Vérification du travail du sous-agent PieceMaker',
    }],
  };
}

/** Vérifie l'index OKF ou les décisions citées avant qu'un sous-agent PieceMaker ne rende son compte rendu. */
export function installCodexSubagentCheckHook(repoRoot, userHome = os.homedir()) {
  return installCodexHookGroup(userHome, codexSubagentCheckGroup(repoRoot), isPieceMakerSubagentCheck, 'SubagentStop');
}

export function codexSubagentCheckHookStatus(repoRoot, userHome = os.homedir()) {
  return codexHookGroupStatus(userHome, codexSubagentCheckGroup(repoRoot), isPieceMakerSubagentCheck, 'SubagentStop');
}

function isPieceMakerHerisson(handler) {
  const command = typeof handler?.command === 'string' ? handler.command : '';
  return /(feature-hook|herisson)\.mjs/.test(command) && command.includes('PIECEMAKER_HOOK_CLIENT=codex');
}

function codexHerissonGroup(repoRoot) {
  const script = path.join(pluginRoot(repoRoot), 'scripts', 'herisson.mjs');
  return {
    matcher: '^(Bash|apply_patch|mcp__features__Feature)$',
    hooks: [{
      type: 'command',
      command: `PIECEMAKER_HOOK_CLIENT=codex node ${JSON.stringify(script)}`,
      commandWindows: `set "PIECEMAKER_HOOK_CLIENT=codex" && node ${JSON.stringify(script)}`,
      timeout: 90,
      statusMessage: 'Le Hérisson : vérification du fichier PieceMaker modifié',
    }],
  };
}

/** Lance le vérificateur de la feature (herisson.json, le Hérisson) après chaque écriture de l'agent. */
export function installCodexHerissonHook(repoRoot, userHome = os.homedir()) {
  return installCodexHookGroup(userHome, codexHerissonGroup(repoRoot), isPieceMakerHerisson, 'PostToolUse');
}

export function codexHerissonHookStatus(repoRoot, userHome = os.homedir()) {
  return codexHookGroupStatus(userHome, codexHerissonGroup(repoRoot), isPieceMakerHerisson, 'PostToolUse');
}

function codexHerissonTurnEndGroup(repoRoot) {
  const [hook] = codexHerissonGroup(repoRoot).hooks;
  return { hooks: [{ ...hook, statusMessage: 'Le Hérisson : erreurs restantes en fin de tour' }] };
}

export function installCodexHerissonTurnEndHook(repoRoot, userHome = os.homedir()) {
  return installCodexHookGroup(userHome, codexHerissonTurnEndGroup(repoRoot), isPieceMakerHerisson, 'Stop');
}

export function codexHerissonTurnEndHookStatus(repoRoot, userHome = os.homedir()) {
  return codexHookGroupStatus(userHome, codexHerissonTurnEndGroup(repoRoot), isPieceMakerHerisson, 'Stop');
}

function installCodexHookGroup(userHome, expected, owned, event = 'PreToolUse') {
  const loaded = readCodexHooks(userHome, event);
  if (loaded.error) return { ok: false, changed: false, file: loaded.file, reason: loaded.error };
  const document = loaded.document;
  const groups = Array.isArray(document.hooks[event])
    ? document.hooks[event]
    : [];
  const preserved = [];
  for (const group of groups) {
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      preserved.push(group);
      continue;
    }
    const hooks = Array.isArray(group.hooks) ? group.hooks.filter((handler) => !owned(handler)) : [];
    if (hooks.length || !Array.isArray(group.hooks)) preserved.push({ ...group, hooks });
  }
  document.description ||= 'Hooks locaux Codex, dont la protection des pièces PieceMaker.';
  document.hooks[event] = [...preserved, expected];
  const output = `${JSON.stringify(document, null, 2)}\n`;
  let current = null;
  try { current = fs.readFileSync(loaded.file, 'utf8'); } catch { /* fichier absent */ }
  if (current === output) return { ok: true, changed: false, file: loaded.file, registered: 1 };
  try {
    fs.mkdirSync(path.dirname(loaded.file), { recursive: true });
    const temporary = `${loaded.file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, output, 'utf8');
    fs.renameSync(temporary, loaded.file);
    return { ok: true, changed: true, file: loaded.file, registered: 1 };
  } catch (error) {
    return { ok: false, changed: false, file: loaded.file, reason: error?.message || 'ecriture-impossible' };
  }
}

const PIECEMAKER_HOOKS = [isPieceMakerProtection, isPieceMakerLegalSearch, isPieceMakerOntologyGuard, isPieceMakerSubagentCheck, isPieceMakerHerisson];
const CODEX_EVENT_KEYS = { PreToolUse: 'pre_tool_use', PostToolUse: 'post_tool_use', SubagentStop: 'subagent_stop', Stop: 'stop' };

function sortedKeys(value) {
  if (Array.isArray(value)) return value.map(sortedKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedKeys(value[key])]));
}

export function codexHookTrustedHash(event, matcher, handler, platform = process.platform) {
  const hook = {
    type: 'command',
    command: platform === 'win32' && handler.commandWindows ? handler.commandWindows : handler.command,
    timeout: Math.max(1, handler.timeout ?? 600),
    async: handler.async === true,
    ...(handler.statusMessage === undefined ? {} : { statusMessage: handler.statusMessage }),
  };
  const identity = { event_name: CODEX_EVENT_KEYS[event], ...(matcher == null ? {} : { matcher }), hooks: [hook] };
  return `sha256:${createHash('sha256').update(JSON.stringify(sortedKeys(identity))).digest('hex')}`;
}

function pieceMakerHookTrust(file, document) {
  const entries = [];
  for (const [event, label] of Object.entries(CODEX_EVENT_KEYS)) {
    const groups = Array.isArray(document.hooks[event]) ? document.hooks[event] : [];
    groups.forEach((group, groupIndex) => {
      const handlers = Array.isArray(group?.hooks) ? group.hooks : [];
      handlers.forEach((handler, handlerIndex) => {
        if (handler?.type === 'command' && PIECEMAKER_HOOKS.some((owned) => owned(handler))) {
          entries.push([`${file}:${label}:${groupIndex}:${handlerIndex}`, codexHookTrustedHash(event, group.matcher, handler)]);
        }
      });
    });
  }
  return entries;
}

function withTrustedHash(text, key, hash) {
  const headers = [`[hooks.state.${JSON.stringify(key)}]`, `[hooks.state.'${key}']`];
  const line = `trusted_hash = ${JSON.stringify(hash)}`;
  const lines = text.split('\n');
  const start = lines.findIndex((entry) => headers.includes(entry.trim()));
  if (start === -1) return `${text}${text && !text.endsWith('\n') ? '\n' : ''}\n${headers[0]}\n${line}\n`;
  const next = lines.findIndex((entry, index) => index > start && /^\s*\[/.test(entry));
  const end = next === -1 ? lines.length : next;
  const at = lines.findIndex((entry, index) => index > start && index < end && /^\s*trusted_hash\s*=/.test(entry));
  if (at === -1) lines.splice(start + 1, 0, line);
  else lines[at] = line;
  return lines.join('\n');
}

export function codexConfigFile(userHome = os.homedir()) {
  return path.join(userHome, '.codex', 'config.toml');
}

export function trustCodexHooks(userHome = os.homedir()) {
  const loaded = readCodexHooks(userHome);
  if (loaded.error) return { ok: false, changed: false, file: loaded.file, reason: loaded.error };
  const file = codexConfigFile(userHome);
  const entries = pieceMakerHookTrust(loaded.file, loaded.document);
  let current = '';
  try { current = fs.readFileSync(file, 'utf8'); } catch { current = ''; }
  const output = entries.reduce((text, [key, hash]) => withTrustedHash(text, key, hash), current);
  try {
    const state = TOML.parse(output).hooks?.state ?? {};
    if (!entries.every(([key, hash]) => state[key]?.trusted_hash === hash)) throw new Error('approbation-illisible');
  } catch {
    return { ok: false, changed: false, file, reason: 'config-toml-non-modifiable' };
  }
  if (output === current) return { ok: true, changed: false, file, trusted: entries.length };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, output, 'utf8');
    fs.renameSync(temporary, file);
    return { ok: true, changed: true, file, trusted: entries.length };
  } catch (error) {
    return { ok: false, changed: false, file, reason: error?.message || 'ecriture-impossible' };
  }
}

function readReceipt(userHome) {
  try {
    const parsed = JSON.parse(fs.readFileSync(receiptFile(userHome), 'utf8'));
    return parsed && typeof parsed.copies === 'object' && parsed.copies ? parsed.copies : {};
  } catch {
    return {};
  }
}

function rememberCopy(userHome, skill) {
  const copies = readReceipt(userHome);
  copies[skill.slug] = skill.source;
  try {
    fs.writeFileSync(receiptFile(userHome), `${JSON.stringify({ version: 1, copies }, null, 2)}\n`);
  } catch {
    // Le reçu facilite les mises à jour mais n'est pas requis pour charger le skill.
  }
}

function linkTarget(entry) {
  try {
    if (!fs.lstatSync(entry).isSymbolicLink()) return null;
    return path.resolve(path.dirname(entry), fs.readlinkSync(entry));
  } catch {
    return null;
  }
}

function samePath(left, right) {
  const resolve = (value) => {
    try {
      return fs.realpathSync(value);
    } catch {
      return path.resolve(value);
    }
  };
  return resolve(left) === resolve(right);
}

function codexSkillOf(repoRoot, userHome, relativePath) {
  const normalized = String(relativePath || '').replaceAll('\\', '/').replace(/^\.\//, '');
  const match = normalized.match(/^piecemaker-plugin\/skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/SKILL\.md$/);
  if (!match) return null;
  return {
    slug: match[1],
    source: path.join(pluginRoot(repoRoot), 'skills', match[1]),
    target: path.join(codexSkillsDirectory(userHome), match[1]),
  };
}

export function repositoryCodexSkills(repoRoot) {
  const directory = path.join(pluginRoot(repoRoot), 'skills');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((slug) => fs.existsSync(path.join(directory, slug, 'SKILL.md')))
    .sort()
    .map((slug) => `${PLUGIN_DIRECTORY}/skills/${slug}/SKILL.md`);
}

export function codexSkillStatus(repoRoot, userHome, relativePath) {
  const skill = codexSkillOf(repoRoot, userHome, relativePath);
  if (!skill) return null;
  const base = { slug: skill.slug, target: skill.target };
  if (!fs.existsSync(skill.source)) return { ...base, state: 'missing' };

  const link = linkTarget(skill.target);
  if (link) {
    if (samePath(link, skill.source)) return { ...base, state: 'linked' };
    return PLUGIN_SKILL_PATH.test(link)
      ? { ...base, state: 'stale', origin: link }
      : { ...base, state: 'conflict' };
  }
  if (!fs.existsSync(skill.target)) return { ...base, state: 'missing' };

  const sourceManifest = path.join(skill.source, 'SKILL.md');
  const targetManifest = path.join(skill.target, 'SKILL.md');
  if (fs.existsSync(targetManifest)
    && fs.readFileSync(sourceManifest, 'utf8') === fs.readFileSync(targetManifest, 'utf8')) {
    return { ...base, state: 'copied' };
  }
  return Object.hasOwn(readReceipt(userHome), skill.slug)
    ? { ...base, state: 'stale' }
    : { ...base, state: 'conflict' };
}

export function registerCodexSkill(repoRoot, userHome, relativePath) {
  const skill = codexSkillOf(repoRoot, userHome, relativePath);
  if (!skill) return null;
  if (fs.existsSync(path.join(process.env.PIECEMAKER_HOME || path.join(userHome, '.piecemaker'), 'library-backend', 'centralized.json'))) return { slug: skill.slug, target: skill.target, state: 'library', note: 'Activation gérée par la bibliothèque.' };
  const current = codexSkillStatus(repoRoot, userHome, relativePath);
  if (current.state === 'linked') return current;
  if (current.state === 'conflict') {
    return {
      ...current,
      note: `Un skill personnel « ${skill.slug} » existe déjà dans ~/.codex/skills.`,
    };
  }

  fs.mkdirSync(path.dirname(skill.target), { recursive: true });
  const existingLink = linkTarget(skill.target);
  if (existingLink) fs.unlinkSync(skill.target);

  if (!existingLink && fs.existsSync(skill.target)) {
    fs.rmSync(skill.target, { recursive: true, force: true });
    fs.cpSync(skill.source, skill.target, { recursive: true, dereference: true });
    rememberCopy(userHome, skill);
    return { slug: skill.slug, target: skill.target, state: 'copied' };
  }

  try {
    fs.symlinkSync(skill.source, skill.target, 'dir');
    return { slug: skill.slug, target: skill.target, state: 'linked' };
  } catch {
    fs.cpSync(skill.source, skill.target, { recursive: true, dereference: true });
    rememberCopy(userHome, skill);
    return { slug: skill.slug, target: skill.target, state: 'copied' };
  }
}

export function syncCodexSkills(repoRoot, userHome = os.homedir()) {
  const skills = repositoryCodexSkills(repoRoot).map((relativePath) => ({
    path: relativePath,
    ...registerCodexSkill(repoRoot, userHome, relativePath),
  }));
  return {
    skills,
    registered: skills.filter((skill) => skill.state === 'linked' || skill.state === 'copied').length,
    conflicts: skills.filter((skill) => skill.state === 'conflict'),
  };
}
