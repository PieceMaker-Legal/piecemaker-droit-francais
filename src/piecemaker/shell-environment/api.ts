import { authenticatedFetch } from '@/shared/api';

export type ShellEnvironmentState =
  | { status: 'inherited' }
  | { status: 'resolved'; shell: string }
  | { status: 'failed'; shell: string; reason: string };

export async function fetchShellEnvironment(): Promise<ShellEnvironmentState | null> {
  const response = await authenticatedFetch('/api/piecemaker/shell-environment');
  if (!response.ok) return null;
  return response.json();
}
