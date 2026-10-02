import { describe, expect, it } from 'vitest';

import { researchPage, researchState, researchText, startResearch, waitForResearch } from '../server/research.js';

const live = process.env.LIVE === '1' ? describe : describe.skip;

async function run(input: Record<string, unknown>) {
  const state = startResearch({ dispositifOnly: true, ...input });
  await waitForResearch(state.id);
  const final = researchState(state.id);
  const kept = researchPage(state.id, 1, 'kept');
  const all = [...Array(kept.pageCount).keys()].flatMap((page) => researchPage(state.id, page + 1, 'kept').items);
  const excluded = final.excluded ? researchPage(state.id, 1, 'excluded').items : [];
  const tally = (key: 'origin' | 'zoneOrigin' | 'zone') => all.concat(excluded).reduce<Record<string, number>>((acc, item) => ({ ...acc, [String(item[key])]: (acc[String(item[key])] ?? 0) + 1 }), {});
  console.log(JSON.stringify({ query: input.query, phase: final.phase, error: final.error, warnings: final.warnings, counts: final.counts, total: final.total, listed: final.listed, kept: final.kept, excluded: final.excluded, undetected: final.undetected, failed: final.failed, origin: tally('origin'), zoneOrigin: tally('zoneOrigin'), zone: tally('zone') }, null, 1));
  for (const item of all.slice(0, 4)) console.log(`  #${item.rank} [${item.origin}/${item.zoneOrigin}/${item.zone}] ${item.importance} · ${item.title} · ${item.link}`);
  return { state: final, items: all, excluded };
}

live('recherche réelle Légifrance + Judilibre', () => {
  it('fusionne une décision présente dans les deux bases', async () => {
    const { state, items } = await run({ query: 'bail commercial', sources: ['appel'], sieges: ['ORLEANS'], dateDebut: '2022-12-15', dateFin: '2022-12-15' });
    expect(state.phase).toBe('done');
    const merged = items.find((item) => item.id === 'JURITEXT000046990323');
    console.log('  fusion 22/005011 :', merged && `${merged.origin}/${merged.zoneOrigin}/${merged.zone}`, '— total brut', state.total, '→ distinctes', state.listed);
    const text = researchText(state.id, 'JURITEXT000046990323');
    console.log('  début retenu :', JSON.stringify(text.retained.slice(0, 160)));
  }, 600_000);

  it('cours d’appel récentes via Judilibre', async () => {
    const { state, items } = await run({ query: '"vice caché" mérule', sources: ['appel'], dateDebut: '2023-06-01', dateFin: '2024-12-31' });
    expect(state.phase).toBe('done');
    expect(items.some((item) => item.origin === 'judilibre')).toBe(true);
    const sample = items.find((item) => item.origin === 'judilibre')!;
    const text = researchText(state.id, sample.id);
    console.log('  Judilibre retenu :', JSON.stringify(text.retained.slice(0, 200)), '…', JSON.stringify(text.retained.slice(-160)));
  }, 600_000);

  it('Cassation 2008-2024 : zones officielles et formules', async () => {
    const { state } = await run({ query: 'mérule', sources: ['cassation'], matieres: ['CIVIL'], dateDebut: '2008-01-01', dateFin: '2024-12-31' });
    expect(state.phase).toBe('done');
  }, 900_000);
});

live('expressions exactes dans Judilibre', () => {
  it('retrouve « ordre public » malgré les élisions', async () => {
    const { state } = await run({ query: '"ordre public"', sources: ['appel'], dateDebut: '2024-03-14', dateFin: '2024-03-14', dispositifOnly: false });
    console.log('  retenues', state.kept, '· écartées sans l’expression', state.unmatched, '· total brut', state.total);
  }, 600_000);
});
