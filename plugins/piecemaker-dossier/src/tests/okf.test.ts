import { describe, expect, it } from 'vitest';

import { entities, entityEvidence, ficheLinks, graphElements, linkedEntities, partyEntities, pieceStatements, spreadBoxes } from '../okf.js';
import { ficheCardMarkup } from '../okf-card.js';
import type { OkfIndex } from '../okf.js';
import { documentTitle, linksMarkup, shell } from '../views.js';
import { indexRowResource, isPieceRow } from '../index-analysis.js';

const fiche = (resource: string, type: string, title: string, relations: OkfIndex['fiches'][number]['relations'] = []) => ({ id: `/${resource}.md`, type, title, description: '', resource, date: '', relations });
const index: OkfIndex = {
  types: ['Pièces', 'Projets'],
  typesGraphe: ['Pièces'],
  ontologie: [{ name: 'establishes', label: 'establishes', inverse: 'established by', kind: 'objprop' }],
  fiches: [
    fiche('Pièces/Contrat.pdf', 'Pièces', 'Contrat'),
    fiche('Pièces/Courrier.pdf', 'Pièces', 'Courrier', [{ relation: 'establishes', target: '/Pièces/Contrat.pdf.md', citation: 'Nous faisons suite au contrat.', origin: 'piecemaker/gliner' }]),
    fiche('Projets/Conclusions.docx', 'Projets', 'Conclusions'),
  ],
};

describe('index OKF', () => {
  it('le graphe ne garde que les types choisis et leurs liens', () => {
    const elements = graphElements(index);
    expect(elements.map((element) => element.data.label)).toEqual(['Contrat', 'Courrier', 'establishes']);
    expect(elements[2].data).toMatchObject({ source: '/Pièces/Courrier.pdf.md', target: '/Pièces/Contrat.pdf.md' });
  });

  it('utilise le titre descriptif dans la première colonne et la fiche, sans renommer la source', () => {
    const node = { id: 'document:1', kind: 'document' as const, label: 'Contrat.pdf', aliases: [], data: { path: '/dossier/Pièces/Contrat.pdf' }, date: null };
    const named = { ...index, fiches: index.fiches.map((entry) => entry.resource === 'Pièces/Contrat.pdf' ? { ...entry, title: 'Convention de prestation', titleCitation: 'La présente convention' } : entry) };
    expect(documentTitle(node as never, named, '/dossier')).toBe('Convention de prestation');
    expect(ficheCardMarkup(named, '/Pièces/Contrat.pdf.md')).toContain('class="pmd-fact-title">Convention de prestation</h2>');
    expect(ficheCardMarkup(named, '/Pièces/Contrat.pdf.md')).toContain('La présente convention');
    expect(ficheCardMarkup(named, '/Pièces/Contrat.pdf.md')).toContain('data-open-file="Pièces/Contrat.pdf"');
    expect(documentTitle(node as never, null, '/dossier')).toBe('Contrat.pdf');
  });

  it('les liens se lisent dans les deux sens', () => {
    expect(ficheLinks(index, 'Pièces/Courrier.pdf')).toEqual([{ label: 'establishes →', title: 'Contrat', citation: 'Nous faisons suite au contrat.' }]);
    expect(ficheLinks(index, 'Pièces/Contrat.pdf')).toEqual([{ label: '← established by', title: 'Courrier', citation: 'Nous faisons suite au contrat.' }]);
    expect(ficheLinks(null, 'Pièces/Contrat.pdf')).toEqual([]);
  });

  it('sans ontologie, le lien entrant garde le libellé LOF', () => {
    const bare: OkfIndex = { ...index, ontologie: undefined };
    expect(ficheLinks(bare, 'Pièces/Contrat.pdf')[0].label).toBe('← establishes');
  });

  it('le mode chronologie ne garde que les lignes dont la fiche est une pièce', () => {
    const okf = { fiches: [{ resource: 'Pièces/Contrat.pdf', type: 'Pièces' }, { resource: 'Projets/Conclusions.docx', type: 'Projets' }] };
    expect(isPieceRow(okf, { id: 'a', piece: 'Pièces/Contrat.pdf', documents: [] })).toBe(true);
    expect(isPieceRow(okf, { id: 'b', piece: 'Projets/Conclusions.docx', documents: [] })).toBe(false);
    expect(isPieceRow(okf, { id: 'c', documents: [{ source: 'Inconnu.md' }] })).toBe(false);
    expect(isPieceRow(null, { id: 'd', documents: [] })).toBe(true);
  });

  it('l’Index affiche les liens et citations de chaque pièce', () => {
    const links = linksMarkup(index, indexRowResource({ id: 'r1', piece: 'Pièces/Courrier.pdf', documents: [{ source: 'Fichiers convertis PieceMaker/Courrier.md' }] }));
    expect(links).toContain('establishes → Contrat');
    expect(links).toContain('title="Nous faisons suite au contrat."');
    expect(indexRowResource({ id: 'r2', documents: [{ source: 'Pièces/Note.md' }] })).toBe('Pièces/Note.md');
  });

  it('le graphe a son propre onglet, à côté de l’Index', () => {
    expect(shell('graph')).toMatch(/data-tab="chronology"[\s\S]*data-tab="graph" aria-selected="true"/);
  });
});

