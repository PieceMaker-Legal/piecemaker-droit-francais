import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ReasoningConnectors } from '@/modules/piecemaker-reasoning/index.js';

import { createCatalaCitation } from './catala-citation.js';
import { createCitationStore } from './harness/citation-store.js';

test('opens declared Catala references in the citation reader without inventing quote verification', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'catala-citations-'));
  try {
    const store = createCitationStore(home);
    let queries = 0;
    const connectors: Pick<ReasoningConnectors, 'source' | 'match'> = {
      source: async () => { queries++; return { kind: 'texte', title: 'Article fictif', text: 'Texte officiel fictif.', validity: { from: '2020-01-01', to: null } }; },
      match: (text: string, quote: string) => text.includes(quote) ? quote : null,
    };
    const cite = createCatalaCitation(connectors, store);
    const content = '## Article | LEGIARTI000000000001\nCitation : « Texte officiel fictif. »\nCitation : « Texte différent. »';
    for (const [quote, verified] of [['Texte officiel fictif.', true], ['Texte différent.', false], ['', false]] as const) {
      const token = await cite('/dossier-fictif', 'LEGIARTI000000000001', quote, content);
      const saved = await store.read(token);
      assert.equal(saved?.citation.verified, verified);
      assert.equal(saved?.sessionId, 'catala:/dossier-fictif');
      assert.equal(saved?.citation.article_id, 'LEGIARTI000000000001');
      assert.match(saved!.source, /Validité : 2020-01-01/);
      if (verified) assert.equal(saved!.source.slice(saved!.ranges[0].start, saved!.ranges[0].end), quote);
    }
    await assert.rejects(() => cite('/dossier-fictif', 'LEGIARTI000000000002', '', content), /Source absente/);
    await assert.rejects(() => cite('/dossier-fictif', 'LEGIARTI000000000001', 'Citation injectée', content), /Citation absente/);
    assert.equal(queries, 3);
  } finally { await rm(home, { recursive: true, force: true }); }
});
