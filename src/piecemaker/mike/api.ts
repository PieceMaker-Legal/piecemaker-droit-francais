import { authenticatedFetch } from '@/shared/api';

let gatewayOrigin: string | null = null;

export async function openMikePage(path: string): Promise<string> {
  const response = await authenticatedFetch('/api/piecemaker/mike/open', { method: 'POST', body: JSON.stringify({ path }) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'L’espace Mike est indisponible.');
  const url = new URL(body.url);
  gatewayOrigin = url.origin;
  url.searchParams.set('pieceMakerOrigin', window.location.origin);
  return url.toString();
}

export async function closeMikeSession(): Promise<void> {
  const origin = gatewayOrigin;
  gatewayOrigin = null;
  if (origin) await fetch(`${origin}/__piecemaker/close`, { method: 'POST', credentials: 'include' });
}

export async function getMikeQuickActions(): Promise<unknown[]> {
  const response = await authenticatedFetch('/api/piecemaker/mike/quick-actions');
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Les actions rapides Mike sont indisponibles.');
  return Array.isArray(body) ? body : [];
}

export async function getMikeWorkflows(): Promise<unknown[]> {
  const response = await authenticatedFetch('/api/piecemaker/mike/workflows');
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Les workflows Mike sont indisponibles.');
  return Array.isArray(body) ? body : [];
}

export async function getMikeWorkflow(workflowId: string): Promise<unknown> {
  const response = await authenticatedFetch(`/api/piecemaker/mike/workflows/${encodeURIComponent(workflowId)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Le workflow Mike est indisponible.');
  return body;
}

export async function getOrganisationAgents(): Promise<Array<{ path: string; name: string }>> {
  const response = await authenticatedFetch('/api/piecemaker/files');
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Les agents de l’organisation sont indisponibles.');
  return Array.isArray(body.files) ? body.files.filter((file: { kind?: unknown }) => file.kind === 'agent') : [];
}

export async function getOrganisationAgent(path: string): Promise<{ path: string; content: string }> {
  const response = await authenticatedFetch(`/api/piecemaker/file?${new URLSearchParams({ path })}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Le sous-agent est indisponible.');
  if (typeof body.content !== 'string') throw new Error('Le sous-agent est illisible.');
  return { path: String(body.path || path), content: body.content };
}

export async function getMikeData<T>(endpoint: string): Promise<T> {
  const response = await authenticatedFetch(`/api/piecemaker/mike/data?${new URLSearchParams({ endpoint })}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'La ressource Mike est indisponible.');
  return body as T;
}

export async function downloadMikeDocument(documentId: string): Promise<File> {
  const response = await authenticatedFetch(`/api/piecemaker/mike/documents/${encodeURIComponent(documentId)}/download`);
  if (!response.ok) throw new Error('Le document Mike est indisponible.');
  const header = response.headers.get('content-disposition') || '';
  const filename = decodeURIComponent(header.match(/filename\*=UTF-8''([^;]+)/i)?.[1] || header.match(/filename=\"?([^\";]+)/i)?.[1] || 'document');
  return new File([await response.blob()], filename, { type: response.headers.get('content-type') || 'application/octet-stream' });
}
