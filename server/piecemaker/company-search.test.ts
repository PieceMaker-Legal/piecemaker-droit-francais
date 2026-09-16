import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSearchLine } from './company-search.js';

test('company search accepts registry results without a legal form', () => {
  assert.deepEqual(
    parseSearchLine('- EXEMPLE BIOLOGICS | SIREN 000000000 | en activité | NAF 72.19Z | 1 RUE EXEMPLE 75012 PARIS 12'),
    {
      name: 'EXEMPLE BIOLOGICS',
      siren: '000000000',
      summary: 'en activité · NAF 72.19Z · 1 RUE EXEMPLE 75012 PARIS 12',
    },
  );
});

test('company search preserves a legal form in registry results', () => {
  assert.deepEqual(
    parseSearchLine('- EXEMPLE BIOLOGICS (SA) | SIREN 000000000 | en activité | NAF 72.19Z | 1 RUE EXEMPLE 75012 PARIS 12'),
    {
      name: 'EXEMPLE BIOLOGICS',
      siren: '000000000',
      summary: 'SA · en activité · NAF 72.19Z · 1 RUE EXEMPLE 75012 PARIS 12',
    },
  );
});
