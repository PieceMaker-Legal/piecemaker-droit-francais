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

  it('keeps the fact kind of a question', () => {
    expect(normalizeColumn({ ...question, fact: 'single' }).fact).toBe('single');
    expect(normalizeColumn({ ...question, fact: 'checkpoint' }).fact).toBe('checkpoint');
  });

  it('drops an unknown fact kind', () => {
    expect(normalizeColumn({ ...question, fact: 'autre' })).not.toHaveProperty('fact');
  });

  it('omits the fact key without a fact kind', () => {
    expect('fact' in normalizeColumn(question)).toBe(false);
  });
});
