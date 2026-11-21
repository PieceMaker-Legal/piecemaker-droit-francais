import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import readline from 'node:readline';

import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import express from 'express';

import { resolveClaudeCodeExecutablePath } from '@/shared/claude-cli-path.js';
import { asyncHandler, createApiSuccessResponse } from '@/shared/utils.js';

export type LimitWindow = { id: 'five_hour' | 'seven_day'; usedPercent: number; resetsAt: string | null };

export type ProviderLimits = {
  provider: 'claude' | 'codex' | 'mistral';
  connected: boolean;
  windows: LimitWindow[];
  message?: string;
};

type Provider = ProviderLimits['provider'];
type Reading = { windows: LimitWindow[]; message?: string };

const CACHE_MS = 60_000;
const TIMEOUT_MS = 20_000;

export const MISTRAL_LIMITS_MESSAGE = 'Mistral ne publie pas de consommation sur 5 h ni à la semaine : son API ne limite que par minute et par mois, et ce suivi reste dans la console Mistral.';

function isoDate(value: unknown): string | null {
  if (typeof value === 'string' && value) return Number.isNaN(Date.parse(value)) ? null : new Date(value).toISOString();
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return new Date(value < 1e12 ? value * 1000 : value).toISOString();
  return null;
}

function percent(value: unknown): number | null {
  const number = Number(value);
  return value !== null && value !== undefined && Number.isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
}

function window(id: LimitWindow['id'], used: unknown, resetsAt: unknown): LimitWindow[] {
  const usedPercent = percent(used);
  return usedPercent === null ? [] : [{ id, usedPercent, resetsAt: isoDate(resetsAt) }];
}

export function claudeWindows(usage: unknown): Reading {
  const record = (usage ?? {}) as { rate_limits_available?: boolean; rate_limits?: Record<string, { utilization?: unknown; resets_at?: unknown } | null> | null };
  if (record.rate_limits_available === false || !record.rate_limits) {
    return { windows: [], message: 'Ce compte Claude n’a pas de limites d’abonnement (clé API, Bedrock ou Vertex) : la consommation se suit à la facture.' };
  }
  const limits = record.rate_limits;
  return {
    windows: [
      ...window('five_hour', limits.five_hour?.utilization, limits.five_hour?.resets_at),
      ...window('seven_day', limits.seven_day?.utilization, limits.seven_day?.resets_at),
    ],
  };
}

type CodexWindow = { usedPercent?: unknown; windowDurationMins?: unknown; resetsAt?: unknown } | null | undefined;

export function codexWindows(result: unknown): Reading {
  const snapshot = (result as { rateLimits?: { primary?: CodexWindow; secondary?: CodexWindow } } | null)?.rateLimits;
  if (!snapshot) return { windows: [], message: 'Codex n’indique pas de limites pour ce compte (clé API OpenAI).' };
  const windows: LimitWindow[] = [];
  for (const [fallback, entry] of [['five_hour', snapshot.primary], ['seven_day', snapshot.secondary]] as const) {
    if (!entry) continue;
    const minutes = Number(entry.windowDurationMins);
    const id = Number.isFinite(minutes) && minutes > 0 ? (minutes >= 24 * 60 ? 'seven_day' : 'five_hour') : fallback;
    if (!windows.some(existing => existing.id === id)) windows.push(...window(id, entry.usedPercent, entry.resetsAt));
  }
  return { windows };
}

function withTimeout<T>(promise: Promise<T>, onTimeout: () => void): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => { onTimeout(); reject(new Error('délai dépassé')); }, TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function readClaudeUsage(): Promise<unknown> {
  const abortController = new AbortController();
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const prompt = (async function* () { await held; yield* []; })();
  const session = query({
    prompt: prompt as AsyncIterable<SDKUserMessage>,
    options: {
      abortController,
      persistSession: false,
      settingSources: [],
      strictMcpConfig: true,
      tools: [],
      pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(process.env.CLAUDE_CLI_PATH),
    },
  });
  const drained = (async () => { try { for await (const message of session) void message; } catch {} })();
  try {
    return await withTimeout(session.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }), () => abortController.abort());
  } finally {
    release();
    abortController.abort();
    await drained;
  }
}

