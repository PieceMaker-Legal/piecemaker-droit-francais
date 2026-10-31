import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { officialTitle } from './judilibre.js';
import type { Json, LegifranceApi } from './legifrance.js';

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

type Described = { title: unknown; text: unknown };

async function readCached(file: string): Promise<Json | null> {
  try {
    const entry = JSON.parse(await fs.readFile(file, 'utf8')) as Json;
    return entry.reponse && typeof entry.reponse === 'object' ? entry.reponse as Json : null;
  } catch {
    return null;
  }
}

async function writeCached(directory: string, file: string, id: string, response: Json, { title, text }: Described): Promise<void> {
  if (typeof text !== 'string' || !text.trim()) return;
  const temporary = path.join(directory, `${id}.${randomUUID()}.tmp`);
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.writeFile(temporary, JSON.stringify({
      kind: 'legifrance-decision',
      id,
      titre: typeof title === 'string' ? title : '',
      texte: text,
      caracteres: text.length,
      source: 'tabular-review',
      at: new Date().toISOString(),
      reponse: response,
    }));
    await fs.rename(temporary, file);
  } catch {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

export function withDecisionCache(api: LegifranceApi, directory: string): LegifranceApi {
  async function cached(id: string, download: () => Promise<Json>, describe: (response: Json) => Described): Promise<Json> {
    if (!ID_RE.test(id)) return download();
    const file = path.join(directory, `${id}.json`);
    const known = await readCached(file);
    if (known) return known;
    const response = await download();
    await writeCached(directory, file, id, response, describe(response));
    return response;
  }

  return {
    search: api.search,
    consult: (id, signal) => cached(id, () => api.consult(id, signal), (response) => {
      const text = (response.text && typeof response.text === 'object' ? response.text : {}) as Json;
      return { title: text.titre, text: text.texte };
    }),
    judilibre: (route, params, signal) => {
      const id = route === '/decision' ? params.get('id') : null;
      if (!id) return api.judilibre(route, params, signal);
      return cached(id, () => api.judilibre(route, params, signal), (response) => ({
        title: officialTitle(response, id),
        text: response.text,
      }));
    },
  };
}
