import { Schema } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';

import { citationRangeInDoc } from '@/piecemaker/citations/docxPassage';

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'text*' },
    text: {},
  },
});

function docWith(text: string) {
  return schema.node('doc', null, [schema.node('paragraph', null, [schema.text(text)])]);
}

describe('citationRangeInDoc', () => {
  it('localise l’extrait cité', () => {
    const doc = docWith('Bonjour, Gaston !');
    const range = citationRangeInDoc(doc, 'Gaston');
    expect(range).not.toBeNull();
    expect(doc.textBetween(range!.from, range!.to)).toBe('Gaston');
  });

  it('ignore un extrait absent', () => {
    expect(citationRangeInDoc(docWith('Bonjour, Gaston !'), 'introuvable')).toBeNull();
  });
});