export async function readCodexRateLimits(): Promise<unknown> {
  const launcher = createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');
  const child = spawn(process.execPath, [launcher, 'app-server'], { env: process.env, stdio: ['pipe', 'pipe', 'ignore'] });
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const fail = (error: Error) => { for (const entry of pending.values()) entry.reject(error); pending.clear(); };
  child.on('error', fail);
  child.on('exit', () => fail(new Error('codex app-server arrêté')));
  child.stdin.on('error', fail);
  readline.createInterface({ input: child.stdout }).on('line', line => {
    let message: { id?: unknown; method?: unknown; result?: unknown; error?: { message?: string } };
    try { message = JSON.parse(line); } catch { return; }
    if (typeof message.method === 'string' || typeof message.id !== 'number') return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) entry?.reject(new Error(message.error.message || 'requête refusée'));
    else entry?.resolve(message.result);
  });
  let nextId = 1;
  const call = (method: string, params: unknown) => new Promise<unknown>((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  try {
    return await withTimeout((async () => {
      await call('initialize', { clientInfo: { name: 'piecemaker', title: 'PieceMaker', version: '1' }, capabilities: {} });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);
      return call('account/rateLimits/read', {});
    })(), () => child.kill());
  } finally {
    child.kill();
  }
}

type Dependencies = {
  connected: (userId: number | null) => Promise<{ provider: string; authenticated: boolean }[]>;
  readClaude: () => Promise<unknown>;
  readCodex: () => Promise<unknown>;
  now: () => number;
};

export function createProviderLimits(dependencies: Pick<Dependencies, 'connected'> & Partial<Dependencies>) {
  const { connected, readClaude = readClaudeUsage, readCodex = readCodexRateLimits, now = Date.now } = dependencies;
  const cache = new Map<Provider, { until: number; reading: Promise<Reading> }>();
  const readers: Record<Exclude<Provider, 'mistral'>, () => Promise<Reading>> = {
    claude: async () => claudeWindows(await readClaude()),
    codex: async () => codexWindows(await readCodex()),
  };
  const read = (provider: Exclude<Provider, 'mistral'>, refresh: boolean) => {
    const cached = cache.get(provider);
    if (cached && !refresh && cached.until > now()) return cached.reading;
    const entry = { until: Infinity, reading: readers[provider]() };
    cache.set(provider, entry);
    entry.reading.then(() => { entry.until = now() + CACHE_MS; }, () => { if (cache.get(provider) === entry) cache.delete(provider); });
    return entry.reading;
  };
  return async (userId: number | null, refresh = false): Promise<ProviderLimits[]> => {
    const statuses = await connected(userId);
    const isConnected = (provider: Provider) => statuses.some(status => status.provider === provider && status.authenticated);
    return Promise.all((['claude', 'codex', 'mistral'] as const).map(async (provider): Promise<ProviderLimits> => {
      if (!isConnected(provider)) return { provider, connected: false, windows: [] };
      if (provider === 'mistral') return { provider, connected: true, windows: [], message: MISTRAL_LIMITS_MESSAGE };
      try {
        return { provider, connected: true, ...await read(provider, refresh) };
      } catch (error) {
        return { provider, connected: true, windows: [], message: `Consommation illisible : ${error instanceof Error ? error.message : String(error)}` };
      }
    }));
  };
}

export function createProviderLimitsRouter(limits: ReturnType<typeof createProviderLimits>) {
  const router = express.Router();
  router.get('/provider-limits', asyncHandler(async (request, response) => {
    const id = Number((request as express.Request & { user?: { id?: number } }).user?.id);
    const userId = Number.isSafeInteger(id) && id > 0 ? id : null;
    response.json(createApiSuccessResponse({ providers: await limits(userId, request.query.refresh === '1') }));
  }));
  return router;
}
