import { afterEach, expect, it, vi } from 'vitest';
import { createTelephone } from '../telephone.js';

afterEach(() => { document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); });

it('ouvre le QR Telegram avec la session PieceMaker et permet de fermer puis rouvrir', async () => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: true, name: 'PieceMaker', username: 'exemple_bot', url: 'https://t.me/exemple_bot?start=suivi', qr: 'data:image/png;base64,ZXhlbXBsZQ==', skill: true })));
  vi.stubGlobal('fetch', request);
  localStorage.setItem('auth-token', 'session-exemple');
  const root = document.createElement('section');
  document.body.append(root);
  const button = createTelephone(root);
  root.append(button);
  button.click();
  button.click();
  expect(root.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  await vi.waitFor(() => expect(root.querySelector('a')?.href).toBe('https://t.me/exemple_bot?start=suivi'));
  expect(request).toHaveBeenCalledOnce();
  expect(request.mock.calls[0][0]).toBe('/api/piecemaker/telegram');
  expect(request.mock.calls[0][1].headers.Authorization).toBe('Bearer session-exemple');
  expect(root.querySelector('.pme-telegram-qr')?.getAttribute('src')).toBe('data:image/png;base64,ZXhlbXBsZQ==');
  expect(root.textContent).toContain('Skill PieceMaker disponible');
  root.querySelector<HTMLButtonElement>('[data-modal-action="close"]')!.click();
  await Promise.resolve();
  expect(root.querySelector('[role="dialog"]')).toBeNull();
  button.click();
  await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
  root.querySelector<HTMLButtonElement>('[data-modal-close]')!.click();
});

it('signale une mini-app arrêtée sans afficher un QR périmé', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ available: false, error: 'Mini-app arrêtée.' }), { status: 503 })));
  const root = document.createElement('section');
  document.body.append(root);
  root.append(createTelephone(root));
  root.querySelector<HTMLButtonElement>('button')!.click();
  await vi.waitFor(() => expect(root.querySelector('[role="status"]')?.textContent).toBe('Mini-app arrêtée.'));
  expect(root.querySelector('.pme-telegram-qr')).toBeNull();
  root.querySelector<HTMLButtonElement>('[data-modal-close]')!.click();
});
