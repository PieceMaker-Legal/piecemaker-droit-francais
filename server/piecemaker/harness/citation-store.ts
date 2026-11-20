import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { locateSourcePassages } from './source-passages.js';

type CitationSnapshot = {
  sessionId: string;
  title: string;
  source: string;
  sourceOrigin?: 'decision-cache';
  citation: {
    ref: number;
    kind?: 'case' | 'article' | 'document' | 'code';
    decision_id?: string;
    article_id?: string;
    doc_id?: string;
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
  const turnSourcesFile = (sessionId: string, block: string) =>
    path.join(directory, 'turns', `${createHash('sha256').update(`${sessionId}\0${block}`).digest('hex')}.md`);
  const validatedFile = (id: string, quote: string) =>
    path.join(directory, 'validees', `${createHash('sha256').update(`${id}\0${quote}`).digest('hex')}.json`);
  return {
    /** Citation d'un texte officiel déjà retrouvée : la même source et le même extrait ne sont pas revérifiés. */
    async validated<T>(id: string, quote: string): Promise<T | null> {
      try { return JSON.parse(await readFile(validatedFile(id, quote), 'utf8')) as T; } catch { return null; }
    },
    async remember(id: string, quote: string, entry: unknown) {
      const file = validatedFile(id, quote);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    },
    async saveTurnSources(sessionId: string, block: string, sources: string) {
      const file = turnSourcesFile(sessionId, block);
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, sources, { mode: 0o600 });
        await rename(temporary, file);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    },
    async readTurnSources(sessionId: string, block: string) {
      try { return await readFile(turnSourcesFile(sessionId, block), 'utf8'); } catch { return null; }
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
        if (forViewing && !snapshot.source && typeof id === 'string' && /^(?:(?:JURITEXT|CETATEXT)\d{12}|[0-9a-f]{24})$/.test(id)) {
          try {
            const file = path.join(homeDir, 'decisions', `${id}.json`);
            const info = await lstat(file);
            if (!info.isFile() || info.size > 8 * 1024 * 1024) return snapshot;
            const cached = JSON.parse(await readFile(file, 'utf8')) as { id?: string; titre?: string; texte?: string };
            if (cached.id !== id || typeof cached.texte !== 'string' || !cached.texte) return snapshot;
            const title = snapshot.title === id && typeof cached.titre === 'string' && cached.titre ? cached.titre : snapshot.title;
            return { ...snapshot, title, source: cached.texte, sourceOrigin: 'decision-cache', ranges: locateSourcePassages(cached.texte, snapshot.citation.quotes) };
          } catch { return snapshot; }
        }
        return snapshot;
      } catch {
        return null;
      }
    },
  };
}
