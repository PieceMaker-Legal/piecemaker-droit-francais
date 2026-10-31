/**
 * Étape 07 — serveur MCP Légifrance embarqué et clés PISTE.
 *
 * Le runtime vit dans server/piecemaker/vendor/mcp/legifrance. L'étape prépare
 * son venv et écrit les identifiants dans le fichier de configuration stable
 * ~/.config/mcp-legifrance/.env (0600). Une copie reste dans le .env PieceMaker
 * pour l'administration et les migrations existantes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { log, spinner, blank, link } from '../lib/ui.mjs';
import { ask, select, confirm, nonInteractive } from '../lib/prompt.mjs';
import { findPython, run, runCapture } from '../lib/platform.mjs';
import { writeEnv } from '../lib/state.mjs';
import { removeExternalLegifrancePlugin, removeLegacyLegifranceService } from '../lib/legacy-legifrance.mjs';

export const meta = {
  id: '07-legifrance',
  label: 'Serveur MCP Légifrance (clés PISTE)',
  description: "Prépare le serveur MCP embarqué et configure l'accès aux API Légifrance et Judilibre via PISTE",
};

const LAUNCHER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'mcp', 'legifrance', 'scripts', 'launcher.py');
const REGISTRATION_URL = 'https://piste.gouv.fr/registration';
const CATALOG_URL = 'https://piste.gouv.fr/api-catalog-all';
const PISTE_ENV = 'production';

const ENDPOINTS = {
  token: 'https://oauth.piste.gouv.fr/api/oauth/token',
  api: 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/',
};

export function legifranceEnvFile(userHome = os.homedir()) {
  return path.join(userHome, '.config', 'mcp-legifrance', '.env');
}

function readSimpleEnv(file) {
  const values = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
      if (match) values[match[1]] = match[2];
    }
  } catch { /* fichier absent */ }
  return values;
}

/** Fusionne les secrets MCP sans écraser les commentaires ni les autres clés. */
export function writeLegifranceEnv(file, values) {
  const existing = new Map();
  const preamble = [];
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
      if (match) existing.set(match[1], match[2]);
      else if (line.trim()) preamble.push(line);
    }
  } catch { /* première installation */ }
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') existing.set(key, String(value));
  }
  const body = [...preamble, ...[...existing].map(([key, value]) => `${key}=${value}`)].join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${body}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  try { fs.chmodSync(file, 0o600); } catch { /* ACL Windows */ }
  return file;
}

