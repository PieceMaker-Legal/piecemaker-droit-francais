import { describe, expect, it } from 'vitest';

import { chronologyView, generalView, mappingView, shell } from '../views.js';
import type { KnowledgeSnapshot } from '../types.js';

const snapshot: KnowledgeSnapshot = {
  projectId: 'project-1',
  nodes: [
    { id: 'doc', projectId: 'project-1', kind: 'document', label: 'Contrat', aliases: [], data: {}, createdAt: '', updatedAt: '' },
    { id: 'client', projectId: 'project-1', kind: 'company', label: 'Société cliente', aliases: [], data: { partySide: 'client' }, createdAt: '', updatedAt: '' },
    { id: 'company-with-siren', projectId: 'project-1', kind: 'company', label: 'Société BODACC', aliases: [], data: {}, createdAt: '', updatedAt: '' },
    { id: 'adverse', projectId: 'project-1', kind: 'person', label: 'Mme Adverse', aliases: [], data: { partySide: 'adversaire' }, createdAt: '', updatedAt: '' },
    { id: 'iban', projectId: 'project-1', kind: 'iban', label: 'IBAN 1', aliases: [], data: {}, createdAt: '', updatedAt: '' },
  ],
  links: [
    { projectId: 'project-1', fromNodeId: 'doc', toNodeId: 'client', relation: 'mentions', data: {} },
    { projectId: 'project-1', fromNodeId: 'client', toNodeId: 'iban', relation: 'iban', data: {} },
    { projectId: 'project-1', fromNodeId: 'company-with-siren', toNodeId: 'siren', relation: 'SIREN', data: {} },
    { projectId: 'project-1', fromNodeId: 'company-with-siren', toNodeId: 'siret', relation: 'SIRET', data: {} },
  ],
  mappings: [],
};

describe('chronology document cards', () => {
  it('marks the whole document event as an editor trigger', () => {
    const html = chronologyView({
      graph: snapshot,
    });

    expect(html).toContain('data-open-document="doc"');
    expect(html).toContain('aria-label="Modifier Contrat"');
  });
});

describe('BODACC on designated parties', () => {
  it('offers identity and BODACC actions only on designated company parties', () => {
    const html = generalView({
      graph: {
        ...snapshot,
        nodes: [
          ...snapshot.nodes,
          { id: 'siren', projectId: 'project-1', kind: 'siren', label: '123456789', aliases: [], data: {}, createdAt: '', updatedAt: '' },
          { id: 'siret', projectId: 'project-1', kind: 'other', label: '12345678900010', aliases: [], data: {}, createdAt: '', updatedAt: '' },
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
          { id: 'person-1', projectId: 'project-1', kind: 'person', label: 'Madame Claire Reynaud', aliases: ['Claire Reynaud'], data: { code: 'PERSONNE_PHYSIQUE_02' }, createdAt: '', updatedAt: '' },
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
