import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import TOML from '@iarna/toml';

const SHELL = 'bash|git_bash|windows_shell|process\\.start';
const tools = (names) => `re:(file_system\\.)?(${names})`;

export function vibeHooksFile(userHome = os.homedir()) {
  return path.join(userHome, '.vibe', 'hooks.toml');
}

export function vibeHooks(repoRoot) {
  const scripts = path.join(repoRoot, 'piecemaker-plugin', 'scripts');
  const command = (script) => `node ${JSON.stringify(path.join(scripts, 'vibe-hook.mjs'))} ${JSON.stringify(script)}`;
  const plugin = (name) => command(path.join(scripts, name));
  return [
    { name: 'piecemaker-cloisonnement', type: 'pre_tool', match: tools(`read_file|write_file|edit|search_replace|grep|${SHELL}`), command: plugin('cloisonnement.mjs'), strict: true, timeout: 30, description: 'Une session ne touche qu’à son propre dossier' },
    { name: 'piecemaker-protect-originals', type: 'pre_tool', match: tools(`read_file|grep|${SHELL}`), command: plugin('protect-originals.mjs'), strict: true, timeout: 30, description: 'Protection des pièces originales PieceMaker' },
    { name: 'piecemaker-guard-ontologie', type: 'pre_tool', match: tools(`read_file|write_file|edit|search_replace|grep|${SHELL}`), command: plugin('guard-ontologie.mjs'), strict: true, timeout: 30, description: 'Ontologie, arborescence et fiches OKF : proposition pour l’avocat' },
    { name: 'piecemaker-guard-legal-search', type: 'pre_tool', match: 're:.*legifrance.*Search_.*', command: plugin('guard-legal-search.mjs'), strict: true, timeout: 30, description: 'Recherches Légifrance réservées à research-maker' },
    { name: 'piecemaker-guard-secrets', type: 'pre_tool', match: tools(`read_file|write_file|edit|search_replace|grep|${SHELL}`), command: command(path.join(repoRoot, 'installer', 'assets', 'claude-hooks', 'piecemaker-guard-secrets.mjs')), strict: true, timeout: 30, description: 'Fichiers sensibles interdits à l’agent' },
    { name: 'piecemaker-classify-ai-documents', type: 'post_tool', match: tools(`write_file|${SHELL}`), command: plugin('classify-ai-documents.mjs'), timeout: 30, description: 'Documents écrits par l’IA classés en espace de travail' },
    { name: 'piecemaker-herisson', type: 'post_tool', match: tools(`write_file|edit|search_replace|${SHELL}`), command: plugin('herisson.mjs'), timeout: 90, description: 'Le Hérisson : vérification du fichier PieceMaker modifié' },
    { name: 'piecemaker-herisson-fin-de-tour', type: 'post_agent', match: 'main', command: plugin('herisson.mjs'), timeout: 90, description: 'Le Hérisson : rapport complet des erreurs restantes en fin de tour' },
    { name: 'piecemaker-verify-subagent', type: 'post_tool', match: 'task', command: plugin('verify-subagent.mjs'), timeout: 60, description: 'Vérification du travail du sous-agent PieceMaker' },
  ];
}

const owned = (hook) => typeof hook?.name === 'string' && hook.name.startsWith('piecemaker-');

export function installVibeHooks(repoRoot, userHome = os.homedir()) {
  const file = vibeHooksFile(userHome);
  let current = '';
  let document = {};
  try { current = fs.readFileSync(file, 'utf8'); } catch {}
  try { document = current ? TOML.parse(current) : {}; } catch { return { ok: false, changed: false, file, reason: 'hooks-toml-illisible' }; }
  const kept = Array.isArray(document.hooks) ? document.hooks.filter((hook) => !owned(hook)) : [];
  const output = TOML.stringify({ ...document, hooks: [...kept, ...vibeHooks(repoRoot)] });
  if (output === current) return { ok: true, changed: false, file };
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(temporary, output, 'utf8');
    fs.renameSync(temporary, file);
    return { ok: true, changed: true, file };
  } catch (error) {
    return { ok: false, changed: false, file, reason: error?.message || 'ecriture-impossible' };
  }
}
