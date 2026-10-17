import { afterEach, describe, expect, it, vi } from 'vitest';

import { refreshApplication } from '@/modules/piecemaker-workspace-tabs/refreshApplication';

afterEach(() => vi.unstubAllGlobals());

function setup(response: Response | Error, registration: { update: () => Promise<void> } | undefined = undefined) {
  const reload = vi.fn();
  const getRegistration = vi.fn().mockResolvedValue(registration);
  const fetch = response instanceof Error ? vi.fn().mockRejectedValue(response) : vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('navigator', { serviceWorker: { getRegistration } });
  vi.stubGlobal('window', { location: { href: 'https://example.ts.net/session/example', reload } });
  return { reload, fetch, getRegistration };
}

describe('refreshApplication', () => {
  it('checks the network and updates the worker before reloading the current session', async () => {
    const update = vi.fn().mockResolvedValue(undefined);
    const { reload, fetch } = setup(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }), { update });
    const saved = vi.spyOn(Storage.prototype, 'clear');
    await refreshApplication();
    expect(fetch).toHaveBeenCalledWith('https://example.ts.net/session/example', expect.objectContaining({ cache: 'no-store' }));
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0]);
    expect(reload).toHaveBeenCalledOnce();
    expect(saved).not.toHaveBeenCalled();
  });

  it('also refreshes when no service worker is installed yet', async () => {
    const { reload } = setup(new Response('<html></html>', { headers: { 'content-type': 'text/html' } }));
    await refreshApplication();
    expect(reload).toHaveBeenCalledOnce();
  });

  it.each([
    new Error('network unreachable'),
    new Response('unavailable', { status: 502 }),
    new Response('{}', { headers: { 'content-type': 'application/json' } }),
  ])('keeps the current page when the server is unreachable', async (response) => {
    const { reload, getRegistration } = setup(response);
    await expect(refreshApplication()).rejects.toThrow();
    expect(reload).not.toHaveBeenCalled();
    expect(getRegistration).not.toHaveBeenCalled();
  });
});
