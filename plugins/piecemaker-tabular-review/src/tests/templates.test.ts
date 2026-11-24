import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-modeles-')));
vi.stubEnv('HOME', home);
vi.stubEnv('USERPROFILE', home);

const { normalizeColumn, readTemplates, upsertTemplate } = await import('../server/templates.js');

describe('normalizeColumn', () => {
  const question = { name: 'Montant', prompt: 'Quel est le montant ?' };

  it('ignores the premise kind that older templates carried', () => {
    expect('premise' in normalizeColumn({ ...question, premise: 'single' } as never)).toBe(false);
  });
  it('aligne les anciens modèles de nature sur les familles livrées sans modifier les autres questions', () => {
    upsertTemplate({ id: 'inventaire-fictif', name: 'Inventaire fictif', columns: [{ name: 'Nature', prompt: 'Identifier le document.', format: 'tags', tags: ['Autre', 'Jugement'] }, { name: 'Importance', prompt: 'Importance ?', format: 'tags', tags: ['Haute', 'Basse'] }] });
    const current = readTemplates().find((entry) => entry.id === 'inventaire-fictif')!;
    expect(current.columns[0].tags).toEqual(['legal document', 'material entity', 'indéterminé']);
    expect(current.columns[0].tags).not.toContain('Autre');
    expect(current.columns[1]).toEqual({ name: 'Importance', prompt: 'Importance ?', format: 'tags', tags: ['Haute', 'Basse'] });
  });

});
