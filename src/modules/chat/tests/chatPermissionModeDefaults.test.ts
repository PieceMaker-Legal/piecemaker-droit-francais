import assert from 'node:assert/strict';

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, test, vi } from 'vitest';

import type { ProjectSession } from '@/shared/types';
import { resetUserPreferences, writeUserPreference } from '@/shared/userSettings';

/**
 * Which permission mode the composer starts in. Precedence is the per-session
 * choice, then a pre-send pick, then Réglages, then the last provider pick.
 */

const okJson = (data: unknown) => Promise.resolve({
  ok: true,
  json: async () => data,
});

vi.mock('@/shared/api', () => ({
  api: {
    user: {
      preferences: () => okJson({ success: true, preferences: {} }),
      savePreferences: () => okJson({ success: true, preferences: {} }),
    },
    providers: {
      models: () => okJson({ success: true, data: null }),
      capabilities: () => okJson({ success: true, data: null }),
      sessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveModel: () => okJson({ success: true, data: null }),
      setSessionActiveEffort: () => okJson({ success: true, data: null }),
      createModel: () => okJson({ success: true, data: null }),
      updateModel: () => okJson({ success: true, data: null }),
      removeModel: () => okJson({ success: true, data: null }),
    },
  },
}));

const sessionOf = (id: string, provider: ProjectSession['__provider'] = 'codex'): ProjectSession => (
  { id, __provider: provider } as ProjectSession
);

const renderProviderState = async (initialSession: ProjectSession | null = null) => {
  const { useChatProviderState } = await import(
    '@/modules/chat/hooks/useChatProviderState'
  );
  const { writeUserPreference: writeLivePreference } = await import('@/shared/userSettings');
  const rendered = renderHook(
    ({ selectedSession }: { selectedSession: ProjectSession | null }) =>
      useChatProviderState({ selectedSession, selectedProject: null }),
    { initialProps: { selectedSession: initialSession } },
  );
  return { ...rendered, writeLivePreference };
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetUserPreferences();
  writeUserPreference('selectedProvider', 'codex');
});

afterEach(() => {
  vi.resetModules();
});

test('a new Codex chat starts in the permission mode saved in Réglages', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'bypassPermissions' });

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'bypassPermissions');
  });
});

test('an explicit per-session choice outranks Réglages', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'bypassPermissions' });
  localStorage.setItem('permissionMode-codex-pinned', 'acceptEdits');

  const { result } = await renderProviderState(sessionOf('codex-pinned'));

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'acceptEdits');
  });
});

test('a mode picked before the first send is bound to the new session id', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'bypassPermissions' });

  const { result, rerender, writeLivePreference } = await renderProviderState();
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'bypassPermissions');
  });

  act(() => {
    result.current.selectPermissionMode('acceptEdits');
  });
  act(() => {
    writeLivePreference('codexPermissions', { permissionMode: 'default' });
  });
  assert.equal(result.current.permissionMode, 'acceptEdits');

  act(() => {
    result.current.bindNewChatPermissionMode('codex-new');
  });
  rerender({ selectedSession: sessionOf('codex-new') });

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'acceptEdits');
  });
  assert.equal(localStorage.getItem('permissionMode-codex-new'), 'acceptEdits');

  rerender({ selectedSession: null });
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'default');
  });
});

test('a pick left unsent in a new chat is dropped once another session is opened', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'default' });

  const { result, rerender } = await renderProviderState();
  await waitFor(() => {
    assert.equal(result.current.availablePermissionModes.includes('bypassPermissions'), true);
  });
  act(() => {
    result.current.selectPermissionMode('bypassPermissions');
  });

  rerender({ selectedSession: sessionOf('codex-other') });
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'default');
  });

  rerender({ selectedSession: null });
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'default');
  });
});

test('Claude skipPermissions seeds the composer as bypass when the session has no override', async () => {
  writeUserPreference('selectedProvider', 'claude');
  writeUserPreference('claudePermissions', { skipPermissions: true });

  const { result } = await renderProviderState();

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'bypassPermissions');
  });
});

test('an explicit Claude pick outranks skipPermissions and binds to the session', async () => {
  writeUserPreference('selectedProvider', 'claude');
  writeUserPreference('claudePermissions', { skipPermissions: true });

  const { result, rerender } = await renderProviderState();
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'bypassPermissions');
  });

  act(() => {
    result.current.selectPermissionMode('acceptEdits');
  });
  assert.equal(result.current.permissionMode, 'acceptEdits');

  act(() => {
    result.current.bindNewChatPermissionMode('claude-new');
  });
  rerender({ selectedSession: sessionOf('claude-new', 'claude') });

  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'acceptEdits');
  });
  assert.equal(localStorage.getItem('permissionMode-claude-new'), 'acceptEdits');
});

test('a fork keeps the permission mode chosen for the session it was forked from', async () => {
  writeUserPreference('codexPermissions', { permissionMode: 'bypassPermissions' });
  localStorage.setItem('permissionMode-codex-parent', 'default');

  const { inheritSessionPermissionMode } = await import('@/shared/utils');
  inheritSessionPermissionMode('codex-parent', 'codex-fork');
  inheritSessionPermissionMode('codex-unpinned-parent', 'codex-unpinned-fork');

  const { result, rerender } = await renderProviderState(sessionOf('codex-fork'));
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'default');
  });

  assert.equal(localStorage.getItem('permissionMode-codex-unpinned-fork'), null);
  rerender({ selectedSession: sessionOf('codex-unpinned-fork') });
  await waitFor(() => {
    assert.equal(result.current.permissionMode, 'bypassPermissions');
  });
});
