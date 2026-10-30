import type { Condition, Reasoning, Ref, Basis } from './format.js';
import type { ReasoningConnectors, SourceInfo } from './program.js';

type Reply = { reponse: 'validé' | 'non validé' | 'indéterminé'; score: number | null; explication: string };
type Request = Parameters<NonNullable<ReasoningConnectors['review']>>[0];

export function readCitationReplies(raw: unknown, expected: string[]) {
  const entries = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && 'verifications' in raw ? raw.verifications : null;
  if (!Array.isArray(entries)) throw new TypeError('Réponse du vérificateur illisible.');
  const replies = new Map<string, Reply>();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || !expected.includes(entry.emplacement) || replies.has(entry.emplacement) || !['validé', 'non validé', 'indéterminé'].includes(entry.reponse) || !Number.isInteger(entry.score) || entry.score < 1 || entry.score > 5 || typeof entry.explication !== 'string' || !entry.explication.trim()) throw new TypeError('Réponse du vérificateur invalide : réponse, score entier de 1 à 5 et explication obligatoires.');
    replies.set(entry.emplacement, { reponse: entry.reponse, score: entry.score, explication: entry.explication.trim() });
  }
  if (replies.size !== expected.length) throw new TypeError('Le vérificateur n’a pas répondu à toutes les affirmations.');
  return replies;
}

export async function verifyCitationLinks(input: {
  cwd: string;
  reasoning: Reasoning;
  contexte: unknown;
  connectors: ReasoningConnectors;
  lookup: (id: string) => Promise<SourceInfo | null | undefined>;
  corrections: Map<string, string>;
  online: boolean;
  readable: boolean;
}) {
  if (!input.connectors.review || !input.readable) return new Map<string, Reply>();
  const candidates: Request['affirmations'] = [];
  const add = (emplacement: string, type: Request['affirmations'][number]['type'], affirmation: string, proof: Ref[], sources: Basis[]) => {
    const citations = [...proof.map((ref) => ({ source: ref.piece, citation: ref.citation })), ...sources.map((basis) => ({ source: basis.source, citation: basis.citation }))].map((ref) => ({ ...ref, citation: input.corrections.get(ref.citation) ?? ref.citation }));
    if (citations.length) candidates.push({ emplacement, type, affirmation, citations });
  };
  const state = (condition: Condition): string => condition.l_une ? `l’une des conditions (${condition.l_une.map(state).join(' ; ')})` : `« ${condition.condition} » ${condition.attendu ? 'vrai' : 'faux'}${condition.mesure ? `, calcul : ${JSON.stringify(condition.mesure)}` : ''}`;
  const walk = (condition: Condition, at: string, parent: string, exception = false) => {
    add(at, 'règle', `Les citations fondent ${exception ? 'cette exception à' : 'cette condition requise pour'} « ${parent} » : ${state(condition)}.`, [], condition.selon);
    condition.l_une?.forEach((member, index) => walk(member, `${at}.l_une[${index}]`, parent, exception));
  };
  for (const [name, term] of input.reasoning.terms) {
    term.si.forEach((condition, index) => walk(condition, `${name}.si[${index}]`, name));
    term.sauf.forEach((condition, index) => walk(condition, `${name}.sauf[${index}]`, name, true));
    for (const side of ['true', 'false'] as const) term.fondements?.[side].forEach((foundation, index) => {
      const at = `${name}.${side}[${index}]`;
      add(at, 'fondement', `Les citations établissent « ${name} » ${side === 'true' ? 'vrai' : 'faux'}${foundation.si.length ? `, sous les conditions déclarées : ${foundation.si.map(state).join(' ; ')}` : ''}.`, foundation.preuve, foundation.selon);
      foundation.si.forEach((condition, other) => walk(condition, `${at}.si[${other}]`, `${name} ${side === 'true' ? 'vrai' : 'faux'}`));
    });
  }
  for (const [name, value] of input.reasoning.valeurs) if (value.valeur !== null) add(`valeurs.${name}`, 'valeur', `Les citations établissent « ${name} » = ${JSON.stringify(value.valeur)}.`, value.preuve, value.selon);
  const affirmations: Request['affirmations'] = [];
  const sources = new Map<string, string>();
  for (const candidate of candidates) {
    const found = await Promise.all(candidate.citations.map(async (ref) => ({ ref, info: await input.lookup(ref.source) })));
    if (found.some(({ ref, info }) => !info || !input.connectors.match(info.text, ref.citation))) continue;
    for (const { ref, info } of found) sources.set(ref.source, info!.text);
    affirmations.push(candidate);
  }
  if (!affirmations.length) return new Map<string, Reply>();
  const expected = affirmations.map((entry) => entry.emplacement);
  try {
    const raw = await input.connectors.review({ cwd: input.cwd, affirmations, sources: [...sources].map(([source, texte]) => ({ source, texte })), contexte: input.contexte, online: input.online });
    return readCitationReplies(raw, expected);
  } catch (error) {
    const explication = `Correspondance non vérifiée : ${error instanceof TypeError ? error.message : 'le vérificateur est indisponible ; relance la vérification.'}`;
    return new Map(expected.map((at) => [at, { reponse: 'indéterminé' as const, score: null, explication }]));
  }
}
