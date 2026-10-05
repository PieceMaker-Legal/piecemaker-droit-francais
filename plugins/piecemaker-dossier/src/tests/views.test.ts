import { describe, expect, it } from 'vitest';

import { chronologyView, citationListMarkup, generalView, isConformingPieceName, mappingView, proposedPieceName, shell } from '../views.js';
import type { KnowledgeSnapshot } from '../types.js';

const snapshot: KnowledgeSnapshot = {
  projectId: 'project-1',
  nodes: [
    { id: 'doc', projectId: 'project-1', kind: 'document', label: 'Contrat', aliases: [], data: {}, date: null, createdAt: '', updatedAt: '' },
    { id: 'client', projectId: 'project-1', kind: 'company', label: 'Société cliente', aliases: [], data: { partySide: 'client' }, date: null, createdAt: '', updatedAt: '' },
    { id: 'company-with-siren', projectId: 'project-1', kind: 'company', label: 'Société BODACC', aliases: [], data: {}, date: null, createdAt: '', updatedAt: '' },
    { id: 'adverse', projectId: 'project-1', kind: 'person', label: 'Mme Adverse', aliases: [], data: { partySide: 'adversaire' }, date: null, createdAt: '', updatedAt: '' },
    { id: 'iban', projectId: 'project-1', kind: 'iban', label: 'IBAN 1', aliases: [], data: {}, date: null, createdAt: '', updatedAt: '' },
  ],
  links: [
    { projectId: 'project-1', fromNodeId: 'doc', toNodeId: 'client', relation: 'mentions', data: {} },
    { projectId: 'project-1', fromNodeId: 'client', toNodeId: 'iban', relation: 'iban', data: {} },
    { projectId: 'project-1', fromNodeId: 'company-with-siren', toNodeId: 'siren', relation: 'SIREN', data: {} },
    { projectId: 'project-1', fromNodeId: 'company-with-siren', toNodeId: 'siret', relation: 'SIRET', data: {} },
  ],
  mappings: [],
  citations: [],
};

describe('chronology document cards', () => {
  it('marks the whole document event as an editor trigger', () => {
    const html = chronologyView({
      graph: snapshot,
    });

    expect(html).toContain('data-open-document="doc"');
    expect(html).toContain('aria-label="Modifier Contrat"');
  });

  it('reads the date of a document from its doc_date column', () => {
    const html = chronologyView({ graph: { ...snapshot, nodes: [
      { id: 'dated', projectId: 'project-1', kind: 'document', label: 'Contrat.pdf', aliases: [], data: {}, date: '2024-03-05', createdAt: '', updatedAt: '' },
      { id: 'undated', projectId: 'project-1', kind: 'document', label: 'Facture.pdf', aliases: [], data: { date_non_reconnue: '5 mars 2024' }, date: null, createdAt: '', updatedAt: '' },
    ], links: [] } } as never);
    expect(html).toContain('data-dated="true"');
    expect(html).toContain('Date non renseignée');
    expect(html.match(/data-dated="true"/g)).toHaveLength(1);
  });
});

