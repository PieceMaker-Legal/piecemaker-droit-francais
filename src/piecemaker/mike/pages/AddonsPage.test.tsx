import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMikeData } = vi.hoisted(() => ({ getMikeData: vi.fn() }));
vi.mock('@/piecemaker/mike/api', () => ({ getMikeData }));

const { appendMikeWorkflowDraft } = vi.hoisted(() => ({ appendMikeWorkflowDraft: vi.fn() }));
vi.mock('@/piecemaker/mike/ComposerActions', () => ({ appendMikeWorkflowDraft }));

import { AddonsPage } from '@/piecemaker/mike/pages/AddonsPage';
import { readMikePage, setMikePage } from '@/piecemaker/mike/page';

const ADDONS = [
  {
    id: 'addon-mike',
    addon_key: 'contract-review',
    pack_key: 'mike-core',
    pack_title: 'Mike Core',
    pack_description: 'Add-ons publiés par Open-Legal-Products.',
    pack_version: '1.2.0',
    version: '1.0.0',
    title: 'Analyse de contrat',
    description: 'Vérifie les clauses essentielles',
    type: 'assistant',
    contributors: [{ name: 'Jane Doe', organisation: 'Open-Legal-Products', role: 'auteur', linkedin: null }],
    language: 'fr',
    practice: 'Droit des contrats',
    jurisdictions: null,
    active: true,
    updated_at: '2026-01-01T00:00:00.000Z',
    assets: [],
  },
  {
    id: 'addon-fr-tabular',
    addon_key: 'extraction-pieces',
    pack_key: 'claude-for-legal-fr-litige',
    pack_title: 'Claude for Legal France — Litige',
    pack_description: 'https://github.com/PieceMaker-Legal/claude-for-legal-fr',
    pack_version: '0.3.0',
    version: '2.0.0',
    title: 'Extraction de pièces',
    description: 'Tableau des pièces versées',
    type: 'tabular',
    contributors: null,
    language: 'fr',
    practice: null,
    jurisdictions: ['FR'],
    active: true,
    updated_at: '2026-01-02T00:00:00.000Z',
    assets: [{ id: 'asset-1', filename: 'modele.docx', file_type: 'docx', size_bytes: 12345, created_at: '2026-01-02T00:00:00.000Z' }],
  },
];

const ADDON_DETAILS: Record<string, unknown> = {
  'addon-mike': { ...ADDONS[0], prompt_md: 'Lis le contrat puis résume les clauses.', columns_config: null },
  'addon-fr-tabular': { ...ADDONS[1], prompt_md: 'Extrais les pièces du dossier.', columns_config: null },
};

beforeEach(() => {
  getMikeData.mockReset().mockImplementation((endpoint: string) => {
    if (endpoint === '/workflow-addons') return Promise.resolve(ADDONS);
    const match = endpoint.match(/^\/workflow-addons\/(.+)$/);
    if (match) return Promise.resolve(ADDON_DETAILS[match[1]]);
    return Promise.reject(new Error(`endpoint inattendu: ${endpoint}`));
  });
  appendMikeWorkflowDraft.mockReset();
  setMikePage('/workflow-addons');
});

describe('page Add-ons', () => {
  it('regroupe les add-ons par pack et affiche les deux sources', async () => {
    render(<AddonsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Analyse de contrat');

    expect(screen.getByText('Mike Core')).toBeTruthy();
    expect(screen.getByText('Claude for Legal France — Litige')).toBeTruthy();
    expect(screen.getByText('Extraction de pièces')).toBeTruthy();
  });

  it('filtre par source vers les packs français', async () => {
    render(<AddonsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Analyse de contrat');

    fireEvent.click(screen.getByRole('button', { name: 'Claude for Legal France' }));
    await waitFor(() => expect(screen.queryByText('Analyse de contrat')).toBeNull());
    expect(screen.getAllByText('Extraction de pièces').length).toBeGreaterThan(0);
  });

  it('filtre par type tabulaire', async () => {
    render(<AddonsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Analyse de contrat');

    fireEvent.click(screen.getByRole('button', { name: 'Tabulaire' }));
    await waitFor(() => expect(screen.queryByText('Analyse de contrat')).toBeNull());
    expect(screen.getAllByText('Extraction de pièces').length).toBeGreaterThan(0);
  });

  it('filtre par recherche sur le titre', async () => {
    render(<AddonsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Analyse de contrat');

    fireEvent.change(screen.getByPlaceholderText('Rechercher un add-on…'), { target: { value: 'extraction' } });
    await waitFor(() => expect(screen.queryByText('Analyse de contrat')).toBeNull());
    expect(screen.getAllByText('Extraction de pièces').length).toBeGreaterThan(0);
  });

  it('charge et affiche le détail d’un add-on sélectionné', async () => {
    render(<AddonsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Analyse de contrat');

    fireEvent.click(screen.getAllByText('Extraction de pièces')[0]);
    await screen.findByText('Extrais les pièces du dossier.');
    expect(screen.getByText(/modele\.docx/)).toBeTruthy();
  });

  it('utilise l’add-on assistant sélectionné dans la session en cours', async () => {
    render(<AddonsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Analyse de contrat');

    fireEvent.click(await screen.findByRole('button', { name: 'Utiliser dans la session' }));
    expect(appendMikeWorkflowDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'addon-mike' }));
    expect(readMikePage()).toBeNull();
  });

  it('affiche le libellé vide quand aucun add-on n’est disponible', async () => {
    getMikeData.mockReset().mockImplementation((endpoint: string) => {
      if (endpoint === '/workflow-addons') return Promise.resolve([]);
      return Promise.reject(new Error(`endpoint inattendu: ${endpoint}`));
    });
    render(<AddonsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Aucun add-on disponible.');
  });
});
