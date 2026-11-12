import { describe, expect, it } from 'vitest';

import { premiseFicheMarkup, premiseReviewDraft, premiseEstablishers, premiseParties, premiseStatements, premises, ficheLinks, graphElements, partyPremises } from '../okf.js';
import type { OkfIndex } from '../okf.js';
import { chronologyView } from '../views.js';

const fiche = (resource: string, type: string, title: string, relations: OkfIndex['fiches'][number]['relations'] = []) => ({ id: `/${resource}.md`, type, title, description: '', resource, date: '', relations });
const index: OkfIndex = {
  types: ['Pièces', 'Projets'],
  typesGraphe: ['Pièces'],
  fiches: [
    fiche('Pièces/Contrat.pdf', 'Pièces', 'Contrat'),
    fiche('Pièces/Courrier.pdf', 'Pièces', 'Courrier', [{ relation: 'refers-to', target: '/Pièces/Contrat.pdf.md', citation: 'Nous faisons suite au contrat.', origin: 'piecemaker/gliner' }]),
    fiche('Projets/Conclusions.docx', 'Projets', 'Conclusions'),
  ],
};

describe('index OKF', () => {
  it('le graphe ne garde que les types choisis et leurs liens', () => {
    const elements = graphElements(index);
    expect(elements.map((element) => element.data.label)).toEqual(['Contrat', 'Courrier', 'se réfère à']);
    expect(elements[2].data).toMatchObject({ source: '/Pièces/Courrier.pdf.md', target: '/Pièces/Contrat.pdf.md' });
  });

  it('les liens se lisent dans les deux sens', () => {
    expect(ficheLinks(index, 'Pièces/Courrier.pdf')).toEqual([{ label: 'se réfère à →', title: 'Contrat', citation: 'Nous faisons suite au contrat.' }]);
    expect(ficheLinks(index, 'Pièces/Contrat.pdf')).toEqual([{ label: '← visé par', title: 'Courrier', citation: 'Nous faisons suite au contrat.' }]);
    expect(ficheLinks(null, 'Pièces/Contrat.pdf')).toEqual([]);
  });

  it('les libellés suivent l’ontologie du dossier', () => {
    const custom: OkfIndex = { ...index, ontologie: [{ name: 'refers-to', label: 'invoque', inverse: 'invoqué par' }] };
    expect(ficheLinks(custom, 'Pièces/Courrier.pdf')[0].label).toBe('invoque →');
    expect(ficheLinks(custom, 'Pièces/Contrat.pdf')[0].label).toBe('← invoqué par');
    expect(graphElements(custom)[2].data.label).toBe('invoque');
  });

  it('le tableau affiche la colonne Liens et le rapport de vérification', () => {
    const node = { id: 'document:1', kind: 'document' as const, label: 'Courrier.pdf', aliases: [], data: { path: '/dossier/Pièces/Courrier.pdf' }, date: null };
    const html = chronologyView({ graph: { nodes: [node], links: [] } as never, okf: index }, '/dossier', undefined, { mode: 'table', errors: [{ fiche: '/Pièces/Courrier.pdf.md', erreur: 'type absent' }] });
    expect(html).toContain('se réfère à → Contrat');
    expect(html).toContain('title="Nous faisons suite au contrat."');
    expect(html).toContain('1 erreur dans l’index');
    expect(chronologyView({ graph: { nodes: [node], links: [] } as never, okf: index }, '/dossier', undefined, { mode: 'graph', errors: null })).toContain('data-okf-graph');
  });
});

