import { authenticatedFetch } from '../../../src/shared/authToken.js';
import { escapeHtml, openModal } from '../../piecemaker-tabular-review/src/client/dom.js';

type Connection = { available: boolean; name?: string; username?: string; url?: string; qr?: string; skill?: boolean; error?: string };

export function createTelephone(root: HTMLElement) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ptr-icon-button pme-telephone';
  button.title = 'Ouvrir sur mon téléphone avec Telegram';
  button.setAttribute('aria-label', button.title);
  button.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4M11 19h2"/></svg>';
  let open = false;
  const show = async () => {
    if (open) return;
    open = true;
    await openModal(root, {
      title: 'PieceMaker sur mon téléphone',
      body: '<div class="pme-telegram" data-telegram-connection role="status">Connexion au bot PieceMaker…</div>',
      actions: [{ label: 'Fermer', value: 'close' }],
      onMount(dialog) {
        const content = dialog.querySelector<HTMLElement>('[data-telegram-connection]')!;
        void authenticatedFetch('/api/piecemaker/telegram').then(async (response) => {
          const state = await response.json() as Connection;
          if (!response.ok || !state.available) throw new Error(state.error || 'Le bot ou la mini-app est indisponible.');
          if (!content.isConnected) return;
          content.innerHTML = `<div class="pme-telegram-brand"><img src="/icons/icon-512x512.png" alt="" width="40" height="40"><strong>${escapeHtml(state.name)}</strong><span>@${escapeHtml(state.username)}</span></div><img class="pme-telegram-qr" src="${escapeHtml(state.qr)}" width="224" height="224" alt="QR code pour ouvrir le bot PieceMaker dans Telegram"><p>Scannez ce QR code avec votre téléphone.</p><p>Dans Telegram, touchez « Démarrer » si nécessaire, puis « Ouvrir l’app ».</p><a class="ptr-button ptr-button-primary" href="${escapeHtml(state.url)}" target="_blank" rel="noreferrer">Ouvrir Telegram</a><p class="pme-muted">${state.skill ? 'Skill PieceMaker disponible pour l’assistant.' : 'Skill PieceMaker non disponible pour l’assistant.'}</p><p class="pme-muted">Gardez ce Mac allumé et connecté.</p>`;
        }).catch((error: unknown) => {
          if (content.isConnected) content.textContent = error instanceof Error ? error.message : 'Connexion Telegram indisponible.';
        });
      },
    });
    open = false;
    if (button.isConnected) button.focus();
  };
  button.addEventListener('click', () => { void show(); });
  return button;
}
