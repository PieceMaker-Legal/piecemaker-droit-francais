import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TEXT_ID = /^(JURITEXT|CETATEXT|LEGIARTI)\d{12}$/;
const TOKEN_URL = 'https://oauth.piste.gouv.fr/api/oauth/token';
const API_URL = 'https://api.piste.gouv.fr/dila/legifrance/lf-engine-app';

function decodeEntities(value: string) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function blocksFromLegifranceHtml(html: string): string[] {
  if (!html) return [];
  const broken = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<rech_ecli[\s\S]*?<\/rech_ecli>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/br>/gi, '')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p\b[^>]*>/gi, '\n');
  return decodeEntities(broken.replace(/<[^>]+>/g, ''))
    .split(/\n+/)
    .map((block) => block.replace(/[ \t\f\v]+/g, ' ').trim())
    .filter(Boolean);
}

type PisteCredentials = { id: string; secret: string };

async function readCredentials(): Promise<PisteCredentials | null> {
  const fromEnv = process.env.LEGIFRANCE_CLIENT_ID && process.env.LEGIFRANCE_CLIENT_SECRET
    ? { id: process.env.LEGIFRANCE_CLIENT_ID, secret: process.env.LEGIFRANCE_CLIENT_SECRET }
    : null;
  if (fromEnv) return fromEnv;
  try {
    const file = await readFile(path.join(os.homedir(), '.config', 'mcp-legifrance', '.env'), 'utf8');
    const values: Record<string, string> = {};
    for (const line of file.split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
      if (match) values[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
    if (!values.LEGIFRANCE_CLIENT_ID || !values.LEGIFRANCE_CLIENT_SECRET) return null;
    return { id: values.LEGIFRANCE_CLIENT_ID, secret: values.LEGIFRANCE_CLIENT_SECRET };
  } catch {
    return null;
  }
}

let tokenCache: { id: string; value: string; expiresAt: number } | null = null;

async function accessToken(credentials: PisteCredentials) {
  if (tokenCache && tokenCache.id === credentials.id && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: credentials.id,
      client_secret: credentials.secret,
      scope: 'openid',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return null;
  const body = await response.json() as { access_token?: string; expires_in?: number };
  if (!body.access_token) return null;
  tokenCache = { id: credentials.id, value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return body.access_token;
}

async function texteHtml(id: string, token: string) {
  const article = id.startsWith('LEGIARTI');
  const response = await fetch(`${API_URL}${article ? '/consult/getArticle' : '/consult/juri'}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(article ? { id } : { textId: id }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return '';
  const body = await response.json() as { text?: { texteHtml?: string; texte?: string }; article?: { texteHtml?: string; texte?: string } };
  const record = body.article ?? body.text;
  if (typeof record?.texteHtml === 'string' && record.texteHtml) return record.texteHtml;
  return typeof record?.texte === 'string' ? record.texte : '';
}

export async function loadLegifranceBlocks(id: string): Promise<string[] | null> {
  if (!TEXT_ID.test(id)) return null;
  try {
    const credentials = await readCredentials();
    if (!credentials) return null;
    const token = await accessToken(credentials);
    if (!token) return null;
    const blocks = blocksFromLegifranceHtml(await texteHtml(id, token));
    return blocks.length ? blocks : null;
  } catch {
    return null;
  }
}
