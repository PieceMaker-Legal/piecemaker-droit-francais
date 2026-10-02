import { describe, expect, it } from 'vitest';

import { judgeZone, withoutAnnexes } from '../server/dispositif.js';
import { judilibrePlan, judilibreQueries, matchesHit, officialZone, sameNumber, siegeLocation } from '../server/judilibre.js';
import { localClauses, parseQuery } from '../server/query.js';
import { validateFilters } from '../server/research.js';

const clauses = (query: string) => localClauses(parseQuery(query), false);

describe('traduction des requêtes vers Judilibre', () => {
  it('rend chaque mot obligatoire, y compris dans les expressions, sans élision', () => {
    expect(judilibreQueries(clauses('"vice caché" mérule'))).toEqual(['+vice +caché +mérule']);
    expect(judilibreQueries(clauses('"trouble à l’ordre public"'))).toEqual(['+trouble +à +ordre +public']);
  });
  it('éclate les OU en recherches distinctes', () => {
    expect(judilibreQueries(clauses('("faute grave" OU "faute lourde") ET licenciement'))).toEqual(['+faute +grave +licenciement', '+faute +lourde +licenciement']);
  });
  it('cherche les articles sous leurs deux écritures', () => {
    expect(judilibreQueries(clauses('L. 1235-3 ET indemnité'))).toEqual(['+"L. 1235-3" +indemnité', '+L1235-3 +indemnité']);
    expect(judilibreQueries(clauses('"article L1235-3 du code du travail"'))).toEqual(['+article +"L. 1235-3" +du +code +du +travail', '+article +L1235-3 +du +code +du +travail']);
  });
  it('met entre guillemets les mots composés', () => {
    expect(judilibreQueries(clauses('clause non-concurrence'))).toEqual(['+clause +"non-concurrence"']);
  });
});

describe('filtres Judilibre', () => {
  const { filters } = validateFilters({ query: 'bail', sources: ['cassation', 'appel', 'premiere_instance'], matieres: ['CIVIL'], sieges: ['AIX-PROVENCE', 'ST-DENIS-REUNION'], typesPremiereInstance: ['TRIBUNAL_JUDICIAIRE', 'CONSEIL_PRUDHOMMES'], dateDebut: '2023-01-01', dateFin: '2999-12-31' });
  it('traduit les sièges d’appel en codes Judilibre', () => {
    expect(siegeLocation('AIX-PROVENCE')).toBe('ca_aix_provence');
    expect(judilibrePlan('appel', filters, clauses('bail'))!.filters).toEqual([['jurisdiction', 'ca'], ['location', 'ca_aix_provence'], ['location', 'ca_st_denis_reunion'], ['date_start', '2023-01-01'], ['date_end', '2998-12-31']]);
  });
  it('ne garde que les tribunaux couverts par Judilibre', () => {
    expect(judilibrePlan('premiere_instance', filters, clauses('bail'))!.filters.filter(([key]) => key === 'jurisdiction')).toEqual([['jurisdiction', 'tj']]);
    expect(judilibrePlan('premiere_instance', { ...filters, typesPremiereInstance: ['CONSEIL_PRUDHOMMES'] }, clauses('bail'))).toBeNull();
  });
  it('laisse la Cour de cassation à Légifrance', () => {
    expect(judilibrePlan('cassation', filters, clauses('bail'))).toBeNull();
  });
});

describe('correspondance Légifrance ↔ Judilibre', () => {
  it('rapproche les numéros de RG malgré le chiffre final de Légifrance', () => {
    expect(sameNumber('22/005011', '22/00501')).toBe(true);
    expect(sameNumber('23-20.562', '23-20.562')).toBe(true);
    expect(sameNumber('22/005011', '21/00501')).toBe(false);
    expect(sameNumber('22/005011', '22/00502')).toBe(false);
  });
  it('exige même juridiction, même date, même siège', () => {
    const record = { source: 'appel' as const, court: 'Cour d’appel d’Orléans', date: '2022-12-15', numbers: ['22/005011'], siege: 'ORLEANS' };
    const hit = { id: 'x', jurisdiction: 'ca', location: 'ca_orleans', date: '2022-12-15', numbers: ['22/00501'] };
    expect(matchesHit(record, hit)).toBe(true);
    expect(matchesHit(record, { ...hit, location: 'ca_paris' })).toBe(false);
    expect(matchesHit(record, { ...hit, date: '2022-12-16' })).toBe(false);
  });
});

