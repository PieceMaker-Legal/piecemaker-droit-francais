#!/usr/bin/env node
import http from 'node:http';
import path from 'node:path';
import { loadPieceMakerConfig, readHookPayload } from './lib/hook-io.mjs';

const PROBE_TIMEOUT_MS = 400;
const STDIN_TIMEOUT_MS = 1000;
const FLUSH_TIMEOUT_MS = 1000;
const VERT = '\u001b[32m';
const ROUGE = '\u001b[31m';
const RESET = '\u001b[0m';

function routedProxy() {
  try {
    const url = new URL(process.env.HTTPS_PROXY || process.env.https_proxy || '');
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

function proxyHealthy(proxy) {
  return new Promise((resolve) => {
    const request = http.get({ hostname: proxy.hostname, port: proxy.port, path: '/health', timeout: PROBE_TIMEOUT_MS }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => { request.destroy(); resolve(false); });
    request.on('error', () => resolve(false));
  });
}

function colore(texte, couleur) {
  return process.env.NO_COLOR ? texte : `${couleur}${texte}${RESET}`;
}

async function badge() {
  const proxy = routedProxy();
  if (!proxy) return colore('⚠️ Anonymisation PieceMaker inactive — accès direct', ROUGE);
  if (await proxyHealthy(proxy)) return colore('🔒 Anonymisation PieceMaker active ✓', VERT);
  return colore('⛔ Anonymisation PieceMaker indisponible — requêtes bloquées (relancer piecemaker)', ROUGE);
}

function printAndExit(text) {
  const guard = setTimeout(() => process.exit(0), FLUSH_TIMEOUT_MS);
  guard.unref?.();
  try {
    process.stdout.write(`${text}\n`, () => {
      clearTimeout(guard);
      process.exit(0);
    });
  } catch {
    clearTimeout(guard);
    process.exit(0);
  }
}

function safeCwdName(cwd) {
  try {
    const value = String(cwd || process.cwd());
    return path.basename(value) || value;
  } catch {
    return '';
  }
}

async function main() {
  const payload = await readHookPayload(STDIN_TIMEOUT_MS).catch(() => null);
  const dirName = safeCwdName(payload?.workspace?.current_dir || payload?.cwd);
  const modelName = typeof payload?.model?.display_name === 'string' ? payload.model.display_name : '';
  let disabled = false;
  try {
    disabled = loadPieceMakerConfig()?.anonymizer?.enabled === false;
  } catch {
    disabled = false;
  }
  const parts = [disabled ? 'Anonymisation PieceMaker désactivée' : await badge()];
  if (dirName) parts.push(dirName);
  if (modelName) parts.push(modelName);
  printAndExit(parts.join(' · '));
}

main().catch(() => {
  printAndExit(safeCwdName(process.cwd()));
});
