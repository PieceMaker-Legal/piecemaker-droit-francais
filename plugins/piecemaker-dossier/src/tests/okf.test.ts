import { describe, expect, it } from 'vitest';

import { spreadBoxes, premiseEstablishers, premiseParties, premiseStatements, premises, ficheLinks, graphElements, partyPremises } from '../okf.js';
import { ficheCardMarkup } from '../okf-card.js';
import type { OkfIndex } from '../okf.js';
import { chronologyView, graphView, shell } from '../views.js';

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

  it('utilise le titre descriptif dans la première colonne et la fiche, sans renommer la source', () => {
    const node = { id: 'document:1', kind: 'document' as const, label: 'Contrat.pdf', aliases: [], data: { path: '/dossier/Pièces/Contrat.pdf' }, date: null };
    const named = { ...index, fiches: index.fiches.map((entry) => entry.resource === 'Pièces/Contrat.pdf' ? { ...entry, title: 'Convention de prestation', titleCitation: 'La présente convention' } : entry) };
    const html = chronologyView({ graph: { nodes: [node], links: [] } as never, okf: named }, '/dossier');
    expect(html).toContain('class="pmd-card-title">Convention de prestation</span>');
    expect(ficheCardMarkup(named, '/Pièces/Contrat.pdf.md')).toContain('class="pmd-fact-title">Convention de prestation</h2>');
    expect(ficheCardMarkup(named, '/Pièces/Contrat.pdf.md')).toContain('La présente convention');
    expect(ficheCardMarkup(named, '/Pièces/Contrat.pdf.md')).toContain('data-open-file="Pièces/Contrat.pdf"');
    expect(chronologyView({ graph: { nodes: [node], links: [] } as never }, '/dossier')).toContain('class="pmd-card-title">Contrat.pdf</span>');
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
    const html = chronologyView({ graph: { nodes: [node], links: [] } as never, okf: index }, '/dossier', undefined, { errors: [{ fiche: '/Pièces/Courrier.pdf.md', erreur: 'type absent' }] });
    expect(html).toContain('se réfère à → Contrat');
    expect(html).toContain('title="Nous faisons suite au contrat."');
    expect(html).toContain('1 erreur dans l’index');
    expect(html).not.toContain('data-okf-graph');
  });

  it('le graphe a son propre onglet, à côté de l’Index', () => {
    expect(shell('graph')).toMatch(/data-tab="chronology"[\s\S]*data-tab="graph" aria-selected="true"/);
    expect(graphView(index)).toContain('data-okf-graph');
    expect(graphView(index)).not.toMatch(/data-okf-premises checked/);
    expect(graphView(index, true)).toContain('data-okf-premises checked');
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

  it('sans les prémisses, le graphe retire leurs nœuds et leurs liens', () => {
    const elements = graphElements(premiseIndex, false);
    expect(elements.some((element) => element.data.kind === 'premise')).toBe(false);
    expect(elements.some((element) => element.data.relation === 'states' || element.data.target?.startsWith('/_premises/'))).toBe(false);
    expect(elements.some((element) => element.data.kind === 'party-client')).toBe(true);
  });

  it('le graphe porte la relation sur chaque arête', () => {
    const edges = graphElements(premiseIndex).filter((element) => element.data.source);
    expect(edges).toContainEqual({ data: { id: '/Pièces/Contrat.pdf.md|states|/_premises/Prix.md', source: '/Pièces/Contrat.pdf.md', target: '/_premises/Prix.md', label: 'établit', relation: 'states' } });
    expect(edges.every((element) => element.data.relation)).toBe(true);
  });

  it('premiseEstablishers donne les pièces, valeurs et citations d’une prémisse', () => {
    expect(premiseEstablishers(premiseIndex, '/_premises/Prix.md')).toEqual([
      { piece: 'Contrat', resource: 'Pièces/Contrat.pdf', value: '1 000 €', citation: 'Le prix est de 1 000 euros.', origin: 'piecemaker/gliner', at: undefined },
      { piece: 'Courrier', resource: 'Pièces/Courrier.pdf', value: '1 200 €', citation: 'Le prix convenu est de 1 200 euros.', origin: 'piecemaker/gliner', at: undefined },
    ]);
    expect(premiseEstablishers(premiseIndex, '/_premises/Inconnu.md')).toEqual([]);
  });

  it('la carte d’une prémisse donne valeurs, pièces sources, citations et divergence', () => {
    const html = ficheCardMarkup(premiseIndex, '/_premises/Prix.md');
    expect(html).toContain('<h2 class="pmd-fact-title">Prix</h2>');
    expect(html).toContain('data-detail-close');
    expect(html).toContain('data-open-fiche="/Pièces/Contrat.pdf.md"');
    expect(html).toContain('data-chat-file="Pièces/Contrat.pdf"');
    expect(html).toContain('« Le prix est de 1 000 euros. »');
    expect(html).toContain('data-open-fiche="/Pièces/Courrier.pdf.md">Courrier</button>');
    expect(html).toContain('data-open-file="Pièces/Courrier.pdf"');
    expect(html).not.toContain('Les sources divergent');
    expect(ficheCardMarkup({ ...premiseIndex, fiches: premiseIndex.fiches.map((entry) => ({ ...entry, single: true })) }, '/_premises/Prix.md')).toContain('Les sources divergent');
  });

  it('la carte signe la fiche et chaque lien', () => {
    const signed: OkfIndex = { ...premiseIndex, fiches: premiseIndex.fiches.map((entry) => ({ ...entry, generated: { by: 'piecemaker/agent', at: '2026-03-02T10:00:00.000Z' }, relations: entry.relations.map((link) => ({ ...link, origin: 'piecemaker/avocat', at: '2026-03-03T09:00:00.000Z' })) })) };
    const html = ficheCardMarkup(signed, '/_premises/Prix.md');
    expect(html).toContain('Créée par l’agent le 02/03/2026');
    expect(html).toContain('Lien posé par l’avocat le 03/03/2026');
  });

  it('la carte échappe le titre et signale une prémisse sans pièce', () => {
    const html = ficheCardMarkup(premiseIndex, '/_premises/Clause.md');
    expect(html).toContain('Clause &lt;pénale&gt;');
    expect(html).not.toContain('<pénale>');
    expect(html).toContain('Aucune pièce n’établit cette prémisse.');
    expect(ficheCardMarkup(premiseIndex, '/_premises/Inconnu.md')).toBe('');
  });

  it('la carte d’une pièce liste ses prémisses et la cible au chat', () => {
    const html = ficheCardMarkup(premiseIndex, '/Pièces/Contrat.pdf.md');
    expect(html).toContain('data-edit-fiche');
    expect(html).toContain('data-open-fiche="/_premises/Prix.md"');
    expect(html).toContain('data-chat-kind="Document"');
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

  it('la carte d’une prémisse montre ses parties', () => {
    const html = ficheCardMarkup(linked, '/_premises/Prix.md');
    expect(html).toContain('Prémisse · valeur unique');
    expect(html).toContain('Prix de vente');
    expect(html).toContain('data-open-fiche="/Parties/Jean Dupont.md"');
  });

  it('la carte d’une prémisse ne propose plus de revue tabulaire', () => {
    expect(ficheCardMarkup(premiseIndex, '/_premises/Prix.md')).not.toContain('data-premise-review');
  });
});

describe('écartement du graphe', () => {
  it('spreadBoxes sépare les nœuds superposés d’au moins l’écart demandé', () => {
    const boxes = [{ x: 0, y: 0, w: 100, h: 36 }, { x: 10, y: 5, w: 100, h: 36 }, { x: 20, y: 0, w: 60, h: 36 }];
    spreadBoxes(boxes, 20);
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
      const [a, b] = [boxes[i], boxes[j]];
      const apart = Math.abs(a.x - b.x) >= (a.w + b.w) / 2 + 19.9 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2 + 19.9;
      expect(apart).toBe(true);
    }
  });

  it('spreadBoxes écarte une rangée de nœuds sans l’étirer en ligne', () => {
    const boxes = Array.from({ length: 6 }, (_, at) => ({ x: at * 40, y: 0, w: 120, h: 36 }));
    spreadBoxes(boxes, 24, 12);
    expect(Math.max(...boxes.map((box) => box.x)) - Math.min(...boxes.map((box) => box.x))).toBeLessThan(6 * 144);
    expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBeGreaterThan(1);
  });
});
