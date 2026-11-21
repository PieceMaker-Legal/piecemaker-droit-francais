import { isoDateOf, premiseId } from './bundle.js';
import { OKF_SCHEME, premiseEvidence } from './premises.js';

export function premiseDate(projectPath: string, title: string) {
  let evidence;
  try { evidence = premiseEvidence(projectPath, `${OKF_SCHEME}${premiseId(title)}`); } catch { return null; }
  if (!evidence) return null;
  const dated = evidence.pieces.flatMap((piece) => {
    const date = isoDateOf(piece.value);
    return date && piece.resource && piece.citation ? [{ date, piece: piece.resource, citation: piece.citation }] : [];
  });
  if (!dated.length) return null;
  const date = dated[0].date;
  return { date, intitule: evidence.title, preuve: dated.filter((entry) => entry.date === date).map(({ piece, citation }) => ({ piece, citation })) };
}
