import { describe, expect, it } from 'vitest';

import { factFicheMarkup, factEstablishers, factParties, factStatements, facts, ficheLinks, graphElements, partyFacts } from '../okf.js';
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

  it('le tableau affiche la colonne Liens et le rapport de vérification', () => {
    const node = { id: 'document:1', kind: 'document' as const, label: 'Courrier.pdf', aliases: [], data: { path: '/dossier/Pièces/Courrier.pdf' }, date: null };
    const html = chronologyView({ graph: { nodes: [node], links: [] } as never, okf: index }, '/dossier', undefined, { mode: 'table', errors: [{ fiche: '/Pièces/Courrier.pdf.md', erreur: 'type absent' }] });
    expect(html).toContain('se réfère à → Contrat');
    expect(html).toContain('title="Nous faisons suite au contrat."');
    expect(html).toContain('1 erreur dans l’index');
    expect(chronologyView({ graph: { nodes: [node], links: [] } as never, okf: index }, '/dossier', undefined, { mode: 'graph', errors: null })).toContain('data-okf-graph');
  });
});

const factIndex: OkfIndex = {
  types: ['Pièces', 'Projets', 'Fait', 'Partie'],
  typesGraphe: ['Pièces'],
  fiches: [
    fiche('Pièces/Contrat.pdf', 'Pièces', 'Contrat', [
      { relation: 'states', target: '/Faits/Prix.md', citation: 'Le prix est de 1 000 euros.', origin: 'piecemaker/gliner', value: '1 000 €' },
      { relation: 'states', target: '/Faits/Eligibilite.md', citation: 'Le client remplit les conditions.', origin: 'piecemaker/gliner' },
    ]),
    fiche('Pièces/Courrier.pdf', 'Pièces', 'Courrier', [
      { relation: 'states', target: '/Faits/Prix.md', citation: 'Le prix convenu est de 1 200 euros.', origin: 'piecemaker/gliner', value: '1 200 €' },
    ]),
    fiche('Projets/Conclusions.docx', 'Projets', 'Conclusions'),
    fiche('Faits/Prix', 'Fait', 'Prix'),
    fiche('Faits/Eligibilite', 'Fait', 'Éligibilité'),
    fiche('Faits/Dommage', 'Fait', 'Dommage'),
    fiche('Faits/Clause', 'Fait', 'Clause <pénale>'),
    { ...fiche('Parties/Jean Dupont', 'Partie', 'Jean Dupont'), side: 'client' },
    { ...fiche('Parties/Société Exemple SAS', 'Partie', 'Société Exemple SAS'), side: 'adversaire' },
    fiche('Parties/ZETABIO', 'Partie', 'ZETABIO'),
  ],
};