describe('BODACC on designated parties', () => {
  it('offers identity and BODACC actions only on designated company parties', () => {
    const html = generalView({
      graph: {
        ...snapshot,
        nodes: [
          ...snapshot.nodes,
          { id: 'siren', projectId: 'project-1', kind: 'siren', label: '123456789', aliases: [], data: {}, date: null, createdAt: '', updatedAt: '' },
          { id: 'siret', projectId: 'project-1', kind: 'other', label: '12345678900010', aliases: [], data: {}, date: null, createdAt: '', updatedAt: '' },
        ],
        links: [
          ...snapshot.links,
          { projectId: 'project-1', fromNodeId: 'client', toNodeId: 'siren', relation: 'SIREN', data: {} },
          { projectId: 'project-1', fromNodeId: 'client', toNodeId: 'siret', relation: 'SIRET', data: {} },
        ],
      },
    });

    expect(html).toContain('data-action="bodacc-search"');
    expect(html).toContain('data-action="company-search"');
    expect(html).toContain('data-siren="123456789"');
    expect(html).toContain('data-siret="12345678900010"');
    expect(html).not.toContain('data-scan-company="company-with-siren"');
    expect(html).not.toContain('data-action="scan-all-companies"');
    expect(html).not.toContain('Scan Bodacc');
    expect(html).not.toContain('data-bodacc-family=');
  });

  const clientWithSiren = {
    ...snapshot,
    nodes: [...snapshot.nodes, { id: 'siren', projectId: 'project-1', kind: 'siren' as const, label: '123456789', aliases: [], data: {}, date: null, createdAt: '', updatedAt: '' }],
    links: [...snapshot.links, { projectId: 'project-1', fromNodeId: 'client', toNodeId: 'siren', relation: 'SIREN', data: {} }],
  };

  it('disables the BODACC button while the report is being generated', () => {
    const html = generalView({ graph: clientWithSiren }, false, null, new Map([['client', { status: 'loading' as const }]]));

    expect(html).toMatch(/data-action="bodacc-search"[^>]*disabled/);
    expect(html).toContain('Recherche…');
    expect(html).not.toContain('pmd-bodacc-accordion');
  });

  it('shows a BODACC error on one line without an accordion', () => {
    const html = generalView({ graph: clientWithSiren }, false, null, new Map([['client', { status: 'error' as const, error: 'x' }]]));

    expect(html).toContain('<p class="pmd-bodacc-status pmd-bodacc-error">x</p>');
    expect(html).not.toContain('pmd-bodacc-accordion');
  });

  it('hides the BODACC action until a SIREN or SIRET is known', () => {
    const html = generalView({ graph: snapshot });

    expect(html).toContain('data-action="company-search"');
    expect(html).toContain('data-scan-company="client"');
    expect(html).not.toContain('data-action="bodacc-search"');
    expect(html).not.toContain('Annonces BODACC');
  });
});

describe('party badges', () => {
  it('renders a removal button on designated parties', () => {
    const html = generalView({
      graph: snapshot,
    });

    expect(html).toContain('class="pmd-party-badge"');
    expect(html).toContain('data-remove-party="client"');
    expect(html).toContain('Retirer la désignation de partie');
    expect(html).not.toContain('Enregistrer les profils');
  });
});

describe('mapping dialog header', () => {
  it('offers the institutional terms settings next to the close button', () => {
    const html = mappingView({
      graph: snapshot,
    });

    expect(html).toContain('data-action="institutional-terms"');
    expect(html.indexOf('data-action="institutional-terms"')).toBeLessThan(html.indexOf('data-close'));
    expect(html).toContain('data-save-mapping');
  });

  it('lists every GLiNER writing, not only node.aliases', () => {
    const html = mappingView({
      graph: {
        ...snapshot,
        nodes: [
          { id: 'person-1', projectId: 'project-1', kind: 'person', label: 'Madame Claire Reynaud', aliases: ['Claire Reynaud'], data: { code: 'PERSONNE_PHYSIQUE_02' }, date: null, createdAt: '', updatedAt: '' },
        ],
        mappings: [
          { projectId: 'project-1', nodeId: 'person-1', real: 'Madame Claire Reynaud', masked: 'PERSONNE_PHYSIQUE_02', data: {} },
          { projectId: 'project-1', nodeId: 'person-1', real: 'Claire Reynaud', masked: 'PERSONNE_PHYSIQUE_02', data: {} },
          { projectId: 'project-1', nodeId: 'person-1', real: 'Mme C. Reynaud', masked: 'PERSONNE_PHYSIQUE_02', data: {} },
        ],
      },
    });

    expect(html).toContain('Madame Claire Reynaud');
    expect(html).toContain('Claire Reynaud');
    expect(html).toContain('Mme C. Reynaud');
    expect(html).toContain('Autres écritures');
  });
});

describe('empty parties state', () => {
  const emptyGraph: KnowledgeSnapshot = {
    projectId: 'project-1',
    nodes: snapshot.nodes.filter((node) => node.kind === 'document'),
    links: [],
    mappings: [],
    citations: [],
  };

  it('prompts to scan when the case has not been analyzed', () => {
    const html = generalView({ graph: { ...emptyGraph, anonymizationComplete: false } });

    expect(html).toContain('class="pmd-no-parties"');
    expect(html).toContain('Dossier non analysé');
    expect(html).toContain('data-action="scan"');
    expect(html).not.toContain('data-action="mapping">◇ Ouvrir le mapping');
  });

  it('prompts to open mapping once GLiNER has run and no party is designated', () => {
    const html = generalView({ graph: { ...emptyGraph, anonymizationComplete: true } });

    expect(html).toContain('class="pmd-no-parties"');
    expect(html).toContain('Aucune partie désignée');
    expect(html).toContain('data-action="mapping"');
    expect(html).not.toContain('data-action="scan"');
  });
});

