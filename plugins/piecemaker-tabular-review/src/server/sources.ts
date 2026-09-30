import type { ResearchFilters, ResearchSource } from '../shared.js';
import type { Json, LegifranceApi } from './legifrance.js';
import type { Criterion, ParsedQuery } from './query.js';
import { localClauses, searchFields } from './query.js';

export type Filter = Json & { facette: string };

export type SourcePlan = {
  source: ResearchSource;
  fond: 'JURI' | 'CETAT';
  filters: Filter[];
  orWhenImplicit: boolean;
  linkBase: string;
};

export type Listed = {
  id: string;
  title: string;
  source: ResearchSource;
  position: number;
  sourceTotal: number;
  result: Json;
  origin: 'legifrance' | 'judilibre';
};

const PAGE_SIZE = 100;
const UPPER_DATE_LIMIT = '2998-12-31';
const JURI_LINK = 'https://www.legifrance.gouv.fr/juri/id/';
const CETAT_LINK = 'https://www.legifrance.gouv.fr/ceta/id/';

const TRANSVERSAL_FORMATIONS = ['ASSEMBLEE_PLENIERE', 'CHAMBRE_MIXTE', 'CHAMBRES_REUNIES', 'AVIS'];

const CASSATION_FORMATIONS: Record<string, string[]> = {
  CIVIL: ['CHAMBRE_CIVILE_1', 'CHAMBRE_CIVILE_2', 'CHAMBRE_CIVILE_3', 'CHAMBRE_CIVILE'],
  COMMERCIAL: ['CHAMBRE_COMMERCIALE'],
  PENAL: ['CHAMBRE_CRIMINELLE'],
  SOCIAL: ['CHAMBRE_SOCIALE'],
};

export const FIRST_DEGREE_FAMILIES: Record<string, string[]> = {
  TRIBUNAL_JUDICIAIRE: ['tribunal judiciaire'],
  TRIBUNAL_GRANDE_INSTANCE: ['tribunal de grande instance'],
  TRIBUNAL_INSTANCE: ['tribunal d\'instance'],
  TRIBUNAL_COMMERCE: ['tribunal de commerce'],
  CONSEIL_PRUDHOMMES: ['conseil de prud\'hommes', 'conseil des prud\'hommes'],
  TRIBUNAL_CORRECTIONNEL: ['tribunal correctionnel'],
  TRIBUNAL_SECURITE_SOCIALE: ['tribunal des affaires de securite sociale', 'trib. des affaires de securite sociale'],
  TRIBUNAL_BAUX_RURAUX: ['tribunal paritaire des baux ruraux'],
  JURIDICTION_PROXIMITE: ['juridiction de proximite', 'juge de proximite'],
  OUTRE_MER: ['tribunal de premiere instance', 'tribunal superieur d\'appel', 'chambre de l\'application des peines'],
  TRIBUNAL_CONFLITS: ['tribunal_conflit', 'tribunal des conflits'],
};

export function cassationFormations(matieres: string[]): string[] {
  const formations = [...new Set(matieres.flatMap((matiere) => CASSATION_FORMATIONS[matiere] ?? []))];
  return [...formations, ...TRANSVERSAL_FORMATIONS];
}

function dateFilter(filters: ResearchFilters): Filter[] {
  if (!filters.dateDebut && !filters.dateFin) return [];
  const dates: Record<string, string> = {};
  if (filters.dateDebut) dates.start = filters.dateDebut;
  if (filters.dateFin) dates.end = filters.dateFin >= '2999-01-01' ? UPPER_DATE_LIMIT : filters.dateFin;
  return [{ facette: 'DATE_DECISION', dates }];
}

function lebonFilter(value: ResearchFilters['publicationCaa']): Filter[] {
  return value === 'TOUS' ? [] : [{ facette: 'PUBLICATION_RECUEIL', valeurs: [value] }];
}

