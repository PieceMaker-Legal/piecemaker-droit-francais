import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import TOML from '@iarna/toml';

import {
  codexAppServer,
  type CodexAppServerModel,
} from '@/modules/providers/list/codex/codex-app-server.client.js';
import type { IProviderModels } from '@/shared/interfaces.js';
import type {
  ProviderCurrentActiveModel,
  ProviderModelOption,
  ProviderModelsDefinition,
} from '@/shared/types.js';
import {
  buildDefaultProviderCurrentActiveModel,
  readObjectRecord,
  readOptionalString,
} from '@/shared/utils.js';

/** Curated Codex catalog shipped as immutable CloudCLI defaults. */
export const CODEX_PREDEFINED_MODELS: ProviderModelsDefinition = {
  // Chats run the bundled `@openai/codex` CLI, which takes model metadata from
  // its own bundled catalog (`codex debug models --bundled`), from a slug-prefix
  // match against that catalog, or (signed in to ChatGPT) from OpenAI's remote
  // catalog; anything else runs on fallback metadata. So every entry must be
  // one of the bundled catalog's exact slugs, which codex-models.test.ts checks.
  OPTIONS: [
    {
      value: 'gpt-6.2-sol',
      label: 'GPT-6.2 Sol',
      description: 'Fast, go-to model for coding and everyday work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6.2-astra',
      label: 'GPT-6.2 Astra',
      description: 'Our most capable model for complex coding and professional work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6-astra',
      label: 'GPT-6 Astra',
      description: 'Our most capable model for complex, demanding work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6.1-sol',
      label: 'GPT-6.1 Sol',
      description: 'Latest workhorse model for coding and everyday work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6.1-terra',
      label: 'GPT-6.1 Terra',
      description: 'Balanced agentic coding model for everyday work.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6-sol',
      label: 'GPT-6 Sol',
      description: 'Workhorse model for coding and everyday work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-6-luna',
      label: 'GPT-6 Luna',
      description: 'Fast and affordable model for easier tasks.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-5.6-sol',
      label: 'GPT-5.6 Sol',
      description: 'Latest frontier agentic coding model.',
      effort: {
        default: 'low',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-terra',
      label: 'GPT-5.6 Terra',
      description: 'Balanced agentic coding model for everyday work.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
          { value: 'ultra' },
        ],
      },
    },
    {
      value: 'gpt-5.6-luna',
      label: 'GPT-5.6 Luna',
      description: 'Fast and affordable agentic coding model.',
      effort: {
        default: 'medium',
        values: [
          { value: 'low' },
          { value: 'medium' },
          { value: 'high' },
          { value: 'xhigh' },
          { value: 'max' },
        ],
      },
    },
    {
      value: 'gpt-5.5',
      label: 'GPT-5.5',
      description: 'Frontier model for complex coding, research, and real-world work.',
      effort: {
        default: 'medium',
        values: [{ value: 'low' }, { value: 'medium' }, { value: 'high' }, { value: 'xhigh' }],
      },
    },
  ],
  // The model the bundled Codex CLI itself marks as its default.
  DEFAULT: 'gpt-6.2-sol',
};

const CODEX_CONFIG_PATH = path.join(os.homedir(), '.codex', 'config.toml');

/** How long a catalog read from the Codex CLI is reused before it is asked again. */
const LIVE_CATALOG_TTL_MS = 30 * 60_000;
/** How long to wait before asking again after the Codex CLI could not answer. */
const LIVE_CATALOG_RETRY_MS = 2 * 60_000;

const readString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** `GPT-6.2-Sol` -> `GPT-6.2 Sol`, the spelling the curated catalog uses. */
const formatCodexModelLabel = (displayName: string): string => displayName.replace(/^(GPT-[\d.]+)-/i, '$1 ');

/**
 * Turns the Codex CLI's own model list into a picker catalog. Exported for tests.
 *
 * Returns null when the answer has no usable model, so the caller keeps the
 * curated catalog instead of showing an empty picker.
 */
