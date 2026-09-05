import { createHash, randomUUID } from 'node:crypto';
import { access, appendFile, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { locateSourcePassages } from './source-passages.js';

type CitationSnapshot = {
  sessionId: string;
  title: string;
  source: string;
  sourceOrigin?: 'decision-cache';
  citation: {
    ref: number;
    decision_id?: string;
    verified?: boolean;
    quotes: Array<{
      quote: string;
      page?: number | string;
      sheet?: string;
      cell?: string;
      verification?: { verified: boolean; start_char?: number; end_char?: number; source_excerpt?: string };
    }>;
  };
  ranges: Array<{ start: number; end: number; quoteIndex: number }>;
};

export function createCitationStore(homeDir: string) {
  const directory = path.join(homeDir, 'citation-sources');
  return {
    async recordVerification(sessionId: string, citations: Array<{ ref: number; kind: string; doc_id?: string; decision_id?: string; verified?: boolean }>) {
      try {
        await mkdir(homeDir, { recursive: true, mode: 0o700 });
        await appendFile(path.join(homeDir, 'citations-verifiees.jsonl'), `${JSON.stringify({
          session_id: sessionId, at: new Date().toISOString(), citations: citations.length,
          non_verifiees: citations.filter((citation) => citation.verified === false).length,
          details: citations.map((citation) => ({
            id: `${citation.kind === 'case' ? 'decision' : 'document'}:${citation.decision_id ?? citation.doc_id}#${citation.ref}`,
            verified: citation.verified === true,
          })),
        })}\n`, { mode: 0o600 });
      } catch {}
    },
    async save(snapshot: CitationSnapshot) {
      const serialized = JSON.stringify(snapshot);
      const token = createHash('sha256').update(serialized).digest('hex');
      const file = path.join(directory, `${token}.json`);
      try { await access(file); return token; } catch {}
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, serialized, { mode: 0o600 });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(() => {});
      }
      return token;
    },
    async read(token: string, { forViewing = false } = {}): Promise<CitationSnapshot | null> {
      if (!/^[a-f0-9]{64}$/.test(token)) return null;
      try {
        const snapshot = JSON.parse(await readFile(path.join(directory, `${token}.json`), 'utf8')) as CitationSnapshot;
        const id = snapshot.citation.decision_id;
        if (forViewing && !snapshot.source && typeof id === 'string' && /^(JURITEXT|CETATEXT)\d{12}$/.test(id)) {
          try {
            const file = path.join(homeDir, 'decisions', `${id}.json`);
            const info = await lstat(file);
            if (!info.isFile() || info.size > 8 * 1024 * 1024) return snapshot;
            const cached = JSON.parse(await readFile(file, 'utf8')) as { id?: string; texte?: string };
            if (cached.id !== id || typeof cached.texte !== 'string' || !cached.texte) return snapshot;
            return { ...snapshot, source: cached.texte, sourceOrigin: 'decision-cache', ranges: locateSourcePassages(cached.texte, snapshot.citation.quotes) };
          } catch { return snapshot; }
        }
        return snapshot;
      } catch {
        return null;
      }
    },
  };
}
