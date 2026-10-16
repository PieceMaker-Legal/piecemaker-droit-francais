import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { readLegalPeriod } from '@/modules/piecemaker-reasoning/index.js';
import type { NormalizedMessage } from '@/shared/types.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { resolvePieceRef } from '../file-links.js';
import type { ReasoningSource } from '../../../shared/piecemaker-reasoning.js';

import type { createCitationStore } from './citation-store.js';
import { formatPieceTitle } from './piece-title.js';
import { applyNearestPassages, locateSourcePassages } from './source-passages.js';

const root = findApplicationRoot(getModuleDirectory(import.meta.url));
const require = createRequire(import.meta.url);
const vendor = path.join(root, 'server/piecemaker/vendor/piecemaker-plugin/scripts/lib');
const { parseCitationsWithDiagnostics } = require(path.join(vendor, 'citations.cjs'));
const { verifyCitations } = require(path.join(vendor, 'verify-citations.cjs'));
const { extractFullText, extractSourceTitle } = require(path.join(root, 'server/piecemaker/harness/decisions.cjs'));
const SOURCE_TOOL = /(?:^|_)consulter_(?:decision|article)$/;
const { markdownCounterpart } = require(path.join(vendor, 'protection.cjs'));
const JSZip = require('jszip');
const OPEN = '<CITATIONS>';
const MISS = '#piecemaker-cite-miss';
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_TURN_CHARACTERS = 32 * 1024 * 1024;
const DOCX_PART = /^(word\/document\.xml|word\/(?:header\d*|footer\d*|footnotes|endnotes)\.xml)$/i;
const CODE_EXTENSIONS = new Set(['.cjs', '.css', '.go', '.html', '.js', '.json', '.jsonc', '.jsx', '.md', '.mjs', '.py', '.rs', '.sh', '.sql', '.toml', '.ts', '.tsx', '.xml', '.yaml', '.yml']);
const CODE_EXTENSIONLESS_PATHS = new Set(['.husky/commit-msg', '.husky/pre-commit', '.husky/pre-push', '.oxlintrc']);

type Citation = Parameters<ReturnType<typeof createCitationStore>['save']>[0]['citation'] & {
  kind: 'case' | 'article' | 'document' | 'code';
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

function decodeXmlText(value: string) {
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|amp|lt|gt|quot|apos);/gi, (entity, decimal, hexadecimal) => {
    const codePoint = decimal ? Number(decimal) : Number.parseInt(hexadecimal, 16);
    if ((decimal || hexadecimal) && Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff) {
      return String.fromCodePoint(codePoint);
    }
    if (decimal || hexadecimal) return entity;
    return { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }[entity.toLowerCase()] ?? entity;
  });
}

function wordXmlToText(xml: string) {
  const source = xml.replace(/<w:(?:del|moveFrom)\b[^>]*>[\s\S]*?<\/w:(?:del|moveFrom)>/gi, '');
  const tokens = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?\s*>|<w:br\b[^>]*\/?\s*>|<\/w:p\s*>|<\/w:tc\s*>/gi;
  let text = '';
  let match: RegExpExecArray | null;
  while ((match = tokens.exec(source))) {
    if (match[1] !== undefined) text += decodeXmlText(match[1].replace(/<[^>]+>/g, ''));
    else if (/^<\/w:p/i.test(match[0])) text += '\n';
    else if (/^<\/w:tc/i.test(match[0]) || /^<w:tab/i.test(match[0])) text += '\t';
    else text += '\n';
  }
  return text.replace(/\r/g, '').split('\n').map((line) => line.replace(/[ \t]+$/g, '')).filter((line, index, lines) => line || (index > 0 && lines[index - 1])).join('\n').trim();
}

async function extractDocxSource(file: string) {
  const zip = await JSZip.loadAsync(await readFile(file));
  const parts: string[] = [];
  for (const name of Object.keys(zip.files)) {
    if (!DOCX_PART.test(name)) continue;
    const xml = await zip.file(name)?.async('string');
    if (!xml) continue;
    const text = wordXmlToText(xml);
    if (text) parts.push(text);
  }
  return parts.join('\n');
}

const inline = (text: string) => text.replace(/\[\[PAGE_BREAK\]\]/g, ' … ').replace(/\s+/g, ' ').trim();
const linkLabel = (text: string) => text.replace(/\[/g, '(').replace(/\]/g, ')');

function locator(citation: Citation, ranges: Array<{ start: number; end: number; quoteIndex: number }>, source: string) {
  const quote = citation.quotes[0];
  if (citation.kind === 'code') {
    const range = ranges.find((entry) => entry.quoteIndex === 0);
    return range ? `, l. ${source.slice(0, range.start).split('\n').length}` : '';
  }
  if (citation.kind !== 'document' || !quote) return '';
  if (quote.sheet) return `, ${quote.sheet}${quote.cell ? `!${quote.cell}` : ''}`;
  return quote.page ? `, p. ${quote.page}` : '';
}

