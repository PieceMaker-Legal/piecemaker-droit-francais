const PARAGRAPH_START = /(?<=^|\s)(?=(?:AU NOM DU PEUPLE FRAN[CÇ]AIS|LA COUR DE\b|LE CONSEIL\b|Sur (?:le |la |les |l['’])|Mais attendu\b|Et attendu\b|Attendu\b|Il est fait grief\b|Aux motifs que\b|PAR CES MOTIFS\b|Considérant\b|Vu (?:la |le |les )|\d+\s*°\s*(?:\/|Alors\b)))/g;

export type DecisionParagraph = {
  start: number;
  end: number;
  kind: 'heading' | 'motifs' | 'branch' | 'body';
};

function paragraphKind(text: string): DecisionParagraph['kind'] {
  const trimmed = text.trim();
  if (/^(?:AU NOM DU PEUPLE|LA COUR DE|LE CONSEIL\b)/.test(trimmed)) return 'heading';
  if (/^PAR CES MOTIFS\b/.test(trimmed)) return 'motifs';
  if (/^\d+\s*°/.test(trimmed)) return 'branch';
  return 'body';
}

function splitsAttendu(source: string, index: number) {
  return source.startsWith('Attendu', index)
    && (source.startsWith('Mais ', index - 5) || source.startsWith('Et ', index - 3));
}

export function decisionParagraphs(source: string): DecisionParagraph[] | null {
  if (!source || source.includes('\n')) return null;
  const starts = [0];
  for (const match of source.matchAll(new RegExp(PARAGRAPH_START.source, 'g'))) {
    if (match.index > 0 && !splitsAttendu(source, match.index)) starts.push(match.index);
  }
  if (starts.length === 1) return null;
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? source.length;
    return { start, end, kind: paragraphKind(source.slice(start, end)) };
  });
}