export function sourcePlan(source: ResearchSource, filters: ResearchFilters): SourcePlan {
  const dates = dateFilter(filters);
  switch (source) {
    case 'cassation':
      return {
        source,
        fond: 'JURI',
        orWhenImplicit: false,
        linkBase: JURI_LINK,
        filters: [
          { facette: 'JURIDICTION_JUDICIAIRE', valeurs: ['Cour de cassation'] },
          ...dates,
          { facette: 'CASSATION_FORMATION', valeurs: cassationFormations(filters.matieres) },
          ...(filters.publicationBulletin === 'TOUS' ? [] : [{ facette: 'CASSATION_TYPE_PUBLICATION_BULLETIN', valeurs: [filters.publicationBulletin === 'PUBLIE' ? 'T' : 'F'] }]),
        ],
      };
    case 'appel':
      return {
        source,
        fond: 'JURI',
        orWhenImplicit: false,
        linkBase: JURI_LINK,
        filters: [
          { facette: 'JURIDICTION_JUDICIAIRE', valeurs: ['Juridictions d\'appel'] },
          ...dates,
          ...(filters.sieges.length ? [{ facette: 'APPEL_SIEGE_APPEL', valeurs: filters.sieges }] : []),
        ],
      };
    case 'conseil_etat':
      return {
        source,
        fond: 'CETAT',
        orWhenImplicit: false,
        linkBase: CETAT_LINK,
        filters: [...dates, { facette: 'JURIDICTION_NATURE', valeurs: ['CONSEIL_ETAT'], multiValeurs: { CONSEIL_ETAT: [] } }, ...lebonFilter(filters.publicationConseilEtat)],
      };
    case 'caa':
      return {
        source,
        fond: 'CETAT',
        orWhenImplicit: false,
        linkBase: CETAT_LINK,
        filters: [...dates, ...lebonFilter(filters.publicationCaa), { facette: 'JURIDICTION_NATURE', valeurs: ['COURS_APPEL'], multiValeurs: { COURS_APPEL: filters.villesCaa } }],
      };
    case 'premiere_instance':
      return {
        source,
        fond: 'JURI',
        orWhenImplicit: true,
        linkBase: JURI_LINK,
        filters: [{ facette: 'JURIDICTION_JUDICIAIRE', valeurs: ['Juridictions du premier degré'] }, ...dates],
      };
  }
}

export function planClauses(plan: SourcePlan, parsed: ParsedQuery): Criterion[][] {
  return localClauses(parsed, plan.orWhenImplicit);
}

function searchBody(plan: SourcePlan, parsed: ParsedQuery, filters: Filter[], pageNumber: number, pageSize: number): Json {
  const { operateur, champs } = searchFields(parsed, plan.orWhenImplicit);
  return {
    fond: plan.fond,
    recherche: {
      pageNumber,
      pageSize,
      operateur,
      sort: 'PERTINENCE',
      secondSort: 'ID',
      typePagination: 'DEFAUT',
      fromAdvancedRecherche: false,
      champs,
      filtres: filters,
    },
  };
}

function withoutAccents(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function firstDegreeLabels(families: string[], facetValues: string[]): string[] {
  const prefixes = families.flatMap((family) => FIRST_DEGREE_FAMILIES[family] ?? []);
  return [...new Set(facetValues.filter((label) => prefixes.some((prefix) => withoutAccents(label).startsWith(prefix))))];
}

function facetValues(response: Json, name: string): string[] {
  const facets = Array.isArray(response.facets) ? response.facets as Json[] : [];
  const facet = facets.find((entry) => entry.facetElem === name || entry.field === name);
  return facet && facet.values && typeof facet.values === 'object' ? Object.keys(facet.values as Json) : [];
}

export async function resolvePlan(api: LegifranceApi, plan: SourcePlan, parsed: ParsedQuery, filters: ResearchFilters, signal: AbortSignal): Promise<{ plan: SourcePlan; total: number }> {
  if (plan.source === 'premiere_instance') {
    const probe = await api.search(searchBody(plan, parsed, plan.filters, 1, 1), signal);
    const labels = firstDegreeLabels(filters.typesPremiereInstance, facetValues(probe, 'PREMIER_DEGRE_TYPE_JURIDICTION'));
    if (!labels.length) return { plan, total: 0 };
    plan = { ...plan, filters: [...plan.filters, { facette: 'PREMIER_DEGRE_TYPE_JURIDICTION', valeurs: labels }] };
  }
  const response = await api.search(searchBody(plan, parsed, plan.filters, 1, 1), signal);
  const results = Array.isArray(response.results) ? response.results : [];
  const total = Number(response.totalResultNumber ?? Number.NaN);
  if (results.length && !(Number.isInteger(total) && total > 0)) throw new Error('L’API Légifrance n’a pas fourni de nombre de résultats fiable : recherche arrêtée.');
  return { plan, total: results.length ? total : 0 };
}

function identity(result: Json): { id: string; title: string } {
  const titles = Array.isArray(result.titles) ? result.titles as Json[] : [];
  const first = titles[0] ?? {};
  return { id: String(first.id ?? '').trim(), title: String(first.title ?? '').trim() || 'Sans titre' };
}

export async function listPlan(api: LegifranceApi, plan: SourcePlan, parsed: ParsedQuery, total: number, signal: AbortSignal, onPage: (count: number) => void): Promise<Listed[]> {
  const listed: Listed[] = [];
  for (let page = 1; listed.length < total; page += 1) {
    const response = await api.search(searchBody(plan, parsed, plan.filters, page, PAGE_SIZE), signal);
    const batch = Array.isArray(response.results) ? response.results as Json[] : [];
    for (const result of batch) {
      const { id, title } = identity(result);
      if (id) listed.push({ id, title, source: plan.source, position: listed.length, sourceTotal: total, result, origin: 'legifrance' });
    }
    onPage(batch.length);
    if (batch.length < PAGE_SIZE) break;
  }
  return listed;
}
