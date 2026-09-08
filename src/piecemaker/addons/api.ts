import i18n from '@/modules/i18n/config';
import { authenticatedFetch } from '@/shared/api';

let gatewayOrigin: string | null = null;

export async function openAddonsPage(path: string): Promise<string> {
  const response = await authenticatedFetch('/api/piecemaker/mike/open', { method: 'POST', body: JSON.stringify({ path }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || i18n.t('addons:errors.workspaceUnavailable'));
  const url = new URL(body.url);
  gatewayOrigin = url.origin;
  url.searchParams.set('pieceMakerOrigin', window.location.origin);
  return url.toString();
}

export async function closeAddonsSession(): Promise<void> {
  const origin = gatewayOrigin;
  gatewayOrigin = null;
  if (origin) await fetch(`${origin}/__piecemaker/close`, { method: 'POST', credentials: 'include' });
}

export async function getAddonsQuickActions(): Promise<unknown[]> {
  const response = await authenticatedFetch('/api/piecemaker/mike/quick-actions');
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || i18n.t('addons:errors.quickActionsUnavailable'));
  return Array.isArray(body) ? body : [];
}

export async function getAddonsWorkflows(): Promise<unknown[]> {
  const response = await authenticatedFetch('/api/piecemaker/mike/workflows');
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || i18n.t('addons:errors.workflowsUnavailable'));
  return Array.isArray(body) ? body : [];
}

export async function getAddonsWorkflow(workflowId: string): Promise<unknown> {
  const response = await authenticatedFetch(`/api/piecemaker/mike/workflows/${encodeURIComponent(workflowId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || i18n.t('addons:errors.workflowUnavailable'));
  return body;
}

export async function getOrganisationAgents(): Promise<Array<{ path: string; name: string }>> {
  const response = await authenticatedFetch('/api/piecemaker/files');
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || i18n.t('addons:errors.organisationAgentsUnavailable'));
  return Array.isArray(body.files) ? body.files.filter((file: { kind?: unknown }) => file.kind === 'agent') : [];
}

export async function getOrganisationAgent(path: string): Promise<{ path: string; content: string }> {
  const response = await authenticatedFetch(`/api/piecemaker/file?${new URLSearchParams({ path })}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || i18n.t('addons:errors.subAgentUnavailable'));
  if (typeof body.content !== 'string') throw new Error(i18n.t('addons:errors.subAgentUnreadable'));
  return { path: String(body.path || path), content: body.content };
}

export async function getAddonsData<T>(endpoint: string): Promise<T> {
  const response = await authenticatedFetch(`/api/piecemaker/mike/data?${new URLSearchParams({ endpoint })}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || i18n.t('addons:errors.resourceUnavailable'));
  return body as T;
}

export async function downloadAddonsDocument(documentId: string): Promise<File> {
  const response = await authenticatedFetch(`/api/piecemaker/mike/documents/${encodeURIComponent(documentId)}/download`);
  if (!response.ok) throw new Error(i18n.t('addons:errors.documentUnavailable'));
  const header = response.headers.get('content-disposition') || '';
  const filename = decodeURIComponent(header.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || header.match(/filename=\"?([^\";]+)/i)?.[1] || 'document');
  return new File([await response.blob()], filename, { type: response.headers.get('content-type') || 'application/octet-stream' });
}