const lofIndex: OkfIndex = {
  types: ['Pièces', 'Projets'],
  typesGraphe: ['Pièces'],
  ontologie: [{ name: 'held by', label: 'held by', inverse: 'held by', kind: 'objprop' }, { name: 'has date-time value', label: 'has date-time value', inverse: 'has date-time value', kind: 'dataprop' }],
  fiches: [
    fiche('Pièces/Contrat.pdf', 'Pièces', 'Contrat'),
    fiche('Pièces/Courrier.pdf', 'Pièces', 'Courrier'),
    fiche('Projets/Conclusions.docx', 'Projets', 'Conclusions'),
    { ...fiche('_lof/date-signature', 'temporal instant', 'Date de signature', [
      { relation: 'has date-time value', target: '/Pièces/Contrat.pdf.md', piece: '/Pièces/Contrat.pdf.md', citation: 'Signé le 15 janvier 2026.', origin: 'piecemaker/gliner', value: '2026-01-15' },
      { relation: 'has date-time value', target: '/Pièces/Courrier.pdf.md', piece: '/Pièces/Courrier.pdf.md', citation: 'Le contrat signé le 16 janvier 2026.', origin: 'piecemaker/gliner', value: '2026-01-16' },
    ]), resource: '', lof: 'temporal instant' },
    { ...fiche('_lof/creance', 'legal position', 'Créance <prix>', [
      { relation: 'held by', target: '/_parties/Jean Dupont.md', piece: '/Pièces/Courrier.pdf.md', citation: 'Jean Dupont réclame le prix.', origin: 'piecemaker/agent' },
    ]), resource: '', lof: 'legal position', description: 'Créance du prix de vente' },
    { ...fiche('_lof/vide', 'legal position', 'Sans pièce'), resource: '', lof: 'legal position' },
    { ...fiche('_parties/Jean Dupont', 'material entity', 'Jean Dupont'), resource: '', side: 'client' },
    { ...fiche('_parties/Société Exemple SAS', 'material entity', 'Société Exemple SAS'), resource: '', side: 'adversaire' },
    { ...fiche('_parties/ZETABIO', 'material entity', 'ZETABIO'), resource: '' },
  ],
};

