import { pmPost } from '@/piecemaker/dossier/api';
import { api } from '@/shared/api';
import type { LLMProvider, ScheduledMessage } from '@/shared/types';

export type QuotaChainEntry = { provider: LLMProvider; model: string };

export type QuotaResumeMode = 'off' | 'wait' | 'chain';

export type QuotaResumePreferences = { mode: QuotaResumeMode; chain: QuotaChainEntry[] };

export const QUOTA_PROVIDERS: LLMProvider[] = ['claude', 'codex', 'mistral', 'cursor', 'opencode', 'hermes'];

export const PROVIDER_NAMES: Record<LLMProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  mistral: 'Mistral',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  hermes: 'Hermes',
};

export const RESUME_MESSAGE = 'Reprends le travail là où tu t’es arrêté : la limite d’utilisation est levée.';

const UNKNOWN_RESET_DELAY_MS = 30 * 60_000;
const RESET_MARGIN_MS = 60_000;

export function resumeTime(resetAt: Date | null, noticeAt: Date): Date {
  return resetAt ? new Date(resetAt.getTime() + RESET_MARGIN_MS) : new Date(noticeAt.getTime() + UNKNOWN_RESET_DELAY_MS);
}

export function nextChainEntry(chain: QuotaChainEntry[], current: LLMProvider | string): QuotaChainEntry | null {
  return chain.find((entry) => entry.provider !== current) ?? null;
}

export function sessionPermissionMode(sessionId: string, provider: string): string {
  try {
    return localStorage.getItem(`permissionMode-${sessionId}`)
      || localStorage.getItem(`permissionMode-last-${provider}`)
      || 'default';
  } catch {
    return 'default';
  }
}

export async function listPendingResumes(sessionId: string): Promise<ScheduledMessage[]> {
  const response = await api.scheduledMessages.list(sessionId);
  const payload = await response.json();
  const rows: ScheduledMessage[] = Array.isArray(payload?.data) ? payload.data : [];
  return rows.filter((row) => row.status === 'pending' && row.content === RESUME_MESSAGE);
}

export async function scheduleResume(sessionId: string, provider: string, at: Date): Promise<void> {
  const scheduledFor = at.getTime() > Date.now() ? at : new Date(Date.now() + RESET_MARGIN_MS);
  const response = await api.scheduledMessages.create({
    sessionId,
    content: RESUME_MESSAGE,
    scheduledFor: scheduledFor.toISOString(),
    options: { permissionMode: sessionPermissionMode(sessionId, provider) },
  });
  if (!response.ok) throw new Error(`Programmation refusée (${response.status}).`);
}

export async function cancelResumes(rows: ScheduledMessage[]): Promise<void> {
  await Promise.all(rows.map((row) => api.scheduledMessages.cancel(row.id)));
}

export async function handOffSession(sessionId: string, currentProvider: string, target: QuotaChainEntry, reason: 'quota' | 'switch' = 'quota'): Promise<string> {
  const { sessionId: nextSessionId } = await pmPost<{ sessionId: string }>('/quota/handoff', {
    sessionId,
    provider: target.provider,
    model: target.model,
    permissionMode: sessionPermissionMode(sessionId, currentProvider),
    reason,
  });
  return nextSessionId;
}

const HANDLED_KEY = 'piecemaker-quota-handled';

export function wasHandled(key: string): boolean {
  try {
    return (JSON.parse(localStorage.getItem(HANDLED_KEY) || '[]') as string[]).includes(key);
  } catch {
    return false;
  }
}

export function markHandled(key: string): void {
  try {
    const keys = (JSON.parse(localStorage.getItem(HANDLED_KEY) || '[]') as string[]).filter((entry) => entry !== key);
    localStorage.setItem(HANDLED_KEY, JSON.stringify([...keys, key].slice(-200)));
  } catch {
    return;
  }
}

export function formatResumeTime(at: Date, now: Date = new Date()): string {
  const sameDay = at.toDateString() === now.toDateString();
  const time = at.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `aujourd’hui à ${time}`;
  return `${at.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} à ${time}`;
}

export function formatDelay(at: Date, now: Date = new Date()): string {
  const minutes = Math.max(0, Math.round((at.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
  return `${Math.round(hours / 24)} jours`;
}