describe('scan status badge', () => {
  const runningJob = (percent: number) => ({
    id: 'job-1',
    projectId: 'project-1',
    state: 'running' as const,
    percent,
    error: null,
  });

  it('shows the mapping count when no scan is running', () => {
    const html = shell('general', 12);

    expect(html).toContain('12 anonymisé(s)');
    expect(html).not.toContain('role="progressbar"');
    expect(html).toContain('data-tab="general"');
    expect(html).toContain('data-tab="chronology"');
    expect(html).not.toContain('data-tab="scan"');
  });

  it('replaces the count by a progress bar showing only the percentage', () => {
    const html = shell('general', 12, runningJob(42.4));

    expect(html).toContain('>42 %<');
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('width:42.4%');
    expect(html).toContain('data-action="scan" disabled');
  });

  it('keeps a single percentage for markitdown and gliner', () => {
    const html = shell('general', 0, runningJob(10));

    expect(html).toContain('>10 %<');
    expect(html).not.toContain('Conversion');
  });
});

describe('piece names', () => {
  it('recognises the AAAA-MM-JJ_titre naming rule', () => {
    expect(isConformingPieceName('2024-01-09_Jugement du Tribunal judiciaire de Paris.pdf')).toBe(true);
    expect(isConformingPieceName('Contrat.pdf')).toBe(false);
    expect(isConformingPieceName('2024-01-09_.pdf')).toBe(false);
  });

  it('proposes a name from the date, the type and the place', () => {
    expect(proposedPieceName('2024-01-09', 'jugement', 'Tribunal judiciaire de Paris')).toBe('2024-01-09_Jugement - Tribunal judiciaire de Paris');
    expect(proposedPieceName('2023-05-12', 'contrat', '')).toBe('2023-05-12_Contrat');
  });

  it('leaves out a place that still holds a pseudonym code and forbidden characters', () => {
    expect(proposedPieceName('2024-01-09', 'jugement', 'TJ de ADRESSE_02')).toBe('2024-01-09_Jugement');
    expect(proposedPieceName('2024-01-09', 'contrat', 'Société A c/ Société B')).toBe('2024-01-09_Contrat - Société A c- Société B');
  });

  it('proposes nothing without a date or a type', () => {
    expect(proposedPieceName('', 'jugement', '')).toBe('');
    expect(proposedPieceName('2024-01-09', ' ', '')).toBe('');
  });

  it('flags a non-conforming piece in the chronology', () => {
    const html = chronologyView({ graph: { ...snapshot, nodes: [
      { id: 'a', projectId: 'project-1', kind: 'document', label: 'Contrat.pdf', aliases: [], data: {}, date: null, createdAt: '', updatedAt: '' },
      { id: 'b', projectId: 'project-1', kind: 'document', label: '2024-01-09_Jugement.pdf', aliases: [], data: {}, date: null, createdAt: '', updatedAt: '' },
    ], links: [] } } as never);
    expect(html.match(/Nom non conforme/g)).toHaveLength(1);
  });
});

describe('citationListMarkup', () => {
  it('renders nothing without citations', () => {
    expect(citationListMarkup([])).toBe('');
  });

  it('shows the text with its full value on hover, the source and a removal button', () => {
    const html = citationListMarkup([
      { texte: 'Jean Dupont signe <le> contrat.', source: 'Contrat.pdf', remove: { attribute: 'data-remove-citation', value: '12' } },
      { texte: 'Société Exemple SAS', source: 'Registre national des entreprises' },
    ]);
    expect(html).toContain('title="Jean Dupont signe &lt;le&gt; contrat."');
    expect(html).toContain('<small class="pmd-citation-source">Contrat.pdf</small>');
    expect(html).toContain('data-remove-citation="12"');
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html.match(/<li /g)).toHaveLength(2);
  });
});
