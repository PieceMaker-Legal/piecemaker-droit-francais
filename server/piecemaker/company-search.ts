import express, { type Request, type Response } from 'express';

const REGISTRE_PUBLIC_MCP_URL = 'https://registre-public.com/api/mcp';
const MCP_PROTOCOL_VERSION = '2025-03-26';
const MCP_TIMEOUT_MS = 20_000;

type JsonRpcPayload = {
  result?: {
    content?: Array<{ type?: string; text?: string }>;
    isError?: boolean;
  };
  error?: { message?: string };
};

export type CompanyDirector = { name: string; role: string };

export type CompanySearchFields = {
  legalName: string;
  legalForm: string;
  status: string;
  siren: string;
  siret: string;
  vat: string;
  legalFormCode: string;
  naf: string;
  creationDate: string;
  category: string;
  address: string;
  directors: CompanyDirector[];
  finances: string[];
  source: string;
};

export type CompanySearchResult = {
  name: string;
  siren: string;
  summary: string;
  url: string;
  details: string;
  fields: CompanySearchFields;
};

function parseMcpPayload(body: string): JsonRpcPayload {
  const trimmed = body.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed) as JsonRpcPayload;
  const payloads = trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as JsonRpcPayload);
  const payload = payloads.at(-1);
  if (!payload) throw new Error('Réponse PERS_MORALE_1 invalide.');
  return payload;
}

async function mcpRequest(id: number, method: string, params: Record<string, unknown>, sessionId?: string): Promise<{ payload: JsonRpcPayload; sessionId?: string }> {
  const response = await fetch(REGISTRE_PUBLIC_MCP_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`Registre Public a répondu ${response.status}.`);
  const payload = parseMcpPayload(body);
  if (payload.error?.message) throw new Error(payload.error.message);
  return { payload, sessionId: response.headers.get('mcp-session-id') || sessionId };
}

async function mcpNotification(method: string, params: Record<string, unknown>, sessionId?: string): Promise<void> {
  const response = await fetch(REGISTRE_PUBLIC_MCP_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, params }),
    signal: AbortSignal.timeout(MCP_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Registre Public a répondu ${response.status}.`);
}

function resultText(payload: JsonRpcPayload): string {
  const text = payload.result?.content?.filter((entry) => entry.type === 'text' && typeof entry.text === 'string').map((entry) => entry.text).join('\n').trim();
  if (!text || payload.result?.isError) throw new Error('Registre Public n’a renvoyé aucun résultat exploitable.');
  return text;
}

function lineValue(text: string, label: string): string {
  const line = text.split('\n').find((entry) => entry.startsWith(label));
  return line ? line.slice(label.length).trim() : '';
}

function parseSearchLine(line: string): { name: string; siren: string; summary: string } | null {
  const match = /^-\s+(.+?)\s+\(([^)]+)\)\s+\|\s+SIREN\s+(\d{9})\s+\|\s+(.+?)\s+\|\s+NAF\s+([^|]+)\s+\|\s+(.+)$/.exec(line.trim());
  if (!match) return null;
  return { name: match[1].trim(), siren: match[3], summary: `${match[2]} · ${match[4].trim()} · NAF ${match[5].trim()} · ${match[6].trim()}` };
}

function parseDirectors(text: string): CompanyDirector[] {
  const start = text.indexOf('Dirigeants:');
  if (start < 0) return [];
  const block = text.slice(start + 'Dirigeants:'.length).split(/\n(?=Finances\b|$)/)[0];
  return block.split('\n').map((line) => /^-\s+(.+?)\s+\(([^)]+)\)$/.exec(line.trim())).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => ({ name: match[1].trim(), role: match[2].trim() }));
}

function parseCompanyDetails(text: string, fallback: { name: string; siren: string }): CompanySearchFields {
  const heading = /^#\s+(.+?)\s+\(([^)]+)\)\s+\(([^)]+)\)/m.exec(text);
  const formAndActivity = lineValue(text, 'Forme juridique (code) :');
  const [legalFormCode, nafPart] = formAndActivity.split('|').map((value) => value.trim());
  const creation = lineValue(text, 'Création :');
  const [creationDate, categoryPart] = creation.split('|').map((value) => value.trim());
  return {
    legalName: heading?.[1]?.trim() || fallback.name,
    legalForm: '',
    status: heading?.[3]?.trim() || '',
    siren: lineValue(text, 'SIREN :').split('|')[0].trim() || fallback.siren,
    siret: (lineValue(text, 'SIREN :').match(/SIRET siège\s*:\s*([^|]+)/)?.[1] || '').trim(),
    vat: lineValue(text, 'N° TVA intracommunautaire :'),
    legalFormCode: legalFormCode || '',
    naf: nafPart?.replace(/^NAF\s*:\s*/, '') || '',
    creationDate: creationDate || '',
    category: categoryPart?.replace(/^Catégorie\s*:\s*/, '') || '',
    address: lineValue(text, 'Adresse du siège :'),
    directors: parseDirectors(text),
    finances: text.split('\n').filter((line) => line.startsWith('Finances ')).map((line) => line.trim()),
    source: lineValue(text, 'Fiche web :'),
  };
}

async function callTool(tool: string, args: Record<string, unknown>): Promise<string> {
  let sessionId: string | undefined;
  const initialized = await mcpRequest(1, 'initialize', {
    protocolVersion: MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'piecemaker-dossier', version: '0.1.0' },
  });
  sessionId = initialized.sessionId;
  await mcpNotification('notifications/initialized', {}, sessionId);
  const result = await mcpRequest(2, 'tools/call', { name: tool, arguments: args }, sessionId);
  return resultText(result.payload);
}

async function searchCompanies(query: string): Promise<CompanySearchResult[]> {
  const searchText = await callTool('rechercher_entreprise', { query });
  const candidates = searchText.split('\n').map(parseSearchLine).filter((entry): entry is { name: string; siren: string; summary: string } => Boolean(entry));
  const results = await Promise.all(candidates.map(async (candidate) => {
    const details = await callTool('fiche_entreprise', { siren: candidate.siren });
    const fields = parseCompanyDetails(details, candidate);
    return {
      name: fields.legalName || candidate.name,
      siren: fields.siren || candidate.siren,
      summary: candidate.summary,
      url: fields.source,
      details,
      fields,
    };
  }));
  return results;
}

export function createCompanySearchRouter() {
  const router = express.Router();
  router.post('/company-search', async (request: Request, response: Response) => {
    const query = typeof request.body?.query === 'string' ? request.body.query.trim().slice(0, 200) : '';
    if (!query) {
      response.status(400).json({ error: 'Un nom ou un SIREN est requis.' });
      return;
    }
    try {
      response.json({ query, results: await searchCompanies(query) });
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : 'Recherche Registre Public impossible.' });
    }
  });
  return router;
}
