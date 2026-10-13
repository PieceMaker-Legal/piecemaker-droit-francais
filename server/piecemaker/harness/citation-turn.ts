import { createRequire } from 'node:module';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { NormalizedMessage } from '@/shared/types.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import type { createCitationStore } from './citation-store.js';
import { formatPieceTitle } from './piece-title.js';
import { locateSourcePassages, nearestPassage } from './source-passages.js';

const root = findApplicationRoot(getModuleDirectory(import.meta.url));
const require = createRequire(import.meta.url);
const vendor = path.join(root, 'server/piecemaker/vendor/piecemaker-plugin/scripts/lib');
const { parseCitationsWithDiagnostics } = require(path.join(vendor, 'citations.cjs'));
const { verifyCitations } = require(path.join(vendor, 'verify-citations.cjs'));
const { extractFullText, extractSourceTitle } = require(path.join(root, 'server/piecemaker/harness/decisions.cjs'));
const SOURCE_TOOL = /(?:^|_)consulter_(?:decision|article)$/;
const { structuredMarkdownCounterpart } = require(path.join(vendor, 'case-folder-structure.cjs'));
const OPEN = '<CITATIONS>';
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_TURN_CHARACTERS = 32 * 1024 * 1024;

type Citation = Parameters<ReturnType<typeof createCitationStore>['save']>[0]['citation'] & {
  kind: 'case' | 'article' | 'document';
  decision_id?: string;
  article_id?: string;
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

const inline = (text: string) => text.replace(/\[\[PAGE_BREAK\]\]/g, ' … ').replace(/\s+/g, ' ').trim();
const linkLabel = (text: string) => text.replace(/\[/g, '(').replace(/\]/g, ')');

function locator(citation: Citation) {
  const quote = citation.quotes[0];
  if (citation.kind !== 'document' || !quote) return '';
  if (quote.sheet) return `, ${quote.sheet}${quote.cell ? `!${quote.cell}` : ''}`;
  return quote.page ? `, p. ${quote.page}` : '';
}

function sourceLine(citation: Citation, title: string, source: string) {
  const checked = citation.verified !== false;
  const quotes = citation.quotes.map((quote) => {
    if (quote.verification?.verified ?? checked) return `« ${inline(quote.quote)} »`;
    const nearest = source ? nearestPassage(source, quote.quote) : null;
    return `[à vérifier – introuvable]${nearest ? ` — passage le plus proche : « ${inline(nearest)} »` : ''}`;
  });
  return `- [${citation.ref}] ${checked ? '' : '🔴 '}[${linkLabel(title + locator(citation))}][${citation.ref}] — ${quotes.join(' · ')}`;
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
  pieceTitle?: (cwd: string, docId: string) => string;
}) {
  const calls = new Map<string, string>();
  const decisions = new Map<string, string>();
  const decisionTitles = new Map<string, string>();
  const documents = new Map<string, Promise<string>>();
  let sourceCharacters = 0;
  let fullText = '';
  let visibleTail = '';
  let hidden = false;
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

  return {
    get hasCitations() { return hidden; },
    observe(message: NormalizedMessage) {
      if (message.parentToolUseId) return;
      if (message.kind === 'tool_use' && message.toolId && SOURCE_TOOL.test(message.toolName ?? '')) {
        let input = record(message.toolInput);
        if (typeof message.toolInput === 'string') {
          try { input = record(JSON.parse(message.toolInput)); } catch { return; }
        }
        const id = input.text_id ?? input.article_id ?? input.id;
        if (typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id)) calls.set(message.toolId, id);
      }
      if ((message.kind === 'tool_result' || message.toolResult) && message.toolId && !message.isError && !message.toolResult?.isError) {
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
      if (hidden) return '';
      const combined = visibleTail + delta;
      const marker = combined.indexOf(OPEN);
      if (marker >= 0) {
        hidden = true;
        visibleTail = '';
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
        hidden = true;
      }
      return visibleText(text);
    },
    finish() {
      if (finished) return finished;
      finished = (async () => {
        const block = overflow || !fullText.includes(OPEN) ? '' : fullText.slice(fullText.indexOf(OPEN));
        const replay = options.recordVerification === false;
        if (replay && block) {
          const saved = await options.store.readTurnSources(options.sessionId, block);
          if (saved !== null) return saved;
        }
        const parsed = overflow ? [] : parseCitationsWithDiagnostics(fullText).citations as Citation[];
        const citations = await verifyCitations(parsed, documentText, async (id: string) => decisions.get(id) ?? '') as Citation[];
        if (citations.length && options.recordVerification !== false) await options.store.recordVerification(options.sessionId, citations);
        const decisionTitle = (id?: string) => (id ? decisionTitles.get(id) : undefined);
        const links: string[] = [];
        const lines: string[] = [];
        for (const citation of citations) {
          const lawId = citation.decision_id ?? citation.article_id;
          const source = citation.kind === 'case' || citation.kind === 'article'
            ? decisions.get(lawId ?? '') ?? '' : await documentText(citation.doc_id ?? '');
          const ranges = locateSourcePassages(source, citation.quotes);
          const docId = citation.doc_id ?? '';
          const title = citation.kind === 'document'
            ? options.pieceTitle?.(options.cwd, docId) ?? formatPieceTitle(undefined, docId)
            : decisionTitle(lawId) ?? lawId ?? 'Source';
          try {
            const token = await options.store.save({ sessionId: options.sessionId, title, source, citation, ranges });
            links.push(`[${citation.ref}]: #piecemaker-citation=${token}`);
            lines.push(sourceLine(citation, title, source));
          } catch {
            lines.push(`- [${citation.ref}] 🔴 ${linkLabel(title)} — source indisponible`);
          }
        }
        const sources = lines.length ? `\n\n**Sources**\n\n${lines.join('\n')}\n\n${links.join('\n')}` : '';
        if (!replay && block) await options.store.saveTurnSources(options.sessionId, block, sources).catch(() => {});
        return sources;
      })();
      return finished;
    },
  };
}
