/**
 * Regression guard for an assumed exception to « Add, don't edit » in
 * `src/modules/auth/context/AuthContext.tsx`: the bootstrap effect must run
 * once, on mount, and never again when the server rotates the JWT.
 *
 * Without it, `X-Refreshed-Token` → `setToken` changed `checkAuthStatus`'s
 * identity, replayed the bootstrap effect and set `isLoading` back to true,
 * which made `ProtectedRoute` unmount the whole `<Router>` subtree — losing the
 * selected dossier, the active tab, the chat and the terminal, and sending the
 * user back to « Choisissez votre dossier ».
 *
 * This test lives under `src/piecemaker/` on purpose: an upstream merge that
 * resolves that file toward CloudCLI reintroduces the bug, and this file is
 * what fails.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { render, screen, waitFor } from '@testing-library/react';
import { act, useEffect } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';

const { authStatus, authUser, onboardingStatus } = vi.hoisted(() => ({
  authStatus: vi.fn(),
  authUser: vi.fn(),
  onboardingStatus: vi.fn(),
}));

vi.mock('@/shared/api', () => ({
  api: {
    auth: { status: authStatus, user: authUser, refresh: vi.fn() },
    user: { onboardingStatus },
  },
}));

vi.mock('@/shared/chatDrafts', () => ({
  hydrateChatDrafts: vi.fn(async () => {}),
  resetChatDrafts: vi.fn(),
}));

vi.mock('@/shared/userSettings', () => ({
  hydrateUserPreferences: vi.fn(async () => {}),
  resetUserPreferences: vi.fn(),
}));

import { AUTH_TOKEN_REFRESHED_EVENT } from '@/shared/authToken';
import { AuthProvider, useAuth } from '@/modules/auth/context/AuthContext';

const encodeSegment = (payload: object): string =>
  btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const buildToken = (issuedAtSeconds: number): string => {
  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
  const body = encodeSegment({ iat: issuedAtSeconds, exp: issuedAtSeconds + 3600 });
  return `${header}.${body}.signature`;
};

const jsonResponse = (payload: object) => new Response(JSON.stringify(payload), { status: 200 });

let mountCount = 0;

function SessionProbe() {
  const { isLoading } = useAuth();
  if (isLoading) return <span>loading</span>;
  return <span data-testid="session">mounted</span>;
}

function CountingChild() {
  useEffect(() => {
    mountCount += 1;
  }, []);
  return <SessionProbe />;
}

beforeEach(() => {
  mountCount = 0;
  localStorage.clear();
  authStatus.mockReset();
  authUser.mockReset();
  onboardingStatus.mockReset();
  authStatus.mockResolvedValue(jsonResponse({ needsSetup: false }));
  authUser.mockResolvedValue(jsonResponse({ user: { id: 1, username: 'avocat' } }));
  onboardingStatus.mockResolvedValue(jsonResponse({ hasCompletedOnboarding: true }));
});

test('a rotated token does not send the authenticated tree back through the loading screen', async () => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  localStorage.setItem('auth-token', buildToken(nowSeconds));

  render(
    <AuthProvider>
      <CountingChild />
    </AuthProvider>,
  );

  await waitFor(() => expect(screen.getByTestId('session')).toBeTruthy());
  expect(authStatus.mock.calls.length).toBe(1);

  const rotatedToken = buildToken(nowSeconds + 1);
  await act(async () => {
    window.dispatchEvent(new CustomEvent(AUTH_TOKEN_REFRESHED_EVENT, { detail: rotatedToken }));
  });

  expect(screen.getByTestId('session')).toBeTruthy();
  expect(screen.queryByText('loading')).toBeNull();
  expect(authStatus.mock.calls.length).toBe(1);
  expect(mountCount).toBe(1);
});
