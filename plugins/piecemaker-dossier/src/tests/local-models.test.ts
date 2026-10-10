import { describe, expect, it } from 'vitest';

import { missingLocalModels } from '../local-models.js';

describe('missingLocalModels', () => {
  it('liste les modèles absents dans l’ordre GLiNER puis MinerU', () => {
    expect(missingLocalModels({
      mineru: { name: 'MinerU', installed: false },
      gliner: { name: 'GLiNER2-PII', installed: false },
    })).toEqual(['gliner', 'mineru']);
  });

  it('ne propose rien quand les deux modèles sont installés', () => {
    expect(missingLocalModels({
      gliner: { name: 'GLiNER2-PII', installed: true },
      mineru: { name: 'MinerU', installed: true },
    })).toEqual([]);
  });

  it('considère un modèle non décrit comme absent', () => {
    expect(missingLocalModels({ gliner: { name: 'GLiNER2-PII', installed: true } })).toEqual(['mineru']);
  });
});
