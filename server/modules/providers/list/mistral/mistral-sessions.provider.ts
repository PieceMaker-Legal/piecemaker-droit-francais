import type { IProviderSessions } from '@/shared/interfaces.js';
import type { AnyRecord, FetchHistoryOptions, FetchHistoryResult, NormalizedMessage } from '@/shared/types.js';
import {
  createNormalizedMessage,
  generateMessageId,
  normalizeProviderTimestamp,
  readObjectRecord,
  readOptionalString,
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

  /**
   * Vibe does not expose a session-history database or file this adapter can
   * read today (unlike Claude/Codex JSONL transcripts or OpenCode's SQLite
   * store). History replay is therefore not yet available for Mistral
   * sessions; the transcript that was streamed live to the client during the
   * run remains the only record of the conversation.
   */
  async fetchHistory(
    _sessionId: string,
    _options: FetchHistoryOptions = {},
  ): Promise<FetchHistoryResult> {
    return { messages: [], total: 0, hasMore: false, offset: 0, limit: null };
  }

  getProviderId(): string {
    return PROVIDER;
  }
}
