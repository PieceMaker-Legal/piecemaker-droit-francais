import { escapeHtml } from './views.js';

const TAB = 'plugin:piecemaker-dossier';

export type ChatPlace = { fichier?: string; debut?: number; fin?: number };

export const chatAttributes = (title: string, kind: string, note: string, place: ChatPlace) => ` data-chat-pick="${escapeHtml(title)}" data-chat-kind="${kind}" data-chat-note="${escapeHtml(note)}"${place.fichier ? ` data-chat-file="${escapeHtml(place.fichier)}"` : ''}${place.debut ? ` data-chat-line="${place.debut}" data-chat-end="${place.fin ?? place.debut}"` : ''}`;

export function askChat(title: string, kind: string, note: string, place: ChatPlace): void {
  window.dispatchEvent(new CustomEvent('piecemaker:chat-pick', { detail: { titre: title, nature: kind, note, ...place } }));
  window.dispatchEvent(new CustomEvent('piecemaker:panel-picked', { detail: { tab: TAB } }));
}
