import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const runtime = JSON.parse(fs.readFileSync(new URL('../runtime.json', import.meta.url), 'utf8'));
const requireApp = createRequire(path.join(runtime.applicationRoot, 'package.json'));
const Database = requireApp('better-sqlite3');
const pty = requireApp('node-pty');
const db = new Database(runtime.databasePath);
const channelRoot = path.join(os.homedir(), '.claude', 'channels');
const pluginId = 'telegram@claude-plugins-official';
const sessions = new Map();
let mainLoop = null;
let mainOnline = false;
let mainError = '';
let stopping = false;

db.exec(`CREATE TABLE IF NOT EXISTS piecemaker_telegram_bots (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT UNIQUE,
  token TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  desired INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
)`);

function installed() {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude/plugins/installed_plugins.json'), 'utf8'));
    return Boolean(registry.plugins?.[pluginId]);
  } catch { return false; }
}

function rows() {
  return db.prepare(`SELECT b.id, b.project_id, b.token, b.username, b.owner_id, b.desired, p.project_path,
    COALESCE(p.custom_project_name, p.project_path) AS project_name
    FROM piecemaker_telegram_bots b LEFT JOIN projects p ON p.project_id = b.project_id
    ORDER BY CASE WHEN b.project_id IS NULL THEN 0 ELSE 1 END, project_name`).all();
}

function bot(id) {
  return db.prepare('SELECT * FROM piecemaker_telegram_bots WHERE id = ?').get(id);
}

function stateDirectory(id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Identifiant de bot invalide.');
  return path.join(channelRoot, `piecemaker-telegram-${id}`);
}

function projectSessionIsLive(id) {
  return sessions.has(id);
}

function publicState() {
  return {
    installed: installed(),
    mainOnline,
    mainError,
    projects: db.prepare(`SELECT project_id AS id, project_path AS path,
      COALESCE(custom_project_name, project_path) AS name FROM projects WHERE isArchived = 0 ORDER BY name`).all(),
    bots: rows().map((row) => ({
      id: row.id, projectId: row.project_id, projectName: row.project_name,
      username: row.username, ownerId: row.owner_id, desired: Boolean(row.desired),
      active: row.project_id ? projectSessionIsLive(row.id) : mainOnline,
    })),
  };
}

function projectState(row) {
  const directory = stateDirectory(row.id);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(directory, 'access.json'), JSON.stringify({
    dmPolicy: 'allowlist', allowFrom: [row.owner_id], groups: {},
  }), { mode: 0o600 });
  return directory;
}

