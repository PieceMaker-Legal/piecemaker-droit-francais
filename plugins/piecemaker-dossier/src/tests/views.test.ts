import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

import { chronologyView, citationListMarkup, generalView, graphView, mappingView, proposedPieceName } from '../views.js';
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

describe('Case index', () => {
  it('est une seule vue : la revue de l’Index montée dans l’onglet, sans tableau à part ni fenêtre d’analyse', () => {
    const html = chronologyView();
    expect(html.match(/data-index-analysis/g)).toHaveLength(1);
    expect(html).not.toContain('pmd-chronology-table');
    expect(html).not.toContain('data-action="index-analysis"');
    expect(JSDOM.fragment(html).querySelectorAll('[data-okf-reports], [data-okf-report], [data-okf-graph]')).toHaveLength(0);
  });

  it('affiche la chronologie et les liens de réglage dans la légende', () => {
    const view = JSDOM.fragment(chronologyView());
    const legend = view.querySelector('.pmd-okf-legend')!;
    expect(legend.querySelector('button[data-action="index-chronology"][aria-pressed="false"]')?.textContent).toBe('Chronologie');
    expect(Array.from(legend.querySelectorAll('a[href]'), (link) => link.textContent)).toEqual(['Arborescence']);
    expect(view.querySelector('.pmd-toolbar, .pmd-subtitle, [data-action="okf-verify"], [data-action="refresh"]')).toBeNull();
    expect(view.querySelectorAll('button')).toHaveLength(1);
  });

  it('conserve le bandeau de propositions et ses accès aux éditeurs', () => {
    const view = JSDOM.fragment(chronologyView({ arborescence: 1 }));
    const banner = view.querySelector('[data-proposals]:not([hidden])')!;
    expect(banner.querySelector('[data-action="edit-tree"]')).not.toBeNull();
  });
});

describe('Graphe du dossier', () => {
  it.each([[undefined, true, 'black'], [false, false, 'glass']] as const)('affiche la légende et le bouton Prémisses avec la préférence %s', (showPremises, pressed, variant) => {
    const view = JSDOM.fragment(graphView({
      types: ['Pièces'],
      typesGraphe: ['Pièces'],
      fiches: [{ id: '/contrat.md', type: 'Pièces', title: 'Contrat', description: '', resource: 'Contrat.pdf', date: '', relations: [] }],
    }, showPremises));
    const wrap = view.querySelector('.pmd-okf-graph-wrap')!;
    expect(wrap.querySelector('[data-okf-graph]')).not.toBeNull();
    const legend = wrap.querySelector('.pmd-okf-legend')!;
    expect(Array.from(legend.querySelectorAll('.pmd-okf-key'), (key) => key.textContent)).toEqual(['Type du document', 'Fiche LOF', 'Partie']);
    expect(legend.querySelector('a[href][data-action="edit-tree"]')?.textContent).toBe('Arborescence');
    const toggle = legend.querySelector('button[data-action="okf-premises"]');
    expect(toggle?.textContent).toBe('Fiches LOF');
    expect(toggle?.getAttribute('aria-pressed')).toBe(String(pressed));
    expect(toggle?.classList.contains(`piecemaker-button--${variant}`)).toBe(true);
    expect(view.querySelector('.pmd-toolbar, .pmd-subtitle, [data-action="refresh"], [data-okf-center], [data-okf-premises]')).toBeNull();
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
  it('omits the mapping and add-party toolbar buttons', () => {
    const html = generalView({ graph: snapshot });

    expect(html).not.toContain('pmd-general-actions');
    expect(html).not.toContain('data-action="add-node"');
    expect(html).not.toContain('> Mapping</button>');
    expect(html).not.toContain('＋ Ajouter une partie</button>');
  });

  it('does not infer a missing position from the anonymised code or the party side', () => {
    const html = generalView({ graph: { ...snapshot, nodes: [{ ...snapshot.nodes[3], data: { partySide: 'adversaire', code: 'ADVERSAIRE_APPELANT_PERSONNE_PHYSIQUE_01' } }] } });
    expect(html).toContain('Partie adverse · Non précisée');
    expect(html).not.toContain('Partie adverse · Appelant');
    expect(html).not.toContain('Partie adverse · Défendeur');
  });

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

  it('offers to rerun the anonymization next to the save button', () => {
    const html = mappingView({ graph: snapshot });

    expect(html).toMatch(/data-save-mapping>Enregistrer<\/button><button [^>]*data-action="scan">Relancer l’anonymisation</);
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


describe('piece names', () => {
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
