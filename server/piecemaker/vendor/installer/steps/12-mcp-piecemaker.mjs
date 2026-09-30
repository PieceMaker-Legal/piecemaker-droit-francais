/**
 * Étape 12 — serveur MCP « piecemaker » (conversion, fiches du dossier).
 *
 * Les commandes de conversion sont aujourd'hui présentées au
 * modèle par du texte injecté dans les templates, sans rien qui relie ce
 * texte au binaire : une commande renommée laisserait plusieurs fichiers en
 * dérive silencieuse. `mcp/piecemaker/server.mjs` les expose comme outils
 * MCP typés à la place — chaque outil lance le binaire `piecemaker` en
 * sous-processus, jamais les modules internes, donc pas de dérive possible.
 *
 * Cette étape l'enregistre auprès de chaque assistant présent, en portée
 * utilisateur (proposé dans toutes les sessions, y compris hors dossier
 * juridique — les outils échouent alors proprement) :
 *
 * - Claude Code, par `claude mcp add` ;
 * - Codex, dans `config.toml` de `CODEX_HOME` (`~/.codex`) : l'application le
 *   lance par son SDK, qui embarque son binaire, donc sans commande `codex`
 *   forcément présente — le dossier de configuration suffit à le détecter ;
 * - Mistral Vibe, dans `config.toml` de `VIBE_HOME` (`~/.vibe`), qui n'a pas
 *   de commande d'enregistrement.
 *
 * Un assistant absent est ignoré, jamais une erreur.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { log } from '../lib/ui.mjs';
import { REPO_ROOT, commandExists, run, runCapture } from '../lib/platform.mjs';

export const meta = {
  id: '12-mcp-piecemaker',
  label: 'Serveur MCP piecemaker (conversion, fiches du dossier)',
  description: 'Enregistre dans Claude Code, Codex et Mistral Vibe le serveur MCP qui expose la conversion et les fiches du dossier',
};

const SERVER_NAME = 'piecemaker';
const SERVER_COMMAND = 'node';
export const SERVER_PATH = path.join(REPO_ROOT, 'mcp', 'piecemaker', 'server.mjs');

function dependencies(overrides = {}) {
  return {
    commandExists,
    existsSync: fs.existsSync,
    readFile: (file) => fs.readFileSync(file, 'utf8'),
    writeFile: (file, content) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.piecemaker-${process.pid}.tmp`;
      fs.writeFileSync(temporary, content, 'utf8');
      fs.renameSync(temporary, file);
    },
    loadToml: async () => (await import('@iarna/toml')).default,
    homeDir: os.homedir(),
    env: process.env,
    runCapture,
    run,
    log,
    ...overrides,
  };
}

const objectRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
const pointsHere = (entry) => entry?.command === SERVER_COMMAND
  && Array.isArray(entry.args) && entry.args.length === 1 && entry.args[0] === SERVER_PATH;

export function codexHome(ops) {
  return ops.env.CODEX_HOME || path.join(ops.homeDir, '.codex');
}

export function vibeHome(ops) {
  return ops.env.VIBE_HOME || path.join(ops.homeDir, '.vibe');
}

/** `[mcp_servers.piecemaker]` : seules la commande et ses arguments sont fixés, le reste est conservé. */
export function codexWithServer(config) {
  const servers = objectRecord(config.mcp_servers);
  const current = objectRecord(servers[SERVER_NAME]);
  if (pointsHere(current)) return { config, changed: false };
  return {
    config: { ...config, mcp_servers: { ...servers, [SERVER_NAME]: { ...current, command: SERVER_COMMAND, args: [SERVER_PATH] } } },
    changed: true,
  };
}

/** `[[mcp_servers]]` de Vibe : une entrée nommée, transport stdio. */
export function vibeWithServer(config) {
  const servers = Array.isArray(config.mcp_servers) ? config.mcp_servers : [];
  const index = servers.findIndex((entry) => entry?.name === SERVER_NAME);
  const current = index >= 0 ? servers[index] : {};
  if (current.transport === 'stdio' && pointsHere(current)) return { config, changed: false };
  const entry = { ...current, name: SERVER_NAME, transport: 'stdio', command: SERVER_COMMAND, args: [SERVER_PATH] };
  const next = index >= 0 ? servers.map((server, position) => (position === index ? entry : server)) : [...servers, entry];
  return { config: { ...config, mcp_servers: next }, changed: true };
}

/**
 * Un client par assistant, chacun rendant `{ applicable, current }` au
 * diagnostic et `{ status, note }` à l'installation.
 */
