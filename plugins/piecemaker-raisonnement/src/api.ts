import type { ReasoningLogEntry, ReasoningSnapshot } from '../../../shared/piecemaker-reasoning.js';

export function loadReasoning(projectPath: string | null, example = false, raisonnement?: string): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>(`/api/piecemaker/reasoning${example ? '/example' : `?projectPath=${encodeURIComponent(projectPath ?? '')}${raisonnement ? `&raisonnement=${encodeURIComponent(raisonnement)}` : ''}`}`);
}

export function citeSource(projectPath: string, source: string, citation: string, raisonnement?: string): Promise<{ token: string }> {
  return request<{ token: string }>('/api/piecemaker/reasoning/citation', { projectPath, source, citation, raisonnement });
}

export function dismissIssue(projectPath: string, id: string, restore = false, raisonnement?: string): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>('/api/piecemaker/reasoning/dismiss', { projectPath, id, restore, raisonnement });
}

export function ratePiece(projectPath: string, piece: string, reliable: boolean | null, raisonnement?: string): Promise<ReasoningSnapshot> {
  return request<ReasoningSnapshot>('/api/piecemaker/reasoning/reliability', { projectPath, piece, reliable, raisonnement });
}

export async function runTest(projectPath: string, onEntry: (entry: ReasoningLogEntry) => void, raisonnement?: string): Promise<ReasoningSnapshot> {
  const token = localStorage.getItem('auth-token');
  const response = await fetch('/api/piecemaker/reasoning/test', { method: 'POST', body: JSON.stringify({ projectPath, raisonnement }), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' } });
  if (!response.ok || !response.body) throw new Error((await response.json().catch(() => ({})) as { error?: string }).error || `Erreur ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    buffer += value ?? '';
    const lines = buffer.split('\n');
    buffer = done ? '' : lines.pop()!;
    for (const line of lines.filter((entry) => entry.trim())) {
      const message = JSON.parse(line) as { entry?: ReasoningLogEntry; snapshot?: ReasoningSnapshot; error?: string };
      if (message.entry) onEntry(message.entry);
      if (message.error) throw new Error(message.error);
      if (message.snapshot) return message.snapshot;
    }
    if (done) throw new Error('Test interrompu.');
  }
}

async function request<T>(url: string, body?: object): Promise<T> {
  const token = localStorage.getItem('auth-token');
  const response = await fetch(url, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) } });
  const refreshed = response.headers.get('X-Refreshed-Token');
  if (refreshed) {
    localStorage.setItem('auth-token', refreshed);
    window.dispatchEvent(new CustomEvent('auth-token-refreshed', { detail: refreshed }));
  }
  const data = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Erreur ${response.status}`);
  return data;
}
