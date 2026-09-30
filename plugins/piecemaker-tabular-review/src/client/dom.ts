import type { Flag } from '../shared.js';
import { FLAG_COLORS, FLAG_LABELS } from '../shared.js';

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function inlineMarkdown(value: string): string {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(value: string): string {
  const html: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) html.push(`<ul>${list.map((item) => `<li>${item}</li>`).join('')}</ul>`);
    list = [];
  };
  for (const line of value.replace(/\r\n/g, '\n').split('\n')) {
    const item = line.match(/^\s*[-*+•]\s+(.*)$/);
    if (item) {
      list.push(inlineMarkdown(item[1]));
      continue;
    }
    flush();
    if (line.trim()) html.push(`<p>${inlineMarkdown(line)}</p>`);
  }
  flush();
  return html.join('');
}

export function flagDot(flag: Flag): string {
  return `<span class="ptr-flag" style="background:${FLAG_COLORS[flag]}" title="${escapeHtml(FLAG_LABELS[flag])}" aria-label="${escapeHtml(FLAG_LABELS[flag])}"></span>`;
}

export function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

export function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() ?? value;
}

type ModalOptions = {
  title: string;
  body: string;
  actions: { label: string; value: string; kind?: 'primary' | 'danger' | 'ghost' }[];
  wide?: boolean;
  onMount?: (dialog: HTMLElement, close: (value: string | null) => void) => void;
};

export function openModal(root: HTMLElement, options: ModalOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'ptr-overlay';
    overlay.innerHTML = `
      <div class="ptr-modal${options.wide ? ' ptr-modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(options.title)}">
        <header class="ptr-modal-header"><h2>${escapeHtml(options.title)}</h2><button type="button" class="ptr-icon-button" data-modal-close aria-label="Fermer">×</button></header>
        <div class="ptr-modal-body">${options.body}</div>
        <footer class="ptr-modal-footer">${options.actions.map((action) => `<button type="button" class="ptr-button${action.kind === 'primary' ? ' ptr-button-primary' : action.kind === 'danger' ? ' ptr-button-danger' : ''}" data-modal-action="${escapeHtml(action.value)}">${escapeHtml(action.label)}</button>`).join('')}</footer>
      </div>`;
    const close = (value: string | null) => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close(null);
    };
    overlay.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target === overlay || target.closest('[data-modal-close]')) {
        close(null);
        return;
      }
      const action = target.closest<HTMLElement>('[data-modal-action]');
      if (action) close(action.dataset.modalAction ?? null);
    });
    document.addEventListener('keydown', onKey);
    root.appendChild(overlay);
    const dialog = overlay.querySelector<HTMLElement>('.ptr-modal')!;
    options.onMount?.(dialog, close);
    dialog.querySelector<HTMLElement>('input, textarea, select, .ptr-button-primary')?.focus();
  });
}

export async function confirmDialog(root: HTMLElement, title: string, body: string, confirmLabel: string, danger = false): Promise<boolean> {
  const answer = await openModal(root, {
    title,
    body,
    actions: [
      { label: 'Annuler', value: 'cancel' },
      { label: confirmLabel, value: 'confirm', kind: danger ? 'danger' : 'primary' },
    ],
  });
  return answer === 'confirm';
}

export function toast(root: HTMLElement, message: string, kind: 'info' | 'error' = 'info'): void {
  const element = document.createElement('div');
  element.className = `ptr-toast${kind === 'error' ? ' ptr-toast-error' : ''}`;
  element.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  element.textContent = message;
  root.appendChild(element);
  window.setTimeout(() => element.remove(), kind === 'error' ? 8000 : 4000);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function downloadBase64(filename: string, base64: string, mimeType: string): void {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
