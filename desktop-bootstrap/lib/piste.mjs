import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token';
const LEGIFRANCE_SEARCH_URL = 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app/search';
const JUDILIBRE_HEALTHCHECK_URL = 'https://api.piste.gouv.fr/cassation/judilibre/v1.0/healthcheck';
const PISTE_ENV = 'production';

export function pisteEnvFile(homeDir = os.homedir()) {
  return path.join(homeDir, '.config', 'mcp-legifrance', '.env');
}

function readEnv(file) {
  const values = new Map();
  const others = [];
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return { values, others };
  }
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (match) values.set(match[1], match[2].trim().replace(/^["']|["']$/g, ''));
    else if (line.trim()) others.push(line);
  }
  return { values, others };
}

export function pisteCredentialsConfigured(file = pisteEnvFile()) {
  const { values } = readEnv(file);
  return Boolean(values.get('LEGIFRANCE_CLIENT_ID') && values.get('LEGIFRANCE_CLIENT_SECRET'));
}

export function savePisteCredentials({ clientId, clientSecret }, file = pisteEnvFile()) {
  const { values, others } = readEnv(file);
  values.set('LEGIFRANCE_CLIENT_ID', clientId);
  values.set('LEGIFRANCE_CLIENT_SECRET', clientSecret);
  values.set('LEGIFRANCE_ENV', PISTE_ENV);
  const body = [...others, ...[...values].map(([key, value]) => `${key}=${value}`)].join('\n');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${body}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, file);
  return file;
}

async function request(fetchImpl, url, options) {
  try {
    return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(20_000) });
  } catch {
    return null;
  }
}

function legifranceSearchBody() {
  return JSON.stringify({
    fond: 'CODE_DATE',
    recherche: {
      champs: [{ typeChamp: 'ALL', criteres: [{ typeRecherche: 'UN_DES_MOTS', valeur: 'code civil', operateur: 'ET' }], operateur: 'ET' }],
      filtres: [],
      pageNumber: 1,
      pageSize: 1,
      operateur: 'ET',
      sort: 'SIGNATURE_DATE_DESC',
      typePagination: 'DEFAUT',
    },
  });
}

function apiRefused(name, status) {
  return {
    ok: false,
    message: `Les identifiants sont reconnus, mais l'application n'a pas accès à ${name} (HTTP ${status}). `
      + `Vérifiez que les CGU de ${name} sont acceptées (étape 2) et que ${name} est coché dans « Sélectionner les API » de l'application PRODUCTION (étape 3). `
      + "Juste après l'enregistrement, PISTE peut demander une à deux minutes avant d'ouvrir l'accès.",
  };
}

const UNREACHABLE = { ok: false, message: 'PISTE ne répond pas. Vérifiez la connexion Internet puis réessayez.' };

export async function validatePisteCredentials({ clientId, clientSecret }, fetchImpl = fetch) {
  const tokenResponse = await request(fetchImpl, TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'openid',
    }),
  });
  if (!tokenResponse) return UNREACHABLE;
  if (!tokenResponse.ok) {
    return {
      ok: false,
      message: 'PISTE refuse ces identifiants. Recopiez le Client ID et le Client Secret affichés dans « Identifiants Oauth » '
        + "de l'application PRODUCTION (et non de l'application SANDBOX créée automatiquement).",
    };
  }
  const token = (await tokenResponse.json().catch(() => null))?.access_token;
  if (!token) return { ok: false, message: "PISTE n'a pas renvoyé de jeton d'accès. Réessayez dans un instant." };

  const legifrance = await request(fetchImpl, LEGIFRANCE_SEARCH_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: legifranceSearchBody(),
  });
  if (!legifrance) return UNREACHABLE;
  if (!legifrance.ok) return apiRefused('Légifrance', legifrance.status);

  const judilibre = await request(fetchImpl, JUDILIBRE_HEALTHCHECK_URL, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!judilibre) return UNREACHABLE;
  if (!judilibre.ok) return apiRefused('JUDILIBRE', judilibre.status);

  return { ok: true };
}
