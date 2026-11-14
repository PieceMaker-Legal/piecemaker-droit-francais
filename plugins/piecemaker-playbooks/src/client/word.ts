import type { Finding } from '../shared.js';

export type WordEditor = {
  findInDocument(query: string, options?: { caseSensitive?: boolean; limit?: number }): { paraId: string; match: string; before: string; after: string }[];
  proposeChange(options: { paraId: string; search: string; replaceWith: string; author: string }): boolean;
};

export function proposeFinding(editor: WordEditor, finding: Finding): void {
  if (finding.applied || !finding.verified || !finding.suggestedText) throw new Error('Cette proposition nécessite une vérification manuelle.');
  const insertion = finding.status === 'missing_required';
  const anchor = insertion ? finding.insertAfter : finding.quote;
  if (!anchor) throw new Error('Aucun passage vérifié pour cette proposition.');
  const matches = editor.findInDocument(anchor, { caseSensitive: true, limit: 2 });
  if (matches.length !== 1) throw new Error('Le passage est absent ou ambigu dans Word. Aucun changement appliqué.');
  const match = matches[0];
  const replaceWith = insertion ? `${match.match}\n${finding.suggestedText}` : finding.suggestedText;
  if (!editor.proposeChange({ paraId: match.paraId, search: match.match, replaceWith, author: 'PieceMaker · Playbook' })) {
    throw new Error('Eigenpal ne peut pas proposer cette révision. Vérifiez les modifications déjà présentes.');
  }
}

export function decodeBuffer(value: string): ArrayBuffer {
  const raw = atob(value);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0)).buffer;
}

export function encodeBuffer(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let raw = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(raw);
}
