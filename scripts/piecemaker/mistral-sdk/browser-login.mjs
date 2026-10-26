import { createHash, randomBytes } from 'node:crypto';

const CONSOLE_ORIGIN = 'https://console.mistral.ai';
const SIGN_IN_ENDPOINT = `${CONSOLE_ORIGIN}/api/vibe/sign-in`;

function consoleUrl(value, api = false) {
  const url = new URL(value);
  if (url.origin !== CONSOLE_ORIGIN || url.username || url.password || (api && !url.pathname.startsWith('/api/'))) {
    throw new Error('Adresse de connexion Mistral inattendue.');
  }
  return url.href;
}

export async function browserLogin({ fetchImpl = fetch, openBrowser, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now }) {
  const verifier = randomBytes(64).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  async function request(url, body) {
    const response = await fetchImpl(url, {
      ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (response.status === 429 && !body) {
      const retryAfter = response.headers.get('retry-after') || '';
      const delay = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - now();
      return { status: 'pending', retryAfterMs: Math.max(30000, Number.isFinite(delay) ? delay : 30000) };
    }
    if (!response.ok) throw new Error(`Connexion Mistral refusée (HTTP ${response.status}).`);
    return response.json();
  }
  const attempt = await request(SIGN_IN_ENDPOINT, { code_challenge: challenge, code_challenge_method: 'S256' });
  if (typeof attempt.process_id !== 'string' || !/^[\w-]+$/.test(attempt.process_id)) throw new Error('Identifiant de connexion Mistral invalide.');
  const deadline = Math.min(Date.parse(attempt.expires_at), now() + 600000);
  if (!Number.isFinite(deadline) || deadline <= now()) throw new Error('Connexion Mistral expirée.');
  const pollUrl = consoleUrl(attempt.poll_url, true);
  await openBrowser(consoleUrl(attempt.sign_in_url));
  while (now() < deadline) {
    const result = await request(pollUrl);
    if (result.status === 'completed' && typeof result.exchange_token === 'string' && result.exchange_token) {
      const exchanged = await request(`${SIGN_IN_ENDPOINT}/${encodeURIComponent(attempt.process_id)}/exchange`, {
        exchange_token: result.exchange_token,
        code_verifier: verifier,
      });
      if (typeof exchanged.api_key !== 'string' || !exchanged.api_key) throw new Error('Mistral n’a pas fourni les identifiants de connexion.');
      return exchanged.api_key;
    }
    if (result.status !== 'pending') throw new Error('Connexion Mistral refusée ou expirée.');
    await sleep(Math.min(result.retryAfterMs || 3000, deadline - now()));
  }
  throw new Error('Connexion Mistral expirée.');
}