function sourceLine(citation: Citation, title: string, source: string, ranges: Array<{ start: number; end: number; quoteIndex: number }>) {
  const quotes = citation.quotes.map((quote) => {
    const excerpt = `« ${inline(quote.quote)} »`;
    if (quote.verification?.verified ?? citation.verified !== false) return excerpt;
    return `${excerpt} — [citation non retrouvée, à vérifier](${MISS})`;
  });
  return `- [${citation.ref}] [${linkLabel(title + locator(citation, ranges, source))}][${citation.ref}] — ${quotes.join(' · ')}`;
}

function visibleText(text: string) {
  const index = text.indexOf(OPEN);
  return index < 0 ? text : text.slice(0, index);
}

export function createCitationTurn(options: {
  cwd: string;
  sessionId: string;
  store: ReturnType<typeof createCitationStore>;
  codeRoot?: string;
  recordVerification?: boolean;
  pieceTitle?: (cwd: string, docId: string) => string;
  onVerifiedTurn?: (input: { cwd: string; sessionId: string; turnId: string; block: string; sources: ReasoningSource[] }) => string | Promise<string>;
}) {
  const programTurnId = randomUUID();
  const calls = new Map<string, string>();
  const decisions = new Map<string, string>();
  const decisionTitles = new Map<string, string>();
  const documents = new Map<string, Promise<string>>();
  const codeFiles = new Map<string, Promise<string>>();
  const codeRoot = path.resolve(options.codeRoot ?? options.cwd);
  let sourceCharacters = 0;
  let fullText = '';
  let visibleTail = '';
  let hidden = false;
  let overflow = false;
  let finished: Promise<string> | undefined;

  const takeSource = async (text: string) => {
    sourceCharacters += text.length;
    return sourceCharacters <= MAX_TURN_CHARACTERS ? text : '';
  };

  const markdownSource = async (caseRoot: string, file: string) => {
    const canonical = await realpath(file);
    if (!withinRoot(caseRoot, canonical) || path.extname(canonical).toLowerCase() !== '.md') return '';
    if ((await stat(canonical)).size > MAX_SOURCE_BYTES) return '';
    return takeSource(await readFile(canonical, 'utf8'));
  };

  const documentText = (id: string) => {
    let pending = documents.get(id);
    if (!pending) {
      pending = (async () => {
        try {
          const caseRoot = await realpath(options.cwd);
          const piece = await resolvePieceRef(options.cwd, id) ?? path.resolve(options.cwd, id);
          if (!withinRoot(caseRoot, await realpath(piece).catch(() => piece))) return '';
          const counterpart = markdownCounterpart(piece, options.cwd);
          if (counterpart?.exists && typeof counterpart.path === 'string') {
            const markdown = await markdownSource(caseRoot, counterpart.path).catch(() => '');
            if (markdown) return markdown;
          }
          if (path.extname(piece).toLowerCase() !== '.docx') return '';
          const canonical = await realpath(piece);
          if (!withinRoot(caseRoot, canonical)) return '';
          if ((await stat(canonical)).size > MAX_SOURCE_BYTES) return '';
          return takeSource(await extractDocxSource(canonical));
        } catch { return ''; }
      })();
      documents.set(id, pending);
    }
    return pending;
  };

  const codeText = (id: string) => {
    let pending = codeFiles.get(id);
    if (!pending) {
      pending = (async () => {
        try {
          if (path.resolve(options.cwd) !== codeRoot) return '';
          const requested = path.resolve(codeRoot, id);
          if (!withinRoot(codeRoot, requested)) return '';
          const relative = path.relative(codeRoot, requested).split(path.sep).join('/');
          if (!CODE_EXTENSIONS.has(path.extname(requested).toLowerCase()) && !CODE_EXTENSIONLESS_PATHS.has(relative)) return '';
          const canonical = await realpath(requested);
          const canonicalRoot = await realpath(codeRoot);
          if (!withinRoot(canonicalRoot, canonical)) return '';
          if ((await stat(canonical)).size > MAX_SOURCE_BYTES) return '';
          const text = await readFile(canonical, 'utf8');
          sourceCharacters += text.length;
          return sourceCharacters <= MAX_TURN_CHARACTERS ? text : '';
        } catch { return ''; }
      })();
      codeFiles.set(id, pending);
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
        const citations = await verifyCitations(parsed, (id: string, kind: string) => kind === 'code' ? codeText(id) : documentText(id), async (id: string) => decisions.get(id) ?? '') as Citation[];
        const decisionTitle = (id?: string) => (id ? decisionTitles.get(id) : undefined);
        const links: string[] = [];
        const lines: string[] = [];
        const reasoningSources: ReasoningSource[] = [];
        for (const citation of citations) {
          const lawId = citation.decision_id ?? citation.article_id;
          const source = citation.kind === 'case' || citation.kind === 'article'
            ? decisions.get(lawId ?? '') ?? ''
            : citation.kind === 'code' ? await codeText(citation.doc_id ?? '') : await documentText(citation.doc_id ?? '');
          const exactBeforeRepair = (citation.quotes ?? []).map((quote) => quote.verification?.verified === true);
          const proposedQuotes = citation.quotes.map((quote) => quote.quote);
          citation.quotes = applyNearestPassages(source, citation.quotes ?? []);
          citation.quotes.forEach((quote, index) => { if (!exactBeforeRepair[index] && quote.verification?.verified) quote.proposedQuote = proposedQuotes[index]; });
          citation.verified = citation.quotes.every((quote) => quote.verification?.verified === true);
          const ranges = locateSourcePassages(source, citation.quotes);
          const docId = citation.doc_id ?? '';
          const validity = citation.kind === 'article' ? readLegalPeriod(source) : undefined;
          const simulation = citation.kind === 'document' && /(?:pièce générée à titre imaginaire|document imaginaire|source fictive de démonstration)/i.test(source);
          let openId = docId;
          if (citation.kind === 'document') {
            const original = await resolvePieceRef(options.cwd, docId);
            if (original) {
              const relative = path.relative(await realpath(options.cwd), original).split(path.sep).join('/');
              if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) openId = relative;
            }
          }
          const title = citation.kind === 'code' ? docId : citation.kind === 'document'
            ? options.pieceTitle?.(options.cwd, openId) ?? formatPieceTitle(undefined, openId)
            : decisionTitle(lawId) ?? lawId ?? 'Source';
          try {
            const token = await options.store.save({
              sessionId: options.sessionId,
              title,
              source,
              citation: citation.kind === 'document' ? { ...citation, doc_id: openId } : citation,
              ranges,
            });
            links.push(`[${citation.ref}]: #piecemaker-citation=${token}`);
            const repaired = citation.quotes.some((quote, index) => !exactBeforeRepair[index] && quote.verification?.verified);
            lines.push(sourceLine(citation, title, source, ranges)
              + (repaired ? ' — **extrait recalé automatiquement : soutien de l’affirmation à réexaminer**' : '')
              + (simulation ? ' — **document de simulation**' : '')
              + (citation.kind === 'article' ? validity ? ` — version du ${validity.from} au ${validity.to ?? 'terme non fixé'} (fin exclusive)` : ' — **période de validité inconnue**' : ''));
            if (citation.kind !== 'code') {
              const hash = createHash('sha256').update(source).digest('hex');
              const document = `${citation.kind}:${lawId ?? docId}`;
              citation.quotes.forEach((quote, quoteIndex) => reasoningSources.push({
                id: `src_${createHash('sha256').update(`${document}\0${hash}\0${quote.quote}`).digest('hex')}`,
                ref: citation.ref, quoteIndex, token, document, title, excerpt: quote.quote, hash,
                verified: quote.verification?.verified === true,
                repaired: !exactBeforeRepair[quoteIndex] && quote.verification?.verified === true,
                ...(validity ? { validity } : {}),
                nature: simulation ? 'simulation' : citation.kind as 'document' | 'article' | 'case',
                ...(!exactBeforeRepair[quoteIndex] && quote.verification?.verified ? { proposedExcerpt: proposedQuotes[quoteIndex] } : {}),
              }));
            }
          } catch {
            lines.push(`- [${citation.ref}] ${linkLabel(title)} — [source indisponible](${MISS})`);
          }
        }
        if (citations.length && options.recordVerification !== false) await options.store.recordVerification(options.sessionId, citations);
        let sources = lines.length ? `\n\n**Sources**\n\n${lines.join('\n')}\n\n${links.join('\n')}` : '';
        if (!replay && options.onVerifiedTurn && (reasoningSources.length || /"kind"\s*:\s*"(?:program|reasoning)"/.test(block))) {
          try { sources += await options.onVerifiedTurn({ cwd: options.cwd, sessionId: options.sessionId, turnId: programTurnId, block, sources: reasoningSources }); }
          catch (error) { sources += `\n\nProgramme non mis à jour : ${error instanceof Error ? error.message : 'enregistrement impossible'}.`; }
        }
        if (!replay && block) await options.store.saveTurnSources(options.sessionId, block, sources).catch(() => {});
        return sources;
      })();
      return finished;
    },
  };
}