describe('zones officielles', () => {
  const text = 'EN-TÊTE\nFaits et procédure\n1. Selon l’arrêt attaqué.\nEnoncé du moyen\n2. Le salarié fait grief.\nRéponse de la Cour\n3. Mais attendu que le moyen manque en fait.\nPAR CES MOTIFS, la Cour :\nREJETTE le pourvoi ; MOYENS ANNEXES au présent arrêt\nMoyen produit au pourvoi principal par la SCP X\nIl est reproché à l’arrêt.';
  const at = (needle: string) => text.indexOf(needle);
  it('assemble motivations et dispositif, sans les moyens intercalés ni les annexes', () => {
    const zone = officialZone({ text, zones: { motivations: [{ start: at('Réponse'), end: at('PAR CES') }], dispositif: [{ start: at('PAR CES'), end: text.length }] } });
    expect(zone!.zone).toBe('motifs');
    expect(zone!.text).toContain('Mais attendu que');
    expect(zone!.text).toContain('REJETTE le pourvoi ;');
    expect(zone!.text).not.toContain('grief');
    expect(zone!.text).not.toContain('reproché');
  });
  it('marque les coupures entre zones non contiguës', () => {
    const zone = officialZone({ text, zones: { motivations: [{ start: at('Réponse'), end: at('Enoncé') + 5 }, { start: at('Réponse'), end: at('PAR CES') }] } });
    expect(zone!.text).toContain('Réponse de la Cour');
  });
  it('rend null sans zones', () => {
    expect(officialZone({ text, zones: {} })).toBeNull();
  });
});

describe('formules : annexes collées', () => {
  const decision = 'Réponse de la Cour\n\n5. Mais attendu que la cour d’appel a exactement retenu.\n\nPAR CES MOTIFS, la Cour :\n\nREJETTE le pourvoi ;\n\nAinsi fait et jugé. MOYENS ANNEXES au présent arrêt\n\nMoyen produit au pourvoi principal par la SCP X, pour Mme T...\n\nIl est fait grief à l’arrêt attaqué de retenir la faute.';
  it('coupe les moyens annexés même collés à la dernière ligne', () => {
    const zone = judgeZone(decision, true);
    expect(zone.text).toContain('REJETTE le pourvoi');
    expect(zone.text).not.toContain('fait grief');
  });
  it('withoutAnnexes retire les annexes d’un dispositif', () => {
    expect(withoutAnnexes('PAR CES MOTIFS\nREJETTE\nMoyens produits, au pourvoi n° Z 19-11.529, par la SARL Cabinet X\nPREMIER MOYEN')).toBe('PAR CES MOTIFS\n\nREJETTE');
  });
});

describe('sans abonnement Judilibre', () => {
  it('continue sur Légifrance seul avec un avertissement', async () => {
    const { AccessDenied } = await import('../server/legifrance.js');
    const { startResearch, waitForResearch, researchState } = await import('../server/research.js');
    const api = {
      search: async () => ({ results: [], totalResultNumber: 0 }),
      consult: async () => ({}),
      judilibre: async () => {
        throw new AccessDenied('Accès refusé par PISTE : l’application doit être abonnée à l’API Judilibre.');
      },
    };
    const state = startResearch({ query: 'bail', sources: ['appel'] }, api);
    await waitForResearch(state.id);
    const final = researchState(state.id);
    expect(final.phase).toBe('done');
    expect(final.warnings?.[0]).toMatch(/Judilibre indisponible/);
    expect(final.counts[0]).toEqual({ source: 'appel', total: 0, legifrance: 0 });
  });
});
