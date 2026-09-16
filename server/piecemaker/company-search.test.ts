import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSearchLine } from './company-search.js';

test('company search accepts registry results without a legal form', () => {
  assert.deepEqual(
    parseSearchLine('- GENSIGHT BIOLOGICS | SIREN 751164757 | en activité | NAF 72.19Z | 74 RUE DU FBG ST ANTOINE 75012 PARIS 12'),
    {
      name: 'GENSIGHT BIOLOGICS',
      siren: '751164757',
      summary: 'en activité · NAF 72.19Z · 74 RUE DU FBG ST ANTOINE 75012 PARIS 12',
    },
  );
});

test('company search preserves a legal form in registry results', () => {
  assert.deepEqual(
    parseSearchLine('- GENSIGHT BIOLOGICS (SA) | SIREN 751164757 | en activité | NAF 72.19Z | 74 RUE DU FBG ST ANTOINE 75012 PARIS 12'),
    {
      name: 'GENSIGHT BIOLOGICS',
      siren: '751164757',
      summary: 'SA · en activité · NAF 72.19Z · 74 RUE DU FBG ST ANTOINE 75012 PARIS 12',
    },
  );
});
