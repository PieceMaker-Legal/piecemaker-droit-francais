import fsp from 'node:fs/promises';
import path from 'node:path';

import { resolveVibeHome } from '@/modules/providers/list/mistral/mistral-runtime.provider.js';
import type { IProviderSessions } from '@/shared/interfaces.js';
import { prepareTranscriptMessages } from '@/shared/message-unification.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  normalizeProviderTimestamp,
  readObjectRecord,
  readOptionalString,
  sliceTailPage,
} from '@/shared/utils.js';

const PROVIDER = 'mistral';

/**
 * Extracts plain text from a Vibe `content` array (`[{ type: 'text', text }]`).
 * Vibe messages can also carry non-text content blocks (tool_use, tool_result);
 * this helper only concatenates the text blocks for display purposes.
 */
const extractContentText = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map((block) => {
      const record = readObjectRecord(block);
      if (!record) {
        return '';
      }
      if (readOptionalString(record.type) === 'text') {
        return readOptionalString(record.text) ?? '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n');
};

/**
 * Extracts tool_use blocks from a Vibe `content` array, if any.
 *
 * Block type confirmed as `tool_use` (not `tool_call`) by a third-party
 * transcript parser for Mistral Vibe's `.jsonl` format (kaizen-cli,
 * modern_jsonl_event.rs): `message.content[].type === 'tool_use' |
 * 'tool_result'`. The live `--output streaming` shape this app has actually
 * observed only reached a `role: 'user'` echo before hitting a 402 error, so
 * whether tool blocks sit under `content` directly or under `message.content`
 * in streaming mode is unconfirmed — this checks both locations.
 */
const extractToolUses = (raw: AnyRecord): AnyRecord[] => {
  const messageRecord = readObjectRecord(raw.message);
  const content = Array.isArray(raw.content) ? raw.content : messageRecord?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map((block) => readObjectRecord(block))
    .filter((record): record is AnyRecord => Boolean(record) && readOptionalString(record?.type) === 'tool_use');
};

/**
 * Extracts tool_result blocks from a Vibe `content` array, if any.
 * See `extractToolUses` for the source of the `tool_result` type name and
 * the `content` vs `message.content` uncertainty.
 */
const extractToolResults = (raw: AnyRecord): AnyRecord[] => {
  const messageRecord = readObjectRecord(raw.message);
  const content = Array.isArray(raw.content) ? raw.content : messageRecord?.content;
  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map((block) => readObjectRecord(block))
    .filter((record): record is AnyRecord => Boolean(record) && readOptionalString(record?.type) === 'tool_result');
};

const formatToolContent = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

type VibeSessionLog = { records: AnyRecord[]; startTime: unknown };

const readVibeSessionLog = async (vibeSessionId: string): Promise<VibeSessionLog | null> => {
  const root = path.join(resolveVibeHome(), 'logs', 'session');
  let entries: string[];
  try {
    entries = await fsp.readdir(root);
  } catch {
    return null;
  }
  for (const entry of entries.filter((name) => name.endsWith(`_${vibeSessionId.slice(0, 8)}`))) {
    try {
      const meta = JSON.parse(await fsp.readFile(path.join(root, entry, 'meta.json'), 'utf8'));
      if (meta?.session_id !== vibeSessionId) continue;
      const lines = (await fsp.readFile(path.join(root, entry, 'messages.jsonl'), 'utf8')).split('\n');
      const records = lines.flatMap((line) => {
        try {
          const record = readObjectRecord(JSON.parse(line));
          return record ? [record] : [];
        } catch {
          return [];
        }
      });
      return { records, startTime: meta.start_time };
    } catch {
      continue;
    }
  }
  return null;
};

const parseToolArguments = (value: unknown): unknown => {
  if (typeof value !== 'string') return value ?? {};
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const normalizeVibeLog = (records: AnyRecord[], sessionId: string, timestamp: string): NormalizedMessage[] => {
  const messages: NormalizedMessage[] = [];
  const toolUses = new Map<string, NormalizedMessage>();
  records.forEach((record, index) => {
    if (record.injected === true) return;
    const role = readOptionalString(record.role);
    const baseId = readOptionalString(record.message_id) ?? `mistral_history_${index}`;
    const base = { sessionId, timestamp, provider: PROVIDER } as const;
    if (role === 'user') {
      const content = extractContentText(record.content);
      if (content.trim()) messages.push(createNormalizedMessage({ ...base, id: baseId, kind: 'text', role: 'user', content }));
      return;
    }
    if (role === 'assistant') {
      const reasoning = readOptionalString(record.reasoning_content);
      if (reasoning?.trim()) {
        messages.push(createNormalizedMessage({ ...base, id: readOptionalString(record.reasoning_message_id) ?? `${baseId}_reasoning`, kind: 'thinking', content: reasoning }));
      }
      for (const call of Array.isArray(record.tool_calls) ? record.tool_calls : []) {
        const callRecord = readObjectRecord(call);
        const fn = readObjectRecord(callRecord?.function);
        const toolId = readOptionalString(callRecord?.id) ?? `${baseId}_tool_${toolUses.size}`;
        const toolUse = createNormalizedMessage({
          ...base,
          id: `${baseId}_${toolId}`,
          kind: 'tool_use',
          toolName: readOptionalString(fn?.name) ?? 'Tool',
          toolInput: parseToolArguments(fn?.arguments),
          toolId,
        });
        toolUses.set(toolId, toolUse);
        messages.push(toolUse);
      }
      const content = extractContentText(record.content);
      if (content.trim()) messages.push(createNormalizedMessage({ ...base, id: baseId, kind: 'text', role: 'assistant', content }));
      return;
    }
    if (role === 'tool') {
      const toolUse = toolUses.get(readOptionalString(record.tool_call_id) ?? '');
      if (!toolUse) return;
      const content = formatToolContent(record.content);
      toolUse.toolResult = { content, isError: content.trimStart().startsWith('<tool_error>') };
    }
  });
  return messages;
};

export class MistralSessionsProvider implements IProviderSessions {
  /**
   * Normalizes live `vibe -p ... --output streaming` NDJSON events into
   * frontend messages.
   *
   * Confirmed event shape (Vibe CLI, streaming output mode, from a live run):
   * {
   *   id, sessionId, turnId, createdAt, updatedAt,
   *   generationStatus: 'completed' | 'in_progress' | ...,
   *   type: 'message',
   *   role: 'user' | 'assistant' | 'tool',
   *   content: [{ type: 'text', text } | ...],
   *   source: 'turn_start' | ...,
   * }
   *
   * Only the `role: 'user'` echo with a `text` block has actually been
   * observed; the run hit a billing error before an assistant turn or any
   * tool call arrived. Tool block type names (`tool_use`/`tool_result`) are
   * carried over from Vibe's on-disk `.jsonl` transcript format via a
   * third-party parser (kaizen-cli), not from a confirmed streaming-mode
   * sample — see `extractToolUses` for detail.
   */
  normalizeMessage(rawMessage: unknown, sessionId: string | null): NormalizedMessage[] {
    const raw = readObjectRecord(rawMessage);
    if (!raw) {
      return [];
    }

    const eventSessionId = readOptionalString(raw.sessionId) ?? sessionId;
    const timestamp = normalizeProviderTimestamp(raw.updatedAt ?? raw.createdAt);
    const baseId = readOptionalString(raw.id) ?? generateMessageId('mistral');
    const role = readOptionalString(raw.role);
    const type = readOptionalString(raw.type);

    // Vibe echoes the user's own turn_start message back on stdout; the client
    // already renders an optimistic bubble for what it sent, so this must not
    // be re-emitted as a message.
    if (role === 'user') {
      return [];
    }

    if (type !== 'message') {
      return [];
    }

    const messages: NormalizedMessage[] = [];

    const toolUses = extractToolUses(raw);
    const toolResults = extractToolResults(raw);

    for (const toolUse of toolUses) {
      const toolId = readOptionalString(toolUse.id) ?? readOptionalString(toolUse.callId) ?? readOptionalString(toolUse.tool_use_id) ?? `${baseId}_tool`;
      messages.push(createNormalizedMessage({
        id: `${baseId}_${toolId}`,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: readOptionalString(toolUse.name) ?? readOptionalString(toolUse.tool) ?? 'Tool',
        toolInput: toolUse.input ?? toolUse.arguments ?? {},
        toolId,
      }));
    }

    for (const toolResult of toolResults) {
      const toolId = readOptionalString(toolResult.id) ?? readOptionalString(toolResult.callId) ?? `${baseId}_tool`;
      messages.push(createNormalizedMessage({
        id: `${baseId}_${toolId}_result`,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'tool_use',
        toolName: readOptionalString(toolResult.name) ?? readOptionalString(toolResult.tool) ?? 'Tool',
        toolInput: {},
        toolId,
        toolResult: {
          content: formatToolContent(toolResult.output ?? toolResult.content ?? toolResult.error),
          isError: Boolean(toolResult.error) || readOptionalString(toolResult.status) === 'error',
        },
      }));
    }

    const text = extractContentText(raw.content ?? readObjectRecord(raw.message)?.content);
    if (text.trim()) {
      messages.push(createNormalizedMessage({
        id: baseId,
        sessionId: eventSessionId,
        timestamp,
        provider: PROVIDER,
        kind: 'stream_delta',
        content: text,
      }));
    }

    return messages;
  }

  async fetchHistory(
    sessionId: string,
    options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    const { limit = null, offset = 0 } = options;
    const log = await readVibeSessionLog(options.providerSessionId ?? sessionId);
    const normalized = log ? normalizeVibeLog(log.records, sessionId, normalizeProviderTimestamp(log.startTime)) : [];
    const transcript = prepareTranscriptMessages(normalized);
    const normalizedOffset = Math.max(0, offset);
    const normalizedLimit = limit === null ? null : Math.max(0, limit);
    const { page, hasMore } = sliceTailPage(transcript, normalizedLimit, normalizedOffset);
    return { messages: page, total: transcript.length, hasMore, offset: normalizedOffset, limit: normalizedLimit };
  }

  getProviderId(): string {
    return PROVIDER;
  }
}
