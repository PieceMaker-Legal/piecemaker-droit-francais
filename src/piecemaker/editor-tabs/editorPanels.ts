export const OPEN_IN_EDITOR_EVENT = 'piecemaker:open-in-editor';

const SCHEME = 'piecemaker://';

export type IdentityMode = 'open' | 'add';

type EditorPanel =
  | { kind: 'citation'; token: string; label: string }
  | { kind: 'identity'; mode: IdentityMode; text: string };

export const citationPath = (token: string, label: string) => `${SCHEME}citation/${token}/${encodeURIComponent(label)}`;

export const identityPath = (mode: IdentityMode, text: string) => `${SCHEME}identity/${mode}/${encodeURIComponent(text)}`;

export function parseEditorPanel(path: string): EditorPanel | null {
  if (!path.startsWith(SCHEME)) return null;
  const [kind, first, second] = path.slice(SCHEME.length).split('/');
  try {
    if (kind === 'citation' && /^[a-f0-9]{64}$/.test(first ?? '')) return { kind, token: first, label: decodeURIComponent(second ?? '') };
    if (kind === 'identity' && (first === 'open' || first === 'add') && second) return { kind, mode: first, text: decodeURIComponent(second) };
  } catch {
    return null;
  }
  return null;
}

export function openInEditor(path: string) {
  window.dispatchEvent(new CustomEvent(OPEN_IN_EDITOR_EVENT, { detail: { path } }));
}