function providers(ops) {
  const tomlProvider = (label, file, withServer) => ({
    label,
    async inspect() {
      if (!ops.existsSync(file)) return { current: false, config: {} };
      const TOML = await ops.loadToml();
      const config = TOML.parse(ops.readFile(file));
      return { current: !withServer(config).changed, config };
    },
    async register(ctx) {
      let inspected;
      try {
        inspected = await this.inspect();
      } catch (error) {
        return { status: 'failed', note: `${label} : ${file} illisible (${error.message}), laissé intact.` };
      }
      if (inspected.current) {
        ops.log.ok(`Serveur MCP « ${SERVER_NAME} » déjà enregistré pour ${label}.`);
        return { status: 'done', note: '' };
      }
      if (ctx.dryRun) {
        ops.log.info(`[simulation] enregistrement du serveur MCP « ${SERVER_NAME} » dans ${file}`);
        return { status: 'skipped', note: '' };
      }
      const TOML = await ops.loadToml();
      ops.writeFile(file, TOML.stringify(withServer(inspected.config).config));
      ops.log.ok(`Serveur MCP « ${SERVER_NAME} » enregistré pour ${label}.`);
      return { status: 'done', note: '', changed: true };
    },
  });

  return [
    {
      label: 'Claude Code',
      applicable: () => ops.commandExists('claude', ['--version']),
      async inspect() {
        // `claude mcp get` n'a pas de sortie JSON : on cherche le chemin
        // attendu dans le texte, ce qui distingue « à jour » d'« ailleurs ».
        const result = ops.runCapture('claude', ['mcp', 'get', SERVER_NAME]);
        if (result.code !== 0) return { present: false, current: false };
        return { present: true, current: result.stdout.includes(SERVER_PATH) };
      },
      async register(ctx) {
        const existing = await this.inspect();
        if (existing.current) {
          ops.log.ok(`Serveur MCP « ${SERVER_NAME} » déjà enregistré pour Claude Code.`);
          return { status: 'done', note: '' };
        }
        if (ctx.dryRun) {
          ops.log.info(existing.present
            ? `[simulation] réenregistrement du serveur MCP « ${SERVER_NAME} » dans Claude Code (il pointe actuellement ailleurs)`
            : `[simulation] enregistrement du serveur MCP « ${SERVER_NAME} » dans Claude Code`);
          return { status: 'skipped', note: '' };
        }
        // Comparer et écraser si différent, jamais passer parce que c'est déjà
        // présent : un autre clone ou un chemin périmé laisserait les outils MCP
        // pointer vers un binaire qui n'est plus celui que l'on développe ici.
        if (existing.present) {
          const removed = await ops.run('claude', ['mcp', 'remove', SERVER_NAME, '-s', 'user']);
          if (removed !== 0) {
            return { status: 'failed', note: `Claude Code : ancien enregistrement non retiré. À la main : claude mcp remove ${SERVER_NAME} -s user` };
          }
          ops.log.detail(`Ancien enregistrement Claude Code de « ${SERVER_NAME} » retiré (il pointait ailleurs).`);
        }
        const added = await ops.run('claude', ['mcp', 'add', '-s', 'user', SERVER_NAME, '--', SERVER_COMMAND, SERVER_PATH]);
        if (added !== 0) {
          return { status: 'failed', note: `Claude Code : échec de l'enregistrement. À la main : claude mcp add -s user ${SERVER_NAME} -- ${SERVER_COMMAND} ${SERVER_PATH}` };
        }
        ops.log.ok(`Serveur MCP « ${SERVER_NAME} » enregistré pour Claude Code.`);
        return { status: 'done', note: '', changed: true };
      },
    },
    {
      ...tomlProvider('Codex', path.join(codexHome(ops), 'config.toml'), codexWithServer),
      applicable: () => ops.existsSync(codexHome(ops)) || ops.commandExists('codex', ['--version']),
    },
    {
      ...tomlProvider('Mistral Vibe', path.join(vibeHome(ops), 'config.toml'), vibeWithServer),
      applicable: () => ops.existsSync(vibeHome(ops)) || ops.commandExists('vibe', ['--version']),
    },
  ];
}

function summarize(results, emptyNote) {
  if (!results.length) return { status: 'skipped', note: emptyNote };
  const failed = results.filter(({ result }) => result.status === 'failed');
  const notes = results.map(({ result }) => result.note).filter(Boolean).join(' ');
  if (!failed.length) {
    if (results.every(({ result }) => result.status === 'skipped')) return { status: 'skipped', note: notes || 'Mode simulation — aucune modification effectuée.' };
    return { status: 'done', note: notes };
  }
  return { status: failed.length === results.length ? 'failed' : 'partial', note: notes };
}

const NO_ASSISTANT = 'Aucun assistant détecté (Claude Code, Codex, Mistral Vibe) — installez-en un puis relancez cette étape.';

export async function install(ctx, overrides = {}) {
  const ops = dependencies(overrides);
  if (!ops.existsSync(SERVER_PATH)) {
    return { status: 'skipped', note: `Serveur MCP introuvable : ${SERVER_PATH}.` };
  }
  const results = [];
  for (const provider of providers(ops)) {
    if (!provider.applicable()) continue;
    results.push({ provider: provider.label, result: await provider.register(ctx) });
  }
  const summary = summarize(results, NO_ASSISTANT);
  if (summary.status === 'done' && results.some(({ result }) => result.changed)) {
    summary.note = [summary.note, 'Relancez les sessions ouvertes pour voir les nouveaux outils.'].filter(Boolean).join(' ');
  }
  return summary;
}

export async function check(_ctx, overrides = {}) {
  const ops = dependencies(overrides);
  if (!ops.existsSync(SERVER_PATH)) {
    return { status: 'skipped', note: `Serveur MCP introuvable : ${SERVER_PATH}.` };
  }
  const missing = [];
  let applicable = 0;
  for (const provider of providers(ops)) {
    if (!provider.applicable()) continue;
    applicable += 1;
    try {
      if (!(await provider.inspect()).current) missing.push(provider.label);
    } catch (error) {
      missing.push(`${provider.label} (${error.message})`);
    }
  }
  if (!applicable) return { status: 'skipped', note: NO_ASSISTANT };
  if (missing.length) {
    return { status: 'failed', note: `Serveur MCP « ${SERVER_NAME} » absent ou pointant ailleurs que ce dépôt pour : ${missing.join(', ')}.` };
  }
  return { status: 'done', note: '' };
}