const premiseIndex: OkfIndex = {
  types: ['Pièces', 'Projets', 'Premise', 'Partie'],
  typesGraphe: ['Pièces'],
  fiches: [
    fiche('Pièces/Contrat.pdf', 'Pièces', 'Contrat', [
      { relation: 'states', target: '/_premises/Prix.md', citation: 'Le prix est de 1 000 euros.', origin: 'piecemaker/gliner', value: '1 000 €' },
      { relation: 'states', target: '/_premises/Eligibilite.md', citation: 'Le client remplit les conditions.', origin: 'piecemaker/gliner' },
    ]),
    fiche('Pièces/Courrier.pdf', 'Pièces', 'Courrier', [
      { relation: 'states', target: '/_premises/Prix.md', citation: 'Le prix convenu est de 1 200 euros.', origin: 'piecemaker/gliner', value: '1 200 €' },
    ]),
    fiche('Projets/Conclusions.docx', 'Projets', 'Conclusions'),
    fiche('_premises/Prix', 'Premise', 'Prix'),
    fiche('_premises/Eligibilite', 'Premise', 'Éligibilité'),
    fiche('_premises/Dommage', 'Premise', 'Dommage'),
    fiche('_premises/Clause', 'Premise', 'Clause <pénale>'),
    { ...fiche('Parties/Jean Dupont', 'Partie', 'Jean Dupont'), side: 'client' },
    { ...fiche('Parties/Société Exemple SAS', 'Partie', 'Société Exemple SAS'), side: 'adversaire' },
    fiche('Parties/ZETABIO', 'Partie', 'ZETABIO'),
  ],
};

describe('prémisses de l’index OKF', () => {
  it('premiseStatements liste les prémisses établies par une pièce', () => {
    expect(premiseStatements(premiseIndex, 'Pièces/Contrat.pdf')).toEqual([
      { premise: '/_premises/Prix.md', title: 'Prix', citation: 'Le prix est de 1 000 euros.', value: '1 000 €' },
      { premise: '/_premises/Eligibilite.md', title: 'Éligibilité', citation: 'Le client remplit les conditions.', value: '' },
    ]);
  });

  it('premiseStatements reste vide sans index ou pour une pièce inconnue', () => {
    expect(premiseStatements(null, 'Pièces/Contrat.pdf')).toEqual([]);
    expect(premiseStatements(premiseIndex, 'Pièces/Inconnue.pdf')).toEqual([]);
  });

  it('premises ne garde que les fiches Premise, triées sans tenir compte des accents', () => {
    expect(premises(premiseIndex).map((premise) => premise.title)).toEqual(['Clause <pénale>', 'Dommage', 'Éligibilité', 'Prix']);
    expect(premises(null)).toEqual([]);
  });

  it('le graphe inclut les prémisses et les parties avec leur nature', () => {
    const nodes = graphElements(premiseIndex).filter((element) => !element.data.source);
    expect(Object.fromEntries(nodes.map((element) => [element.data.label, element.data.kind]))).toEqual({
      Contrat: 'document',
      Courrier: 'document',
      Prix: 'premise',
      'Éligibilité': 'premise',
      Dommage: 'premise',
      'Clause <pénale>': 'premise',
      'Jean Dupont': 'party-client',
      'Société Exemple SAS': 'party-adverse',
      ZETABIO: 'party-tiers',
    });
  });

  it('le graphe porte la relation sur chaque arête', () => {
    const edges = graphElements(premiseIndex).filter((element) => element.data.source);
    expect(edges).toContainEqual({ data: { id: '/Pièces/Contrat.pdf.md|states|/_premises/Prix.md', source: '/Pièces/Contrat.pdf.md', target: '/_premises/Prix.md', label: 'établit', relation: 'states' } });
    expect(edges.every((element) => element.data.relation)).toBe(true);
  });

  it('premiseEstablishers donne les pièces, valeurs et citations d’une prémisse', () => {
    expect(premiseEstablishers(premiseIndex, '/_premises/Prix.md')).toEqual([
      { piece: 'Contrat', resource: 'Pièces/Contrat.pdf', value: '1 000 €', citation: 'Le prix est de 1 000 euros.' },
      { piece: 'Courrier', resource: 'Pièces/Courrier.pdf', value: '1 200 €', citation: 'Le prix convenu est de 1 200 euros.' },
    ]);
    expect(premiseEstablishers(premiseIndex, '/_premises/Inconnu.md')).toEqual([]);
  });

  it('premiseFicheMarkup affiche les pièces, valeurs et citations', () => {
    const html = premiseFicheMarkup(premiseIndex, '/_premises/Prix.md');
    expect(html).toContain('<span class="pmd-profile-eyebrow">Prémisse</span><strong>Prix</strong>');
    expect(html).toContain('data-open-resource="Pièces/Contrat.pdf"');
    expect(html).toContain('<span class="pmd-relation-type">1 000 €</span><strong class="pmd-relation-target">Contrat</strong>');
    expect(html).toContain('« Le prix est de 1 000 euros. »');
    expect(html).toContain('<strong class="pmd-relation-target">Courrier</strong>');
    expect(html).not.toContain('Aucune pièce');
  });

  it('premiseFicheMarkup échappe le titre et signale une prémisse sans pièce', () => {
    const html = premiseFicheMarkup(premiseIndex, '/_premises/Clause.md');
    expect(html).toContain('Clause &lt;pénale&gt;');
    expect(html).not.toContain('<pénale>');
    expect(html).toContain('Aucune pièce n’établit cette prémisse.');
  });

  it('premiseFicheMarkup reste vide pour une prémisse inconnue', () => {
    expect(premiseFicheMarkup(premiseIndex, '/_premises/Inconnu.md')).toBe('');
  });

  it('ficheLinks affiche la valeur d’une prémisse établie', () => {
    expect(ficheLinks(premiseIndex, 'Pièces/Contrat.pdf')).toContainEqual({ label: 'établit →', title: 'Prix : 1 000 €', citation: 'Le prix est de 1 000 euros.' });
    expect(ficheLinks(premiseIndex, '_premises/Prix')).toEqual([
      { label: '← établi par', title: 'Contrat', citation: 'Le prix est de 1 000 euros.' },
      { label: '← établi par', title: 'Courrier', citation: 'Le prix convenu est de 1 200 euros.' },
    ]);
  });
});

