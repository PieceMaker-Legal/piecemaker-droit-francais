import type { ResearchSource } from '../shared.js';
import type { Json } from './legifrance.js';
import type { Listed } from './sources.js';

export type DecisionRecord = {
  id: string;
  title: string;
  source: ResearchSource;
  date: string;
  formation: string;
  publication: string;
  titrage: string;
  resume: string;
  text: string;
};

export type Importance = { tier: number; label: string };

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, '\'')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&amp;/gi, '&');
}

export function htmlToText(html: string): string {
  return decodeEntities(html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ''));
}

function clean(value: unknown): string {
  return typeof value === 'string' ? decodeEntities(value.replace(/<\/?mark>/gi, '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() : '';
}

function first(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value)) {
      const found = value.map(clean).find(Boolean);
      if (found) return found;
    } else if (clean(value)) {
      return clean(value);
    }
  }
  return '';
}

function unique(parts: string[]): string {
  return [...new Set(parts.filter(Boolean))].join('\n');
}

function sommaireParts(value: unknown, keys: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => (entry && typeof entry === 'object' ? keys.map((key) => clean((entry as Json)[key])) : [clean(entry)]));
}

function searchExtracts(result: Json, field: string): string[] {
  const sections = Array.isArray(result.sections) ? result.sections as Json[] : [];
  return sections.flatMap((section) => (Array.isArray(section.extracts) ? section.extracts as Json[] : []))
    .filter((extract) => extract.searchFieldName === field)
    .flatMap((extract) => (Array.isArray(extract.values) ? extract.values.map(clean) : []));
}

export function formatDate(value: unknown): string {
  if (typeof value === 'number') {
    if (!value || value >= 32472144000000) return '';
    return new Date(value).toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  if (/^\d{10,}$/.test(text)) return formatDate(Number(text));
  return text && Number(text.slice(0, 4)) < 2999 ? text.slice(0, 10) : '';
}

export function decisionRecord(listed: Listed, response: Json): DecisionRecord {
  const text = (response.text && typeof response.text === 'object' ? response.text : {}) as Json;
  const plain = typeof text.texte === 'string' && text.texte.trim() ? text.texte : typeof text.texteHtml === 'string' ? htmlToText(text.texteHtml) : '';
  const titrage = unique([
    ...sommaireParts(text.sommaire, ['abstrats']),
    ...(Array.isArray(text.titrages) ? text.titrages.map(clean) : []),
  ]) || unique(searchExtracts(listed.result, 'Abstrat'));
  const resume = unique(sommaireParts(text.sommaire, ['resumePrincipal', 'autreResume']))
    || clean(text.resume)
    || unique([...(Array.isArray(listed.result.resumePrincipal) ? listed.result.resumePrincipal.map(clean) : []), ...searchExtracts(listed.result, 'Résumé principal')]);
  return {
    id: listed.id,
    title: first(text.titre, text.titreLong, listed.title) || listed.id,
    source: listed.source,
    date: formatDate(text.dateTexte) || formatDate(listed.result.date),
    formation: first(text.formation),
    publication: first(text.publicationRecueil, text.typePublicationBulletin, text.numeroPublicationBulletin ? 'Publié au bulletin' : ''),
    titrage,
    resume,
    text: plain.trim(),
  };
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function lebonTier(publication: string, title: string): number {
  const value = fold(`${publication} ${title}`);
  if (/inedit|non publie/.test(value)) return 3;
  if (/table/.test(value) || /^b$/.test(fold(publication))) return 2;
  if (/publie|recueil lebon/.test(value) || /^a$/.test(fold(publication))) return 1;
  return 3;
}

export function importance(record: Pick<DecisionRecord, 'source' | 'formation' | 'publication' | 'title'>): Importance {
  const formation = fold(record.formation);
  const title = fold(record.title);
  switch (record.source) {
    case 'cassation': {
      if (/assemblee pleniere|chambre mixte|chambres reunies/.test(`${formation} ${title}`)) return { tier: 0, label: /mixte/.test(`${formation} ${title}`) ? 'Chambre mixte' : /reunies/.test(`${formation} ${title}`) ? 'Chambres réunies' : 'Assemblée plénière' };
      if (/\bavis\b/.test(formation) || /^avis\b|, avis\b/.test(title)) return { tier: 1, label: 'Avis de la Cour de cassation' };
      const publication = fold(record.publication);
      const published = /^t$|^oui$|^true$/.test(publication) || (/publie/.test(publication) && !/non publie|inedit/.test(publication)) || (/publie au bulletin/.test(title) && !/inedit/.test(title));
      return published ? { tier: 1, label: 'Publié au Bulletin' } : { tier: 3, label: 'Inédit' };
    }
    case 'conseil_etat': {
      if (/^(assemblee|section)\b/.test(formation)) return { tier: 0, label: /^assemblee/.test(formation) ? 'Assemblée du contentieux' : 'Section du contentieux' };
      const tier = lebonTier(record.publication, record.title);
      return { tier, label: tier === 1 ? 'Recueil Lebon' : tier === 2 ? 'Tables du recueil Lebon' : 'Inédit au recueil Lebon' };
    }
    case 'caa': {
      const tier = lebonTier(record.publication, record.title);
      return { tier: 10 + tier, label: tier === 1 ? 'CAA — recueil Lebon' : tier === 2 ? 'CAA — tables du Lebon' : 'Cour administrative d’appel' };
    }
    case 'appel':
      return { tier: 12, label: 'Cour d’appel' };
    case 'premiere_instance':
      return { tier: 20, label: 'Première instance' };
  }
}
