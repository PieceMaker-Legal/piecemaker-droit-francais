import { createRequire } from 'node:module';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { NormalizedMessage } from '@/shared/types.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import type { createCitationStore } from './citation-store.js';
import { locateSourcePassages } from './source-passages.js';

const root = findApplicationRoot(getModuleDirectory(import.meta.url));
const require = createRequire(import.meta.url);
const vendor = path.join(root, 'server/piecemaker/vendor/piecemaker-plugin/scripts/lib');
const { parseCitationsWithDiagnostics, parsePartialCitationObjects } = require(path.join(vendor, 'citations.cjs'));
const { verifyCitations } = require(path.join(vendor, 'verify-citations.cjs'));
const { extractFullText, extractSourceTitle } = require(path.join(root, 'server/piecemaker/harness/decisions.cjs'));
const SOURCE_TOOLS = ['__consulter_decision', '__consulter_article'];
const { structuredMarkdownCounterpart } = require(path.join(vendor, 'case-folder-structure.cjs'));
const OPEN = '<CITATIONS>';
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_TURN_CHARACTERS = 32 * 1024 * 1024;

type Citation = Parameters<ReturnType<typeof createCitationStore>['save']>[0]['citation'] & {
  kind: 'case' | 'document';
  decision_id?: string;
  doc_id?: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function toolText(value: unknown): string {
  if (typeof value === 'string') {
    try { return toolText(JSON.parse(value)); } catch { return value; }
  }
  if (Array.isArray(value)) return value.map(toolText).join('\n');
  const object = record(value);
  if (object.isError === true || object.success === false) return '';
  return typeof object.text === 'string' ? object.text : toolText(object.content ?? '');
}

function withinRoot(rootPath: string, file: string) {
  const relative = path.relative(rootPath, file);
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function visibleText(text: string) {
  const index = text.indexOf(OPEN);
  return index < 0 ? text : text.slice(0, index);
}

export function createCitationTurn(options: {
  cwd: string;
  sessionId: string;
  store: ReturnType<typeof createCitationStore>;
  recordVerification?: boolean;
  emit: (event: { type: 'citations'; status: 'started' | 'partial' | 'final'; citations: Citation[] }) => void;
}) {
  const calls = new Map<string, string>();
  const decisions = new Map<string, string>();
  const decisionTitles = new Map<string, string>();
  const documents = new Map<string, Promise<string>>();
  let sourceCharacters = 0;
  let fullText = '';
  let visibleTail = '';
  let hidden = false;
  let partialCount = 0;
  let overflow = false;
  let finished: Promise<string> | undefined;

  const documentText = (id: string) => {
    let pending = documents.get(id);
    if (!pending) {
      pending = (async () => {
        try {
          const caseRoot = await realpath(options.cwd);
          const requested = path.resolve(options.cwd, id);
          if (!withinRoot(path.resolve(options.cwd), requested)) return '';
          const candidate = path.extname(requested).toLowerCase() === '.md'
            ? requested : structuredMarkdownCounterpart(requested, options.cwd, {})?.path;
          if (typeof candidate !== 'string') return '';
          const canonical = await realpath(candidate);
          if (!withinRoot(caseRoot, canonical) || path.extname(canonical).toLowerCase() !== '.md') return '';
          if ((await stat(canonical)).size > MAX_SOURCE_BYTES) return '';
          const text = await readFile(canonical, 'utf8');
          sourceCharacters += text.length;
          return sourceCharacters <= MAX_TURN_CHARACTERS ? text : '';
        } catch { return ''; }
      })();
      documents.set(id, pending);
    }
    return pending;
  };

  const partial = () => {
    const citations = parsePartialCitationObjects(fullText.slice(fullText.indexOf(OPEN) + OPEN.length)) as Citation[];
    if (citations.length > partialCount) {
      partialCount = citations.length;
      options.emit({ type: 'citations', status: 'partial', citations });
    }
  };

  return {
    get hasCitations() { return hidden; },
    observe(message: NormalizedMessage) {
      if (message.parentToolUseId) return;
      if (message.kind === 'tool_use' && message.toolId && SOURCE_TOOLS.some((tool) => message.toolName?.endsWith(tool))) {
        let input = record(message.toolInput);
        if (typeof message.toolInput === 'string') {
          try { input = record(JSON.parse(message.toolInput)); } catch { return; }
        }
        const id = input.text_id ?? input.article_id ?? input.id;
        if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id)) calls.set(message.toolId, id);
      }
      if (message.kind === 'tool_result' && message.toolId && !message.isError && !message.toolResult?.isError) {
        const id = calls.get(message.toolId);
        if (!id) return;
        const raw = toolText(message.content ?? message.toolResult?.content);
        const text = extractFullText(raw) as string;
        if (text.length > MAX_SOURCE_BYTES || text.length <= (decisions.get(id)?.length ?? 0)) return;
        sourceCharacters += text.length;
        if (sourceCharacters <= MAX_TURN_CHARACTERS) {
          decisions.set(id, text);
          const title = extractSourceTitle(raw) as string;
          if (title) decisionTitles.set(id, title);
        }
      }
    },
    delta(delta: string) {
      if (!overflow && fullText.length + delta.length > MAX_TURN_CHARACTERS) {
        overflow = true;
        fullText = '';
      }
      if (!overflow) fullText += delta;
      if (hidden) { if (!overflow) partial(); return ''; }
      const combined = visibleTail + delta;
      const marker = combined.indexOf(OPEN);
      if (marker >= 0) {
        hidden = true;
        visibleTail = '';
        options.emit({ type: 'citations', status: 'started', citations: [] });
        if (!overflow) partial();
        return combined.slice(0, marker);
      }
      const keep = Math.min(OPEN.length - 1, combined.length);
      visibleTail = combined.slice(combined.length - keep);
      return combined.slice(0, combined.length - keep);
    },
    flush() {
      const tail = hidden ? '' : visibleTail;
      visibleTail = '';
      return tail;
    },
    text(text: string) {
      if (text.includes(OPEN)) {
        if (text.length <= MAX_TURN_CHARACTERS) fullText = text;
        else overflow = true;
        if (!hidden) options.emit({ type: 'citations', status: 'started', citations: [] });
        hidden = true;
        if (!overflow) partial();
      }
      return visibleText(text);
    },
    finish() {
      if (finished) return finished;
      finished = (async () => {
        const parsed = overflow ? [] : parseCitationsWithDiagnostics(fullText).citations as Citation[];
        const citations = await verifyCitations(parsed, documentText, async (id: string) => decisions.get(id) ?? '') as Citation[];
        if (citations.length && options.recordVerification !== false) await options.store.recordVerification(options.sessionId, citations);
        const decisionTitle = (id?: string) => (id ? decisionTitles.get(id) : undefined);
        const links: string[] = [];
        const labels: string[] = [];
        for (const citation of citations) {
          const source = citation.kind === 'case'
            ? decisions.get(citation.decision_id ?? '') ?? '' : await documentText(citation.doc_id ?? '');
          const ranges = locateSourcePassages(source, citation.quotes);
          try {
            const token = await options.store.save({
              sessionId: options.sessionId,
              title: decisionTitle(citation.decision_id) ?? citation.decision_id ?? citation.doc_id ?? 'Source',
              source, citation, ranges,
            });
            links.push(`[${citation.ref}]: #piecemaker-citation=${token}`);
            labels.push(`[${citation.ref}]${citation.verified === false ? ' — extrait non retrouvé dans la source' : ''}`);
          } catch {
            labels.push(`Citation ${citation.ref} — source indisponible`);
          }
        }
        options.emit({ type: 'citations', status: 'final', citations });
        if (!links.length && !labels.length) return '';
        return `\n\nSources : ${labels.join(' · ')}\n\n${links.join('\n')}`;
      })();
      return finished;
    },
  };
}
