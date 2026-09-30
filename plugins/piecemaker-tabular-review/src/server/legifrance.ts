import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { UserError } from './paths.js';

export type Json = Record<string, unknown>;

export type LegifranceApi = {
  search(body: Json, signal: AbortSignal): Promise<Json>;
  consult(id: string, signal: AbortSignal): Promise<Json>;
  judilibre(route: string, params: URLSearchParams, signal: AbortSignal): Promise<Json>;
};

type Service = { label: string; subscription: string; request(bearer: string): { url: string; init: RequestInit } };

type Credentials = { id: string; secret: string; sandbox: boolean };

const TIMEOUT_MS = 30_000;
const ATTEMPTS = 4;

function readEnvFile(file: string): Record<string, string> {
  const values: Record<string, string> = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$/.exec(line);
      if (match) values[match[1]] = match[2].trim().replace(/^(["'])(.*)\1$/, '$2');
    }
  } catch {
    return values;
  }
  return values;
}

export function legifranceCredentials(environment: NodeJS.ProcessEnv = process.env, home = os.homedir()): Credentials | null {
  const explicit = environment.LEGIFRANCE_ENV_FILE?.trim();
  const files = [
    ...(explicit ? [path.resolve(explicit.replace(/^~(?=$|[\\/])/, home))] : []),
    path.join(home, '.config', 'mcp-legifrance', '.env'),
  ];
  const fromFiles = files.reduce<Record<string, string>>((values, file) => ({ ...readEnvFile(file), ...values }), {});
  const value = (name: string) => {
    const raw = (environment[name] ?? fromFiles[name] ?? '').trim();
    return raw && !raw.startsWith('${') ? raw : '';
  };
  const id = value('LEGIFRANCE_CLIENT_ID');
  const secret = value('LEGIFRANCE_CLIENT_SECRET');
  if (!id || !secret) return null;
  return { id, secret, sandbox: value('LEGIFRANCE_ENV').toLowerCase() === 'sandbox' };
}

function endpoints(sandbox: boolean) {
  return sandbox
    ? { token: 'https://sandbox-oauth.piste.gouv.fr/api/oauth/token', api: 'https://sandbox-api.piste.gouv.fr/dila/legifrance/lf-engine-app', judilibre: 'https://sandbox-api.piste.gouv.fr/cassation/judilibre/v1.0' }
    : { token: 'https://oauth.piste.gouv.fr/api/oauth/token', api: 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app', judilibre: 'https://api.piste.gouv.fr/cassation/judilibre/v1.0' };
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Annulée.'));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      reject(new Error('Annulée.'));
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}

export class AccessDenied extends UserError {}

class RetryableError extends Error {
  constructor(message: string, readonly delay?: number) {
    super(message);
  }
}

export function createLegifranceApi(credentials: Credentials, fetchImpl: typeof fetch = fetch, pause = wait): LegifranceApi {
  const urls = endpoints(credentials.sandbox);
  let token: { value: string; expiresAt: number } | null = null;
  let pendingToken: Promise<string> | null = null;

  async function requestToken(signal: AbortSignal): Promise<string> {
    const response = await fetchImpl(urls.token, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: credentials.id, client_secret: credentials.secret, scope: 'openid' }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new UserError('Identifiants PISTE refusés : vérifiez LEGIFRANCE_CLIENT_ID et LEGIFRANCE_CLIENT_SECRET (~/.config/mcp-legifrance/.env).');
    if (!response.ok) throw new RetryableError(`Serveur OAuth PISTE indisponible (HTTP ${response.status}).`);
    const body = await response.json() as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new RetryableError('Réponse OAuth PISTE sans jeton.');
    token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  function accessToken(signal: AbortSignal): Promise<string> {
    if (token && token.expiresAt > Date.now() + 5 * 60_000) return Promise.resolve(token.value);
    pendingToken ??= requestToken(signal).finally(() => {
      pendingToken = null;
    });
    return pendingToken;
  }

  async function once(service: Service, signal: AbortSignal): Promise<Json> {
    const bearer = await accessToken(signal);
    const { url, init } = service.request(bearer);
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]) });
    } catch (error) {
      if (signal.aborted) throw new Error('Annulée.');
      throw new RetryableError(`${service.label} injoignable : ${error instanceof Error ? error.message : String(error)}`);
    }
    if (response.status === 401) {
      token = null;
      throw new RetryableError('Jeton PISTE expiré.', 0);
    }
    if (response.status === 403) throw new AccessDenied(`Accès refusé par PISTE : l’application doit être abonnée à ${service.subscription}.`);
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new RetryableError(`${service.label} indisponible (HTTP ${response.status}).`, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new UserError(`Requête refusée par ${service.label.replace(/^API/, 'l’API')} (HTTP ${response.status})${detail ? ` : ${detail.slice(0, 300)}` : ''}.`);
    }
    return await response.json() as Json;
  }

  async function call(service: Service, signal: AbortSignal): Promise<Json> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await once(service, signal);
      } catch (error) {
        if (!(error instanceof RetryableError) || attempt >= ATTEMPTS || signal.aborted) throw error instanceof RetryableError ? new Error(error.message) : error;
        await pause(error.delay ?? 500 * 2 ** (attempt - 1), signal);
      }
    }
  }

  const legifrance = (endpoint: string, body: Json): Service => ({
    label: 'API Légifrance',
    subscription: 'l’API Légifrance',
    request: (bearer) => ({
      url: `${urls.api}${endpoint}`,
      init: { method: 'POST', headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) },
    }),
  });

  const judilibre = (route: string, params: URLSearchParams): Service => ({
    label: 'API Judilibre',
    subscription: 'l’API Judilibre',
    request: (bearer) => ({
      url: `${urls.judilibre}${route}?${params}`,
      init: { method: 'GET', headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' } },
    }),
  });

  return {
    search: (body, signal) => call(legifrance('/search', body), signal),
    consult: (id, signal) => call(legifrance('/consult/juri', { textId: id }), signal),
    judilibre: (route, params, signal) => call(judilibre(route, params), signal),
  };
}