describe('fiches LOF de l’index OKF', () => {
  it('pieceStatements liste les liens LOF fondés sur une pièce', () => {
    expect(pieceStatements(lofIndex, 'Pièces/Courrier.pdf')).toEqual([
      { source: '/_lof/date-signature.md', sourceTitle: 'Date de signature', relation: 'has date-time value', target: '/Pièces/Courrier.pdf.md', targetTitle: 'Courrier', citation: 'Le contrat signé le 16 janvier 2026.', value: '2026-01-16' },
      { source: '/_lof/creance.md', sourceTitle: 'Créance <prix>', relation: 'held by', target: '/_parties/Jean Dupont.md', targetTitle: 'Jean Dupont', citation: 'Jean Dupont réclame le prix.', value: '' },
    ]);
    expect(pieceStatements(null, 'Pièces/Contrat.pdf')).toEqual([]);
    expect(pieceStatements(lofIndex, 'Pièces/Inconnue.pdf')).toEqual([]);
  });

  it('entities ne garde que les fiches LOF, triées sans tenir compte des accents', () => {
    expect(entities(lofIndex).map((entity) => entity.title)).toEqual(['Créance <prix>', 'Date de signature', 'Sans pièce']);
    expect(entities(null)).toEqual([]);
  });

  it('le graphe inclut les fiches LOF et les parties avec leur côté', () => {
    const nodes = graphElements(lofIndex).filter((element) => !element.data.source);
    expect(Object.fromEntries(nodes.map((element) => [element.data.label, element.data.kind]))).toEqual({
      Contrat: 'document',
      Courrier: 'document',
      'Date de signature': 'premise',
      'Créance <prix>': 'premise',
      'Sans pièce': 'premise',
      'Jean Dupont': 'party-client',
      'Société Exemple SAS': 'party-adverse',
      ZETABIO: 'party-tiers',
    });
    expect(graphElements(lofIndex).filter((element) => element.data.source)).toContainEqual({ data: { id: '/_lof/creance.md|held by|/_parties/Jean Dupont.md', source: '/_lof/creance.md', target: '/_parties/Jean Dupont.md', label: 'held by', relation: 'held by' } });
  });

  it('sans les fiches LOF, le graphe retire leurs nœuds et leurs liens', () => {
    const elements = graphElements(lofIndex, false);
    expect(elements.some((element) => element.data.kind === 'premise' || element.data.source?.startsWith('/_lof/'))).toBe(false);
    expect(elements.some((element) => element.data.kind === 'party-client')).toBe(true);
  });

  it('entityEvidence donne les pièces, valeurs et citations d’une fiche', () => {
    expect(entityEvidence(lofIndex, '/_lof/date-signature.md')).toEqual([
      { piece: 'Contrat', resource: 'Pièces/Contrat.pdf', label: 'has date-time value', value: '2026-01-15', citation: 'Signé le 15 janvier 2026.', origin: 'piecemaker/gliner', at: undefined },
      { piece: 'Courrier', resource: 'Pièces/Courrier.pdf', label: 'has date-time value', value: '2026-01-16', citation: 'Le contrat signé le 16 janvier 2026.', origin: 'piecemaker/gliner', at: undefined },
    ]);
    expect(entityEvidence(lofIndex, '/_lof/inconnue.md')).toEqual([]);
  });

  it('partyEntities et linkedEntities relient une fiche LOF à ses parties', () => {
    expect(partyEntities(lofIndex, 'Jean Dupont').map((entity) => entity.title)).toEqual(['Créance <prix>']);
    expect(partyEntities(lofIndex, 'ZETABIO')).toEqual([]);
    expect(partyEntities(null, 'Jean Dupont')).toEqual([]);
    expect(linkedEntities(lofIndex, '/_parties/Jean Dupont.md').map((entity) => entity.id)).toEqual(['/_lof/creance.md']);
  });

  it('la carte d’une fiche LOF donne classe, valeurs, pièces et divergence', () => {
    const html = ficheCardMarkup(lofIndex, '/_lof/date-signature.md');
    expect(html).toContain('<h2 class="pmd-fact-title">Date de signature</h2>');
    expect(html).toContain('temporal instant');
    expect(html).toContain('data-open-fiche="/Pièces/Contrat.pdf.md"');
    expect(html).toContain('« Signé le 15 janvier 2026. »');
    expect(html).toContain('Les sources divergent');
  });

  it('la carte échappe le titre, montre les parties et signale une fiche sans pièce', () => {
    const html = ficheCardMarkup(lofIndex, '/_lof/creance.md');
    expect(html).toContain('Créance &lt;prix&gt;');
    expect(html).not.toContain('<prix>');
    expect(html).toContain('Créance du prix de vente');
    expect(html).toContain('data-open-fiche="/_parties/Jean Dupont.md"');
    expect(ficheCardMarkup(lofIndex, '/_lof/vide.md')).toContain('Aucune pièce ne fonde cette fiche.');
    expect(ficheCardMarkup(lofIndex, '/_lof/inconnue.md')).toBe('');
  });

  it('la carte signe la fiche et chaque lien', () => {
    const signed: OkfIndex = { ...lofIndex, fiches: lofIndex.fiches.map((entry) => ({ ...entry, generated: { by: 'piecemaker/agent', at: '2026-03-02T10:00:00.000Z' }, relations: entry.relations.map((link) => ({ ...link, origin: 'piecemaker/avocat', at: '2026-03-03T09:00:00.000Z' })) })) };
    const html = ficheCardMarkup(signed, '/_lof/creance.md');
    expect(html).toContain('Créée par l’agent le 02/03/2026');
    expect(html).toContain('Lien posé par l’avocat le 03/03/2026');
  });

  it('la carte d’une pièce liste les fiches LOF qui la citent', () => {
    const html = ficheCardMarkup(lofIndex, '/Pièces/Courrier.pdf.md');
    expect(html).toContain('Fiches LOF');
    expect(html).toContain('data-open-fiche="/_lof/creance.md"');
    expect(html).toContain('data-chat-kind="Document"');
  });

  it('la carte d’une partie liste ses fiches LOF', () => {
    const html = ficheCardMarkup(lofIndex, '/_parties/Jean Dupont.md');
    expect(html).toContain('Fiches LOF');
    expect(html).toContain('data-open-fiche="/_lof/creance.md"');
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
