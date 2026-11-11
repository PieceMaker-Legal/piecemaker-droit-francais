import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ptr-modeles-')));
vi.stubEnv('HOME', home);
vi.stubEnv('USERPROFILE', home);

const { normalizeColumn } = await import('../server/templates.js');

describe('normalizeColumn', () => {
  const question = { name: 'Montant', prompt: 'Quel est le montant ?' };

  it('keeps the premise kind of a question', () => {
    expect(normalizeColumn({ ...question, premise: 'single' }).premise).toBe('single');
    expect(normalizeColumn({ ...question, premise: 'checkpoint' }).premise).toBe('checkpoint');
  });

  it('drops an unknown premise kind', () => {
    expect(normalizeColumn({ ...question, premise: 'autre' })).not.toHaveProperty('premise');
  });

  it('omits the premise key without a premise kind', () => {
    expect('premise' in normalizeColumn(question)).toBe(false);
  });
});