async function telegram(row, method, payload, signal) {
  const response = await fetch(`https://api.telegram.org/bot${row.token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(35000)]) : AbortSignal.timeout(35000),
  });
  const result = await response.json();
  if (!result.ok) throw new Error(result.description || `Telegram : HTTP ${response.status}`);
  return result.result;
}

async function sendMain(message) {
  const row = bot('main');
  if (!row) return;
  try { await telegram(row, 'sendMessage', { chat_id: row.owner_id, text: message }); } catch (error) {
    process.stderr.write(`Telegram : ${error.message}\n`);
  }
}

function startSession(row) {
  if (!installed()) throw new Error('Installez d’abord le plugin Telegram dans la bibliothèque.');
  if (!row.project_id || !row.project_path || !fs.existsSync(row.project_path)) throw new Error('Dossier introuvable.');
  if (sessions.has(row.id)) return;
  const directory = projectState(row);
  const child = pty.spawn('claude', [
    '--settings', JSON.stringify({ enabledPlugins: { [pluginId]: true } }),
    '--channels', `plugin:${pluginId}`, '--permission-mode', 'auto',
  ], {
    name: 'xterm-256color', cols: 100, rows: 30, cwd: row.project_path,
    env: { ...process.env, TELEGRAM_STATE_DIR: directory, TELEGRAM_BOT_TOKEN: row.token },
  });
  sessions.set(row.id, child);
  child.onData(() => {});
  child.onExit(() => {
    if (sessions.get(row.id) !== child) return;
    sessions.delete(row.id);
    if (stopping) return;
    db.prepare('UPDATE piecemaker_telegram_bots SET desired = 0 WHERE id = ?').run(row.id);
    void sendMain(`Session arrêtée : ${row.project_name || row.project_path}. Envoyez /launch ${row.id} pour la relancer.`);
  });
}

async function stopSession(id) {
  const child = sessions.get(id);
  sessions.delete(id);
  db.prepare('UPDATE piecemaker_telegram_bots SET desired = 0 WHERE id = ?').run(id);
  if (!child) return;
  let exited = false;
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    child.onExit(() => { exited = true; clearTimeout(timeout); resolve(); });
    child.kill();
  });
  if (!exited) {
    sessions.set(id, child);
    throw new Error('La session ne s’est pas encore arrêtée. Réessayez dans un instant.');
  }
}

function resolveProject(value) {
  const candidate = String(value || '').trim().toLowerCase();
  const matches = rows().filter((row) => row.project_id && (
    row.id.toLowerCase() === candidate || row.username.toLowerCase() === candidate.replace(/^@/, '') ||
    row.project_name?.toLowerCase() === candidate
  ));
  return matches.length === 1 ? matches[0] : null;
}

async function handleMain(message) {
  const row = bot('main');
  if (!row || String(message.from?.id) !== row.owner_id || String(message.chat?.id) !== row.owner_id) return;
  const [command, ...args] = String(message.text || '').trim().split(/\s+/);
  const verb = command?.split('@')[0].toLowerCase();
  if (verb === '/start' || verb === '/help') {
    await sendMain('Commandes : /status, /launch <dossier>, /stop <dossier>, /restart <dossier>. Le bot de chaque dossier sert à discuter avec Claude.');
    return;
  }
  if (verb === '/status') {
    const projects = rows().filter((entry) => entry.project_id);
    await sendMain(projects.length ? projects.map((entry) => `${sessions.has(entry.id) ? '🟢' : '⚪'} ${entry.project_name} — ${entry.id}`).join('\n') : 'Aucun dossier lié.');
    return;
  }
  if (!['/launch', '/stop', '/restart'].includes(verb)) return;
  const project = resolveProject(args.join(' '));
  if (!project) { await sendMain('Dossier inconnu. Envoyez /status pour voir les noms disponibles.'); return; }
  try {
    if (verb !== '/launch') await stopSession(project.id);
    if (verb !== '/stop') {
      startSession(project);
      db.prepare('UPDATE piecemaker_telegram_bots SET desired = 1 WHERE id = ?').run(project.id);
    }
    await sendMain(`${project.project_name} : ${verb === '/stop' ? 'arrêté' : 'démarré'}.`);
  } catch (error) { await sendMain(`${project.project_name} : ${error.message}`); }
}

async function pollMain(row, signal) {
  let offset = 0;
  try {
    const recent = await telegram(row, 'getUpdates', { timeout: 0, offset: -1 }, signal);
    if (signal.aborted) return;
    mainOnline = true;
    mainError = '';
    if (recent.length) offset = recent.at(-1).update_id + 1;
  } catch (error) {
    if (signal.aborted) return;
    mainOnline = false;
    mainError = error.message;
  }
  while (!signal.aborted) {
    try {
      const updates = await telegram(row, 'getUpdates', { timeout: 25, offset }, signal);
      if (signal.aborted) break;
      mainOnline = true;
      mainError = '';
      for (const update of updates) {
        offset = update.update_id + 1;
        if (update.message) await handleMain(update.message);
      }
    } catch (error) {
      if (signal.aborted) break;
      mainOnline = false;
      mainError = error.message;
      process.stderr.write(`Telegram : ${error.message}\n`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

function startMain() {
  if (mainLoop || !bot('main')) return;
  const controller = new AbortController();
  mainLoop = controller;
  void pollMain(bot('main'), controller.signal);
}

function stopMain() {
  mainLoop?.abort();
  mainLoop = null;
  mainOnline = false;
  mainError = '';
}

function installPlugin() {
  if (installed()) return;
  const run = (args) => {
    const result = spawnSync('claude', args, { encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'Installation impossible.').trim());
  };
  if (!fs.existsSync(path.join(os.homedir(), '.claude/plugins/marketplaces/claude-plugins-official'))) {
    run(['plugin', 'marketplace', 'add', 'anthropics/claude-plugins-official']);
  }
  run(['plugin', 'install', pluginId, '--scope', 'user']);
  const settingsPath = path.join(os.homedir(), '.claude/settings.json');
  const settings = fs.existsSync(settingsPath) ? JSON.parse(fs.readFileSync(settingsPath, 'utf8')) : {};
  settings.enabledPlugins = { ...settings.enabledPlugins, [pluginId]: false };
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), { mode: 0o600 });
  if (!installed()) throw new Error('Installation terminée mais le plugin Telegram est introuvable dans la bibliothèque.');
}

async function saveBot(body) {
  const role = body?.role;
  const projectId = role === 'project' ? body?.projectId : null;
  const token = typeof body?.token === 'string' ? body.token.trim() : '';
  const ownerId = String(body?.ownerId || '').trim();
  if (role !== 'main' && role !== 'project') throw new Error('Type de bot invalide.');
  if (!/^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('Jeton BotFather invalide.');
  if (!/^\d{4,20}$/.test(ownerId)) throw new Error('Identifiant Telegram numérique requis.');
  if (role === 'project' && (typeof projectId !== 'string' || !db.prepare('SELECT 1 FROM projects WHERE project_id = ? AND isArchived = 0').get(projectId))) throw new Error('Dossier inconnu.');
  const id = role === 'main' ? 'main' : projectId;
  const existingToken = db.prepare('SELECT id FROM piecemaker_telegram_bots WHERE token = ?').get(token);
  if (existingToken && existingToken.id !== id) throw new Error('Ce bot est déjà lié à un autre dossier.');
  const identity = await telegram({ token }, 'getMe', {});
  if (!identity.is_bot || !identity.username) throw new Error('Ce jeton ne désigne pas un bot Telegram.');
  if (id === 'main') stopMain(); else await stopSession(id);
  db.prepare(`INSERT INTO piecemaker_telegram_bots (id, project_id, token, username, owner_id, desired, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET token = excluded.token, username = excluded.username,
      owner_id = excluded.owner_id, project_id = excluded.project_id, desired = 0`).run(id, projectId, token, identity.username, ownerId, new Date().toISOString());
  if (id === 'main') {
    try { await telegram({ token }, 'setMyCommands', { commands: [
      { command: 'status', description: 'État des dossiers' },
      { command: 'launch', description: 'Démarrer un dossier' },
      { command: 'stop', description: 'Arrêter un dossier' },
      { command: 'restart', description: 'Relancer un dossier' },
      { command: 'help', description: 'Voir les commandes' },
    ] }); } catch (error) { process.stderr.write(`Telegram : ${error.message}\n`); }
    startMain();
  } else projectState(bot(id));
  return publicState();
}

async function removeBot(id) {
  if (!bot(id)) throw new Error('Bot inconnu.');
  if (id === 'main') stopMain(); else await stopSession(id);
  db.prepare('DELETE FROM piecemaker_telegram_bots WHERE id = ?').run(id);
  fs.rmSync(stateDirectory(id), { recursive: true, force: true });
  return publicState();
}

async function setSession(id, action) {
  if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Action inconnue.');
  const row = bot(id);
  if (!row?.project_id) throw new Error('Dossier non lié.');
  if (action === 'stop' || action === 'restart') await stopSession(id);
  if (action === 'start' || action === 'restart') {
    startSession({ ...row, project_path: db.prepare('SELECT project_path FROM projects WHERE project_id = ?').get(row.project_id)?.project_path });
    db.prepare('UPDATE piecemaker_telegram_bots SET desired = 1 WHERE id = ?').run(id);
  }
  return publicState();
}

async function route(method, pathname, body) {
  if (method === 'GET' && pathname === '/state') return publicState();
  if (method === 'POST' && pathname === '/install') { installPlugin(); return publicState(); }
  if (method === 'POST' && pathname === '/bots') return saveBot(body);
  if (method === 'DELETE' && pathname.startsWith('/bots/')) return removeBot(decodeURIComponent(pathname.slice(6)));
  if (method === 'POST' && pathname.startsWith('/sessions/')) return setSession(decodeURIComponent(pathname.slice(10)), body?.action);
  throw new Error('Commande inconnue.');
}

const server = http.createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json; charset=utf-8');
  if (request.headers['x-plugin-secret-access'] !== runtime.secret) {
    response.writeHead(403);
    response.end(JSON.stringify({ error: 'Accès refusé.' }));
    return;
  }
  try {
    let raw = '';
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 4096) throw new Error('Requête trop volumineuse.');
    }
    const payload = raw ? JSON.parse(raw) : undefined;
    const result = await route(request.method, new URL(request.url, 'http://localhost').pathname, payload);
    response.end(JSON.stringify(result));
  } catch (error) {
    response.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(0, '127.0.0.1', () => {
  process.stdout.write(`${JSON.stringify({ ready: true, port: server.address().port })}\n`);
  if (bot('main')) startMain();
  for (const row of rows().filter((entry) => entry.project_id && entry.desired)) {
    try { startSession(row); } catch (error) { process.stderr.write(`Telegram : ${error.message}\n`); }
  }
});

process.on('SIGTERM', () => {
  stopping = true;
  stopMain();
  for (const child of sessions.values()) child.kill();
  sessions.clear();
  server.close();
  db.close();
});
