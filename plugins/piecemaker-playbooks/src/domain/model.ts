import { randomUUID } from 'node:crypto';
import type { Finding, FindingStatus, Rule, Source } from '../shared.js';

export class PlaybookError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlaybookError('Objet JSON invalide.');
  return value as Record<string, unknown>;
}

export function text(value: unknown, max = 20000): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.length > max) throw new PlaybookError('Champ texte invalide ou trop long.');
  return value.trim();
}

function strings(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 50) throw new PlaybookError('Liste invalide.');
  return value.map((item) => text(item)).filter(Boolean);
}

export function rulesFrom(value: unknown, sources?: Source[]): Rule[] {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw new PlaybookError('Un playbook contient entre 1 et 200 règles.');
  const ids = new Set<string>();
  return value.map((raw) => {
    const row = record(raw);
    const id = text(row.id, 100) || randomUUID();
    const name = text(row.name, 300);
    const concept = text(row.concept);
    if (row.required !== undefined && typeof row.required !== 'boolean') throw new PlaybookError('Le caractère obligatoire d’une règle doit être vrai ou faux.');
    if (!name || !concept || ids.has(id)) throw new PlaybookError('Chaque règle nécessite un nom, un concept et un identifiant unique.');
    ids.add(id);
    const sourceRefs = strings(row.sourceRefs);
    if (sources && (!sourceRefs.length || sourceRefs.some((ref) => !sources.some((source) => source.id === ref)))) {
      throw new PlaybookError(`La règle « ${name} » ne possède pas de référence valide au guide.`);
    }
    return {
      id, name, concept, required: row.required === true, standard: text(row.standard),
      fallbacks: strings(row.fallbacks), unacceptable: strings(row.unacceptable), conditions: strings(row.conditions),
      guidance: text(row.guidance), suggestedClause: text(row.suggestedClause), sourceRefs,
    };
  });
}

export function parseModelJson(raw: string): Record<string, unknown> {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return record(JSON.parse(cleaned)); }
  catch { throw new PlaybookError('La réponse IA ne contient pas un objet JSON valide.'); }
}

export function locatedQuote(source: string, value: unknown): string {
  const quote = text(value, 30000);
  if (!quote) return '';
  const pattern = quote.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return source.match(new RegExp(pattern, 'i'))?.[0] ?? '';
}

const STATUSES = new Set<FindingStatus>(['acceptable', 'needs_review', 'unacceptable', 'missing_required', 'not_applicable']);

export function findingsFrom(value: unknown, rules: Rule[], source: string): Finding[] {
  if (!Array.isArray(value) || value.length > 1000) throw new PlaybookError('Résultats de revue invalides.');
  const found = new Map<string, Finding>();
  for (const raw of value) {
    const row = record(raw);
    const rule = rules.find((entry) => entry.id === row.ruleId);
    if (!rule || found.has(rule.id)) continue;
    let status = text(row.status) as FindingStatus;
    if (!STATUSES.has(status)) status = 'needs_review';
    const quote = locatedQuote(source, row.quote);
    const insertAfter = locatedQuote(source, row.insertAfter);
    const verified = Boolean(quote || (status === 'missing_required' && insertAfter));
    let analysis = text(row.analysis);
    if (!analysis) { analysis = 'Le modèle n’a pas expliqué son verdict.'; status = 'needs_review'; }
    if (status !== 'missing_required' && status !== 'not_applicable' && !quote) {
      status = 'needs_review';
      analysis += '\nExtrait absent ou non retrouvé : vérification manuelle nécessaire.';
    }
    found.set(rule.id, { id: randomUUID(), ruleId: rule.id, ruleName: rule.name, status, quote, insertAfter,
      location: text(row.location, 1000), analysis, verified,
      suggestedText: status === 'acceptable' || status === 'not_applicable' ? '' : text(row.suggestedText, 30000), applied: false });
  }
  return rules.map((rule) => found.get(rule.id) ?? {
    id: randomUUID(), ruleId: rule.id, ruleName: rule.name, status: 'needs_review', quote: '', location: '',
    analysis: 'Cette règle n’a pas été traitée par le modèle.', suggestedText: '', insertAfter: '', verified: false, applied: false,
  });
}
