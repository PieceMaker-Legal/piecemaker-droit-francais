/**
 * The client's half of the JWT session: parsing, expiry, storage and the two
 * events the auth context listens to.
 *
 * Extracted from api.ts, which is meant to be the endpoint map plus its request
 * helpers. This is the security-sensitive part and it is what WebSocketContext,
 * AuthContext, the shell socket and the file-tree uploader actually import.
 */

export const AUTH_TOKEN_REFRESHED_EVENT = 'auth-token-refreshed';
export const AUTH_SESSION_EXPIRED_EVENT = 'auth-session-expired';

// Only accept a refreshed token that has this app's issued JWT shape
// (three base64url segments). An attacker-injected/malformed header value
// must never overwrite the stored auth token.
export const isValidRefreshedToken = (token: unknown): token is string =>
  typeof token === 'string' &&
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

type TokenClaims = {
  issuedAt: number;
  expiresAt: number;
};

const readTokenClaims = (token: unknown): TokenClaims | null => {
  if (!isValidRefreshedToken(token)) {
    return null;
  }

  try {
    const encodedPayload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const paddedPayload = encodedPayload.padEnd(
      encodedPayload.length + ((4 - (encodedPayload.length % 4)) % 4),
      '=',
    );
    const payload = JSON.parse(atob(paddedPayload)) as { iat?: unknown; exp?: unknown };

    if (
      typeof payload.iat !== 'number' ||
      !Number.isFinite(payload.iat) ||
      typeof payload.exp !== 'number' ||
      !Number.isFinite(payload.exp)
    ) {
      return null;
    }

    return { issuedAt: payload.iat * 1000, expiresAt: payload.exp * 1000 };
  } catch {
    return null;
  }
};

// Tolerance for client/server clock skew. The server's own jwt.verify is the
// real authority; this check only decides whether the client should discard a
// token locally. Without an allowance, a browser clock running slightly ahead
// reads a still-server-valid token as expired and drops the session.
export const TOKEN_EXPIRY_SKEW_MS = 60_000;

export const isAuthTokenExpired = (token: unknown): boolean => {
  const claims = readTokenClaims(token);
  return claims ? Date.now() >= claims.expiresAt + TOKEN_EXPIRY_SKEW_MS : false;
};

export const getAuthTokenRefreshDelay = (token: unknown): number | null => {
  const claims = readTokenClaims(token);
  if (!claims) {
    return null;
  }

  const refreshAt = claims.issuedAt + ((claims.expiresAt - claims.issuedAt) / 2);
  return Math.max(0, refreshAt - Date.now());
};

export const expireAuthSession = (): void => {
  localStorage.removeItem('auth-token');
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  }
};

export const getStoredAuthToken = (): string | null => {
  const token = localStorage.getItem('auth-token');
  if (token && isAuthTokenExpired(token)) {
    expireAuthSession();
    return null;
  }
  return token;
};

export const storeAuthToken = (token: unknown): boolean => {
  if (!isValidRefreshedToken(token)) {
    return false;
  }

  // Never let an expired token replace the stored one. A 304 replays the
  // headers of the cached response, so a stale X-Refreshed-Token from an
  // earlier session arrives again on every start; overwriting with it makes
  // the next getStoredAuthToken() discard a sign-in that was seconds old.
  if (isAuthTokenExpired(token)) {
    return false;
  }

  localStorage.setItem('auth-token', token);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT, { detail: token }));
  }
  return true;
};

// Headers are a plain record rather than the full `HeadersInit` union so the
// defaults below can be merged with a caller's headers by spreading.
export type ApiRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>;
};

/**
 * The one authenticated client, shared by the app and every plugin bundle:
 * sends the stored token, stores a refreshed one, ends the session on a real
 * rejection. `withToken: false` is the hosted platform, where a proxy signs in.
 */
export const authenticatedFetch = (
  url: string,
  options: ApiRequestOptions = {},
  { withToken = true }: { withToken?: boolean } = {},
): Promise<Response> => {
  const token = withToken ? getStoredAuthToken() : null;
  const defaultHeaders: Record<string, string> = {};
  // Only set Content-Type for non-FormData requests
  if (!(options.body instanceof FormData)) defaultHeaders['Content-Type'] = 'application/json';
  if (token) defaultHeaders.Authorization = `Bearer ${token}`;

  return fetch(url, {
    ...options,
    // Every response here can carry X-Refreshed-Token or X-Auth-Error, and a
    // served-from-cache response replays the headers it was stored with. Those
    // headers describe one moment in one session, so they must never be reused:
    // a stale X-Refreshed-Token overwrote the current token with an expired one
    // on every start, which then got discarded as expired.
    cache: 'no-store',
    headers: { ...defaultHeaders, ...options.headers },
  }).then((response) => {
    const refreshedToken = response.headers.get('X-Refreshed-Token');
    if (refreshedToken) storeAuthToken(refreshedToken);
    // Only a real rejection ends the session: a revalidated response surfaces
    // its stored status, so the header alone says nothing about this request.
    if (response.status === 401 && response.headers.get('X-Auth-Error')) expireAuthSession();
    return response;
  });
};

/** JSON request for the plugins: GET without body, otherwise `method` (POST by default) with a JSON or binary body. */
export async function requestJson<T>(url: string, body?: unknown, method?: string): Promise<T> {
  const raw = body instanceof Blob;
  const response = await authenticatedFetch(url, {
    ...(body !== undefined || method ? { method: method ?? 'POST' } : {}),
    ...(body !== undefined ? { body: raw ? body : JSON.stringify(body) } : {}),
    ...(raw ? { headers: { 'Content-Type': 'application/octet-stream' } } : {}),
  });
  const data = await response.json().catch(() => ({})) as T & { error?: unknown; reason?: unknown };
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : typeof data.reason === 'string' ? data.reason : `Erreur ${response.status}`);
  return data;
}
