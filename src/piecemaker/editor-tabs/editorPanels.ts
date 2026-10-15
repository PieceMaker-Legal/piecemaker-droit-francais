import { clearCitationPassage, setCitationPassage } from '@/piecemaker/citations/citationPassage';

export const OPEN_IN_EDITOR_EVENT = 'piecemaker:open-in-editor';
export const CLOSE_IN_EDITOR_EVENT = 'piecemaker:close-in-editor';

const SCHEME = 'piecemaker://';

export type IdentityMode = 'open' | 'add';

type EditorPanel =
  | { kind: 'citation'; token: string; label: string }
  | { kind: 'identity'; mode: IdentityMode; text: string }
  | { kind: 'plan'; id: string };

const plans = new Map<string, string>();
const planListeners = new Set<() => void>();

export const citationPath = (token: string, label: string) => `${SCHEME}citation/${token}/${encodeURIComponent(label)}`;

export const identityPath = (mode: IdentityMode, text: string) => `${SCHEME}identity/${mode}/${encodeURIComponent(text)}`;

export const planPath = (id: string) => `${SCHEME}plan/${encodeURIComponent(id)}`;

export function storePlan(id: string, markdown: string) {
  plans.set(id, markdown);
  planListeners.forEach((listener) => listener());
}

export function subscribePlans(listener: () => void) {
  planListeners.add(listener);
  return () => {
    planListeners.delete(listener);
  };
}

export function readPlan(id: string): string | null {
  return plans.get(id) ?? null;
}

export function parseEditorPanel(path: string): EditorPanel | null {
  if (!path.startsWith(SCHEME)) return null;
  const [kind, first, second] = path.slice(SCHEME.length).split('/');
  try {
    if (kind === 'citation' && /^[a-f0-9]{64}$/.test(first ?? '')) return { kind, token: first, label: decodeURIComponent(second ?? '') };
    if (kind === 'identity' && (first === 'open' || first === 'add') && second) return { kind, mode: first, text: decodeURIComponent(second) };
    if (kind === 'plan' && first) return { kind, id: decodeURIComponent(first) };
  } catch {
    return null;
  }
  return null;
}

export function openInEditor(path: string, passage?: { quote: string; page?: number }) {
  if (passage?.quote) setCitationPassage(path, passage.quote, passage.page);
  else clearCitationPassage();
  window.dispatchEvent(new CustomEvent(OPEN_IN_EDITOR_EVENT, { detail: { path } }));
}

export function closeInEditor(path: string) {
  window.dispatchEvent(new CustomEvent(CLOSE_IN_EDITOR_EVENT, { detail: { path } }));
}
