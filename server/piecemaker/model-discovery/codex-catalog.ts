import { createRequire } from 'node:module';

import type { ProviderModelOption, ProviderModelsDefinition } from '@/shared/types.js';

import { withStdioRpcServer, type RpcCall, type StdioRpcServer } from './stdio-rpc.js';

type CodexListedModel = {
  model: string;
  displayName?: string;
  description?: string;
  hidden?: boolean;
  isDefault?: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: { reasoningEffort: string; description?: string }[];
};

type CodexModelListPage = {
  data?: CodexListedModel[];
  nextCursor?: string | null;
};

const MAX_PAGES = 10;

function bundledCodexAppServer(): StdioRpcServer {
  const launcher = createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');
  return { command: process.execPath, args: [launcher, 'app-server'] };
}

function toModelOption(listed: CodexListedModel): ProviderModelOption {
  const efforts = listed.supportedReasoningEfforts ?? [];
  return {
    value: listed.model,
    label: listed.displayName || listed.model,
    ...(listed.description ? { description: listed.description } : {}),
    ...(efforts.length > 0 ? {
      effort: {
        ...(listed.defaultReasoningEffort ? { default: listed.defaultReasoningEffort } : {}),
        values: efforts.map(({ reasoningEffort, description }) => ({
          value: reasoningEffort,
          ...(description ? { description } : {}),
        })),
      },
    } : {}),
  };
}

export async function listCodexModels(call: RpcCall): Promise<ProviderModelsDefinition> {
  const listed: CodexListedModel[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await call('model/list', { cursor, includeHidden: false }) as CodexModelListPage;
    listed.push(...(result.data ?? []));
    cursor = result.nextCursor ?? null;
    if (!cursor) break;
  }

  const visible = listed.filter((model) => model.model && !model.hidden);
  if (visible.length === 0) throw new Error('codex app-server listed no models');
  return {
    OPTIONS: visible.map(toModelOption),
    DEFAULT: (visible.find((model) => model.isDefault) ?? visible[0]).model,
  };
}

export function discoverCodexModels(timeoutMs: number): Promise<ProviderModelsDefinition> {
  return withStdioRpcServer(bundledCodexAppServer(), listCodexModels, timeoutMs);
}
