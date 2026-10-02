import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AUTH_SESSION_EXPIRED_EVENT, storeAuthToken } from '@/shared/authToken';
import { startPluginsReloadAfterLogin } from '@/piecemaker/auth/reloadPluginsAfterLogin';

const TOKEN = 'header.payload.signature';
let stop: (() => void) | undefined;

beforeEach(() => localStorage.clear());
afterEach(() => { stop?.(); stop = undefined; localStorage.clear(); });

it('reloads once when the first sign-in follows a signed-out page load', () => {
  const reload = vi.fn();
  stop = startPluginsReloadAfterLogin(reload);
  storeAuthToken(TOKEN);
  storeAuthToken(TOKEN);
  expect(reload).toHaveBeenCalledTimes(1);
});

it('keeps the page when the session was already open at load', () => {
  localStorage.setItem('auth-token', TOKEN);
  const reload = vi.fn();
  stop = startPluginsReloadAfterLogin(reload);
  storeAuthToken(TOKEN);
  expect(reload).not.toHaveBeenCalled();
});

it('reloads on the sign-in that follows an expired session', () => {
  localStorage.setItem('auth-token', TOKEN);
  const reload = vi.fn();
  stop = startPluginsReloadAfterLogin(reload);
  window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  storeAuthToken(TOKEN);
  expect(reload).toHaveBeenCalledTimes(1);
});
