import { describe, expect, it } from 'vitest';

import { ficheLinks, graphElements } from '../okf.js';
import type { OkfIndex } from '../okf.js';
import { chronologyView } from '../views.js';

const fiche = (resource: string, type: string, title: string, relations: OkfIndex['fiches'][number]['relations'] = []) => ({ id: `/${resource}.md`, type, title, description: '', resource, date: '', atomes: 0, relations });
const index: OkfIndex = {
  types: ['Pièces', 'Projets'],
  typesGraphe: ['Pièces'],
  fiches: [
    fiche('Pièces/Contrat.pdf', 'Pièces', 'Contrat'),
    fiche('Pièces/Courrier.pdf', 'Pièces', 'Courrier', [{ relation: 'se-refere-a', cible: '/Pièces/Contrat.pdf.md', citation: 'Nous faisons suite au contrat.', origine: 'piecemaker/gliner' }]),
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