async function validatePisteCredentials(clientId, clientSecret, fetchImpl = fetch) {
  let tokenRes;
  try {
    tokenRes = await fetchImpl(ENDPOINTS.token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials', client_id: clientId,
        client_secret: clientSecret, scope: 'openid',
      }),
    });
  } catch (error) {
    return { ok: false, message: `Impossible de joindre le serveur OAuth PISTE (${ENDPOINTS.token}) : ${error.message}` };
  }
  if (!tokenRes.ok) {
    const detail = await tokenRes.text().catch(() => '');
    return {
      ok: false,
      message: `Authentification refusée par PISTE (HTTP ${tokenRes.status}). Vérifiez le Client ID et le Client Secret.${detail ? ` Détail : ${detail.slice(0, 200)}` : ''}`,
    };
  }
  const tokenData = await tokenRes.json().catch(() => null);
  if (!tokenData?.access_token) return { ok: false, message: 'Réponse PISTE invalide : aucun jeton reçu.' };
  let searchRes;
  try {
    searchRes = await fetchImpl(`${ENDPOINTS.api}search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json', Accept: 'application/json',
      },
      body: JSON.stringify({
        fond: 'CODE_DATE',
        recherche: {
          champs: [{ typeChamp: 'ALL', criteres: [{ typeRecherche: 'UN_DES_MOTS', valeur: 'code civil', operateur: 'ET' }], operateur: 'ET' }],
          filtres: [], pageNumber: 1, pageSize: 1, operateur: 'ET',
          sort: 'SIGNATURE_DATE_DESC', typePagination: 'DEFAUT',
        },
      }),
    });
  } catch (error) {
    return { ok: false, message: `Jeton obtenu, mais API Légifrance injoignable : ${error.message}` };
  }
  if (!searchRes.ok) {
    const detail = await searchRes.text().catch(() => '');
    return {
      ok: false,
      message: `Jeton obtenu, mais la requête Légifrance a échoué (HTTP ${searchRes.status}). Vérifiez la souscription PISTE.${detail ? ` Détail : ${detail.slice(0, 200)}` : ''}`,
    };
  }
  return { ok: true };
}

function dependencies(overrides = {}) {
  return {
    userHome: os.homedir(), log, run, runCapture, findPython,
    writeEnv, writeLegifranceEnv, validatePisteCredentials,
    ask, select, confirm, nonInteractive,
    ...overrides,
  };
}

async function prepareServer(ops) {
  if (!fs.existsSync(LAUNCHER)) return { ok: false, reason: 'Lanceur du serveur Légifrance introuvable.' };
  const python = ops.findPython();
  if (!python) return { ok: false, reason: 'Python 3 introuvable pour préparer le serveur Légifrance.' };
  const code = await ops.run(python.command, [LAUNCHER, '--bootstrap-only']);
  if (code !== 0) return { ok: false, reason: 'Échec de la préparation du venv Légifrance.' };
  return { ok: true };
}

export async function install(ctx, overrides = {}) {
  const ops = dependencies(overrides);
  if (ctx.dryRun) {
    ops.log.info('[simulation] préparation du venv du serveur Légifrance');
    ops.log.info(`[simulation] configuration PISTE dans ${legifranceEnvFile(ops.userHome)}`);
    return { status: 'skipped', note: 'Mode simulation — aucune modification effectuée.' };
  }
  removeLegacyLegifranceService({ userHome: ops.userHome, capture: ops.runCapture, logger: ops.log });
  removeExternalLegifrancePlugin({ capture: ops.runCapture, logger: ops.log });
  const serverSpin = spinner('Préparation du serveur MCP Légifrance...');
  const server = await prepareServer(ops);
  if (!server.ok) {
    serverSpin.fail('Serveur MCP Légifrance non préparé.');
    return { status: 'failed', note: server.reason };
  }
  serverSpin.succeed('Serveur MCP Légifrance prêt.');

  const standalone = readSimpleEnv(legifranceEnvFile(ops.userHome));
  const existingEnv = { ...standalone, ...(ctx.env || {}) };
  let clientId = existingEnv.LEGIFRANCE_CLIENT_ID || '';
  let clientSecret = existingEnv.LEGIFRANCE_CLIENT_SECRET || '';
  if (clientId && clientSecret) {
    const keep = await ops.confirm('Des clés PISTE sont déjà configurées. Les conserver pour la production ?', true);
    if (!keep) { clientId = ''; clientSecret = ''; }
  }
  if (!clientId || !clientSecret) {
    ops.log.info("Le serveur MCP interroge l'API officielle Légifrance via PISTE.");
    ops.log.detail(`1. Compte PISTE : ${link(REGISTRATION_URL, REGISTRATION_URL)}`);
    ops.log.detail(`2. Souscrire à l'API Légifrance : ${link(CATALOG_URL, CATALOG_URL)}`);
    blank();
  }
  for (;;) {
    if (!clientId || !clientSecret) {
      clientId = await ops.ask('Client ID PISTE (production)', { required: true });
      clientSecret = await ops.ask('Client Secret PISTE (production)', { required: true });
    }
    if (!clientId || !clientSecret) return { status: 'partial', note: 'Serveur prêt, mais clés PISTE absentes.' };
    const values = {
      LEGIFRANCE_CLIENT_ID: clientId,
      LEGIFRANCE_CLIENT_SECRET: clientSecret,
      LEGIFRANCE_ENV: PISTE_ENV,
    };
    ops.writeEnv(values);
    ops.writeLegifranceEnv(legifranceEnvFile(ops.userHome), values);
    const validationSpin = spinner('Validation des clés PISTE de production...');
    const validation = await ops.validatePisteCredentials(clientId, clientSecret);
    if (validation.ok) {
      validationSpin.succeed('Connexion à Légifrance confirmée.');
      return { status: 'done', note: '' };
    }
    validationSpin.fail('Échec de la validation PISTE.');
    ops.log.error(validation.message);
    if (ops.nonInteractive) return { status: 'partial', note: validation.message };
    const action = await ops.select('La validation a échoué. Que voulez-vous faire ?', [
      { value: 'retry', label: 'Réessayer', hint: 'ressaisir les clés' },
      { value: 'skip', label: 'Conserver sans validation', hint: 'terminer malgré l’échec' },
    ], { def: 0 });
    if (action === 'skip') return { status: 'partial', note: validation.message };
    clientId = ''; clientSecret = '';
  }
}

export async function check(_ctx, overrides = {}) {
  const ops = dependencies(overrides);
  if (!fs.existsSync(LAUNCHER)) return { status: 'failed', note: 'Lanceur du serveur Légifrance introuvable.' };
  const env = readSimpleEnv(legifranceEnvFile(ops.userHome));
  if (!env.LEGIFRANCE_CLIENT_ID || !env.LEGIFRANCE_CLIENT_SECRET) {
    return { status: 'partial', note: 'Serveur présent, mais clés PISTE absentes de ~/.config/mcp-legifrance/.env.' };
  }
  if ((env.LEGIFRANCE_ENV || PISTE_ENV).toLowerCase() !== PISTE_ENV) {
    return { status: 'partial', note: 'Le serveur Légifrance n’est pas configuré en production.' };
  }
  return { status: 'done', note: 'Serveur embarqué présent ; clés présentes. Validation réseau non rejouée.' };
}
