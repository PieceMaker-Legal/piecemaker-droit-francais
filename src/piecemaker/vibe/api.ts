import { authenticatedFetch } from '@/shared/api';

export type VibeInstallState = { installed: boolean; installing: boolean };

export async function fetchVibeInstallState(): Promise<VibeInstallState | null> {
  const response = await authenticatedFetch('/api/piecemaker/vibe');
  if (!response.ok) return null;
  return response.json();
}

export async function requestVibeInstall(): Promise<void> {
  const response = await authenticatedFetch('/api/piecemaker/vibe/install', { method: 'POST' });
  if (response.ok) return;
  const body = await response.json().catch(() => null) as { error?: string } | null;
  throw new Error(body?.error || `Installation impossible (${response.status}).`);
}
