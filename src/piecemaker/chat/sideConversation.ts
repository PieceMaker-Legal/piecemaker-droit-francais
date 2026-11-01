import { api } from '@/shared/api';
import { writeDraftText } from '@/shared/chatDrafts';
import { inheritSessionPermissionMode } from '@/shared/utils';

const SESSION_PATH = /\/session\/([^/]+)\/?$/;

export function openedSessionId(): string | null {
  const encodedId = window.location.pathname.match(SESSION_PATH)?.[1];
  return encodedId ? decodeURIComponent(encodedId) : null;
}

function navigateToSession(sessionId: string): void {
  const path = window.location.pathname.replace(SESSION_PATH, `/session/${encodeURIComponent(sessionId)}`);
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export async function startSideConversation(sourceSessionId: string, quote: string): Promise<void> {
  try {
    const response = await api.forkSession(sourceSessionId);
    const payload = await response.json();
    const forkedSessionId = payload?.data?.sessionId;
    if (!response.ok || typeof forkedSessionId !== 'string') {
      throw new Error(payload?.message || `HTTP ${response.status}`);
    }
    inheritSessionPermissionMode(sourceSessionId, forkedSessionId);
    writeDraftText(forkedSessionId, `> ${quote}\n\n`);
    navigateToSession(forkedSessionId);
  } catch (error) {
    console.error('Error starting side conversation:', error);
    window.alert('Impossible de démarrer une conversation annexe depuis cette conversation.');
  }
}
