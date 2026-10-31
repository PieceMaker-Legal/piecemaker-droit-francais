import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { withDecisionCache } from '../server/decision-cache.js';
import type { LegifranceApi } from '../server/legifrance.js';

const signal = new AbortController().signal;
const legifranceId = 'JURITEXT000099990001';
const judilibreId = '0123456789abcdef01234567';

function fakeApi(consulted: object = { text: { titre: 'Cour de cassation, 12 mars 2024', texte: 'Texte fictif.' } }) {
  return {
    search: vi.fn(async () => ({})),
    consult: vi.fn(async () => consulted),
    judilibre: vi.fn(async () => ({ id: judilibreId, location: 'Cour de cassation', decision_date: '2024-03-12', text: 'Texte Judilibre fictif.' })),
  } as unknown as LegifranceApi & Record<'search' | 'consult' | 'judilibre', ReturnType<typeof vi.fn>>;
}

describe('cache des décisions', () => {
  let directory: string;
  const stored = (id: string) => JSON.parse(fs.readFileSync(path.join(directory, `${id}.json`), 'utf8'));

  beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-decisions-')); });
  afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); });

  it('ne consulte Légifrance qu’une fois et écrit la forme lue par la visionneuse', async () => {
    const api = fakeApi();
    const cached = withDecisionCache(api, directory);
    const first = await cached.consult(legifranceId, signal);
    expect(await cached.consult(legifranceId, signal)).toEqual(first);
    expect(api.consult).toHaveBeenCalledTimes(1);
    expect(stored(legifranceId)).toMatchObject({ id: legifranceId, titre: 'Cour de cassation, 12 mars 2024', texte: 'Texte fictif.' });
  });

  it('ne consulte Judilibre qu’une fois par décision, sans cacher les recherches', async () => {
    const api = fakeApi();
    const cached = withDecisionCache(api, directory);
    const params = new URLSearchParams({ id: judilibreId, resolve_references: 'true' });
    await cached.judilibre('/decision', params, signal);
    await cached.judilibre('/decision', params, signal);
    await cached.judilibre('/search', new URLSearchParams({ query: 'contrat' }), signal);
    await cached.judilibre('/search', new URLSearchParams({ query: 'contrat' }), signal);
    expect(api.judilibre).toHaveBeenCalledTimes(3);
    expect(stored(judilibreId).titre).toContain('Cour de cassation');
  });

  it('retélécharge une réponse sans texte et une ancienne entrée sans réponse brute', async () => {
    const empty = fakeApi({ text: {} });
    const cached = withDecisionCache(empty, directory);
    await cached.consult(legifranceId, signal);
    await cached.consult(legifranceId, signal);
    expect(empty.consult).toHaveBeenCalledTimes(2);

    fs.writeFileSync(path.join(directory, `${legifranceId}.json`), JSON.stringify({ id: legifranceId, texte: 'Ancien texte.' }));
    const api = fakeApi();
    await withDecisionCache(api, directory).consult(legifranceId, signal);
    expect(api.consult).toHaveBeenCalledTimes(1);
    expect(stored(legifranceId).texte).toBe('Texte fictif.');
  });

  it('n’écrit rien pour un identifiant avec un chemin', async () => {
    const api = fakeApi();
    await withDecisionCache(api, directory).consult('../evasion', signal);
    expect(fs.readdirSync(directory)).toEqual([]);
  });
});