describe('fiches du graphe', () => {
  const linked: OkfIndex = {
    ...premiseIndex,
    fiches: premiseIndex.fiches.map((entry) => entry.title === 'Prix' ? { ...entry, single: true, description: 'Prix de vente', relations: [{ relation: 'involves', target: '/Parties/Jean Dupont.md', citation: '', origin: 'piecemaker/agent' }] } : entry),
  };

  it('premiseParties et partyPremises relient une prémisse à ses parties', () => {
    expect(premiseParties(linked, '/_premises/Prix.md').map((party) => party.title)).toEqual(['Jean Dupont']);
    expect(partyPremises(linked, 'Jean Dupont').map((premise) => premise.title)).toEqual(['Prix']);
    expect(partyPremises(linked, 'ZETABIO')).toEqual([]);
    expect(partyPremises(null, 'Jean Dupont')).toEqual([]);
  });

  it('la fiche d’une prémisse reprend le design de la fiche de partie', () => {
    const html = premiseFicheMarkup(linked, '/_premises/Prix.md');
    expect(html).toContain('class="pmd-profile-editor" data-kind="premise" data-side="premise"');
    expect(html).toContain('<span class="pmd-profile-kind">Valeur unique</span>');
    expect(html).toContain('Prix de vente');
    expect(html).toContain('Parties concernées');
    expect(html).toContain('<strong class="pmd-relation-target">Jean Dupont</strong>');
  });

  it('premiseReviewDraft prépare une revue à une colonne qui porte la prémisse', () => {
    expect(premiseFicheMarkup(premiseIndex, '/_premises/Prix.md')).toContain('data-premise-review');
    expect(premiseReviewDraft(premiseIndex, '/_premises/Prix.md', '/dossier-fictif')).toEqual({ project: '/dossier-fictif', title: 'Prix', templateName: '', columns: [{ name: 'Prix', prompt: 'Prix', format: 'text', premise: 'checkpoint' }], rows: [] });
    expect(premiseReviewDraft({ ...premiseIndex, fiches: premiseIndex.fiches.map((entry) => ({ ...entry, single: true })) }, '/_premises/Prix.md', '/dossier-fictif')?.columns[0].premise).toBe('single');
    expect(premiseReviewDraft(premiseIndex, '/_premises/Inconnue.md', '/dossier-fictif')).toBeNull();
  });
});