export const buildCodexModelsFromAppServer = (
  models: CodexAppServerModel[],
): ProviderModelsDefinition | null => {
  const curatedByValue = new Map(CODEX_PREDEFINED_MODELS.OPTIONS.map((option) => [option.value, option]));
  const options: ProviderModelOption[] = [];
  let defaultModel = '';

  for (const entry of models) {
    const value = readString(entry?.model);
    if (!value || entry.hidden === true || options.some((option) => option.value === value)) {
      continue;
    }

    const curated = curatedByValue.get(value);
    const efforts = Array.isArray(entry.supportedReasoningEfforts)
      ? (entry.supportedReasoningEfforts as Array<{ reasoningEffort?: unknown }>)
        .map((effort) => readString(effort?.reasoningEffort))
        .filter(Boolean)
      : [];
    const defaultEffort = readString(entry.defaultReasoningEffort);
    const displayName = readString(entry.displayName);

    options.push({
      value,
      label: curated?.label || (displayName ? formatCodexModelLabel(displayName) : value),
      ...((readString(entry.description) || curated?.description)
        ? { description: readString(entry.description) || curated?.description }
        : {}),
      ...(efforts.length > 0
        ? {
          effort: {
            default: efforts.includes(defaultEffort) ? defaultEffort : efforts[0],
            values: efforts.map((effort) => ({ value: effort })),
          },
        }
        : curated?.effort ? { effort: curated.effort } : {}),
    });

    if (entry.isDefault === true && !defaultModel) {
      defaultModel = value;
    }
  }

  if (options.length === 0) {
    return null;
  }

  return { OPTIONS: options, DEFAULT: defaultModel || options[0].value };
};

/** Live discovery can be turned off (tests, offline installs) with CLOUDCLI_CODEX_LIVE_MODELS=false. */
const isLiveCatalogEnabled = (): boolean => !/^(0|false|off|no)$/i.test(process.env.CLOUDCLI_CODEX_LIVE_MODELS ?? '');

/**
 * Provider registry model adapter for Codex models and active config.
 *
 * The picker follows the Codex CLI's own `model/list`, so a model OpenAI ships
 * (in a newer bundled CLI, or in the remote catalog of a ChatGPT sign-in)
 * appears without a CloudCLI release. The curated catalog above is only the
 * fallback for when the CLI cannot be asked.
 */
export class CodexProviderModels implements IProviderModels {
  private liveCatalog: ProviderModelsDefinition | null = null;

  private liveCatalogExpiresAt = 0;

  private pendingLiveCatalog: Promise<ProviderModelsDefinition | null> | null = null;

  constructor(
    private readonly listModels: () => Promise<CodexAppServerModel[]> = () => codexAppServer.listModels(),
  ) {}

  async getSupportedModels(): Promise<ProviderModelsDefinition> {
    if (!isLiveCatalogEnabled()) {
      return CODEX_PREDEFINED_MODELS;
    }

    if (Date.now() < this.liveCatalogExpiresAt) {
      return this.liveCatalog ?? CODEX_PREDEFINED_MODELS;
    }

    this.pendingLiveCatalog ??= this.listModels()
      .then((models) => buildCodexModelsFromAppServer(models))
      .catch((error: unknown) => {
        console.warn('[Codex] Could not read the model list from the Codex CLI; using the built-in list:', error instanceof Error ? error.message : error);
        return null;
      })
      .then((catalog) => {
        this.liveCatalog = catalog;
        this.liveCatalogExpiresAt = Date.now() + (catalog ? LIVE_CATALOG_TTL_MS : LIVE_CATALOG_RETRY_MS);
        return catalog;
      })
      .finally(() => {
        this.pendingLiveCatalog = null;
      });

    return (await this.pendingLiveCatalog) ?? CODEX_PREDEFINED_MODELS;
  }

  async getCurrentActiveModel(): Promise<ProviderCurrentActiveModel> {
    try {
      const raw = await readFile(CODEX_CONFIG_PATH, 'utf8');
      const parsed = readObjectRecord(TOML.parse(raw));
      const model = readOptionalString(parsed?.model);
      if (!model) {
        return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
      }

      return {
        model,
      };
    } catch {
      return buildDefaultProviderCurrentActiveModel(await this.getSupportedModels());
    }
  }
}