describe('faits de l’index OKF', () => {
  it('factStatements liste les faits établis par une pièce', () => {
    expect(factStatements(factIndex, 'Pièces/Contrat.pdf')).toEqual([
      { fact: '/Faits/Prix.md', title: 'Prix', citation: 'Le prix est de 1 000 euros.', value: '1 000 €' },
      { fact: '/Faits/Eligibilite.md', title: 'Éligibilité', citation: 'Le client remplit les conditions.', value: '' },
    ]);
  });

  it('factStatements reste vide sans index ou pour une pièce inconnue', () => {
    expect(factStatements(null, 'Pièces/Contrat.pdf')).toEqual([]);
    expect(factStatements(factIndex, 'Pièces/Inconnue.pdf')).toEqual([]);
  });

  it('facts ne garde que les fiches Fait, triées sans tenir compte des accents', () => {
    expect(facts(factIndex).map((fact) => fact.title)).toEqual(['Clause <pénale>', 'Dommage', 'Éligibilité', 'Prix']);
    expect(facts(null)).toEqual([]);
  });

  it('le graphe inclut les faits et les parties avec leur nature', () => {
    const nodes = graphElements(factIndex).filter((element) => !element.data.source);
    expect(Object.fromEntries(nodes.map((element) => [element.data.label, element.data.kind]))).toEqual({
      Contrat: 'document',
      Courrier: 'document',
      Prix: 'fact',
      'Éligibilité': 'fact',
      Dommage: 'fact',
      'Clause <pénale>': 'fact',
      'Jean Dupont': 'party-client',
      'Société Exemple SAS': 'party-adverse',
      ZETABIO: 'party-tiers',
    });
  });

  it('le graphe porte la relation sur chaque arête', () => {
    const edges = graphElements(factIndex).filter((element) => element.data.source);
    expect(edges).toContainEqual({ data: { id: '/Pièces/Contrat.pdf.md|states|/Faits/Prix.md', source: '/Pièces/Contrat.pdf.md', target: '/Faits/Prix.md', label: 'établit', relation: 'states' } });
    expect(edges.every((element) => element.data.relation)).toBe(true);
  });

  it('factEstablishers donne les pièces, valeurs et citations d’un fait', () => {
    expect(factEstablishers(factIndex, '/Faits/Prix.md')).toEqual([
      { piece: 'Contrat', resource: 'Pièces/Contrat.pdf', value: '1 000 €', citation: 'Le prix est de 1 000 euros.' },
      { piece: 'Courrier', resource: 'Pièces/Courrier.pdf', value: '1 200 €', citation: 'Le prix convenu est de 1 200 euros.' },
    ]);
    expect(factEstablishers(factIndex, '/Faits/Inconnu.md')).toEqual([]);
  });

  it('factFicheMarkup affiche les pièces, valeurs et citations', () => {
    const html = factFicheMarkup(factIndex, '/Faits/Prix.md');
    expect(html).toContain('<span class="pmd-profile-eyebrow">Fait</span><strong>Prix</strong>');
    expect(html).toContain('data-open-resource="Pièces/Contrat.pdf"');
    expect(html).toContain('<span class="pmd-relation-type">1 000 €</span><strong class="pmd-relation-target">Contrat</strong>');
    expect(html).toContain('« Le prix est de 1 000 euros. »');
    expect(html).toContain('<strong class="pmd-relation-target">Courrier</strong>');
    expect(html).not.toContain('Aucune pièce');
  });

  it('factFicheMarkup échappe le titre et signale un fait sans pièce', () => {
    const html = factFicheMarkup(factIndex, '/Faits/Clause.md');
    expect(html).toContain('Clause &lt;pénale&gt;');
    expect(html).not.toContain('<pénale>');
    expect(html).toContain('Aucune pièce n’établit ce fait.');
  });

  it('factFicheMarkup reste vide pour un fait inconnu', () => {
    expect(factFicheMarkup(factIndex, '/Faits/Inconnu.md')).toBe('');
  });

  it('ficheLinks affiche la valeur d’un fait établi', () => {
    expect(ficheLinks(factIndex, 'Pièces/Contrat.pdf')).toContainEqual({ label: 'établit →', title: 'Prix : 1 000 €', citation: 'Le prix est de 1 000 euros.' });
    expect(ficheLinks(factIndex, 'Faits/Prix')).toEqual([
      { label: '← établi par', title: 'Contrat', citation: 'Le prix est de 1 000 euros.' },
      { label: '← établi par', title: 'Courrier', citation: 'Le prix convenu est de 1 200 euros.' },
    ]);
  });
});

describe('fiches du graphe', () => {
  const linked: OkfIndex = {
    ...factIndex,
    fiches: factIndex.fiches.map((entry) => entry.title === 'Prix' ? { ...entry, single: true, description: 'Prix de vente', relations: [{ relation: 'involves', target: '/Parties/Jean Dupont.md', citation: '', origin: 'piecemaker/agent' }] } : entry),
  };

  it('factParties et partyFacts relient un fait à ses parties', () => {
    expect(factParties(linked, '/Faits/Prix.md').map((party) => party.title)).toEqual(['Jean Dupont']);
    expect(partyFacts(linked, 'Jean Dupont').map((fact) => fact.title)).toEqual(['Prix']);
    expect(partyFacts(linked, 'ZETABIO')).toEqual([]);
    expect(partyFacts(null, 'Jean Dupont')).toEqual([]);
  });

  it('la fiche d’un fait reprend le design de la fiche de partie', () => {
    const html = factFicheMarkup(linked, '/Faits/Prix.md');
    expect(html).toContain('class="pmd-profile-editor" data-kind="fact" data-side="fact"');
    expect(html).toContain('<span class="pmd-profile-kind">Valeur unique</span>');
    expect(html).toContain('Prix de vente');
    expect(html).toContain('Parties concernées');
    expect(html).toContain('<strong class="pmd-relation-target">Jean Dupont</strong>');
  });
});
