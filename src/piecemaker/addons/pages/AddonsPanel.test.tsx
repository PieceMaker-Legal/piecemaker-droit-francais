import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/modules/i18n/config';

const { getAddonsData } = vi.hoisted(() => ({ getAddonsData: vi.fn() }));
vi.mock('@/piecemaker/addons/api', () => ({ getAddonsData }));

const { appendAddonsWorkflowDraft } = vi.hoisted(() => ({ appendAddonsWorkflowDraft: vi.fn() }));
vi.mock('@/piecemaker/addons/ComposerActions', () => ({ appendAddonsWorkflowDraft }));

import { AddonsPanel } from '@/piecemaker/addons/pages/AddonsPanel';
import { readAddonsPage, setAddonsPage } from '@/piecemaker/addons/page';

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
  getAddonsData.mockReset().mockImplementation((endpoint: string) => {
    if (endpoint === '/workflow-addons') return Promise.resolve(ADDONS);
    const match = endpoint.match(/^\/workflow-addons\/(.+)$/);
    if (match) return Promise.resolve(ADDON_DETAILS[match[1]]);
    return Promise.reject(new Error(`endpoint inattendu: ${endpoint}`));
  });
  appendAddonsWorkflowDraft.mockReset();
  setAddonsPage('/workflows');
});

describe('panneau Add-ons', () => {
  it('affiche les packs puis les add-ons du pack sélectionné', async () => {
    render(<AddonsPanel projectPath="/dossiers/premier" search="" />);
    await screen.findByText('Mike Core');

    expect(screen.getByText('Claude for Legal France — Litige')).toBeTruthy();
    expect(screen.queryByText('Analyse de contrat')).toBeNull();

    fireEvent.click(screen.getByText('Mike Core'));
    await waitFor(() => expect(screen.getAllByText('Analyse de contrat').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /Retour aux packs/ })).toBeTruthy();
  });

  it('revient à la liste des packs', async () => {
    render(<AddonsPanel projectPath="/dossiers/premier" search="" />);
    await screen.findByText('Mike Core');

    fireEvent.click(screen.getByText('Mike Core'));
    await waitFor(() => expect(screen.getAllByText('Analyse de contrat').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByRole('button', { name: /Retour aux packs/ }));
    await screen.findByText('Mike Core');
    expect(screen.queryByText('Analyse de contrat')).toBeNull();
  });

  it('filtre par source vers les packs français', async () => {
    render(<AddonsPanel projectPath="/dossiers/premier" search="" />);
    await screen.findByText('Mike Core');

    fireEvent.click(screen.getByRole('button', { name: 'Claude for Legal France' }));
    await waitFor(() => expect(screen.queryByText('Mike Core')).toBeNull());
    expect(screen.getByText('Claude for Legal France — Litige')).toBeTruthy();
  });

  it('filtre par recherche sur le titre et masque les packs vides', async () => {
    const { rerender } = render(<AddonsPanel projectPath="/dossiers/premier" search="" />);
    await screen.findByText('Mike Core');

    rerender(<AddonsPanel projectPath="/dossiers/premier" search="extraction" />);
    await waitFor(() => expect(screen.queryByText('Mike Core')).toBeNull());
    const packButton = await screen.findByText('Claude for Legal France — Litige');
    fireEvent.click(packButton);
    await waitFor(() => expect(screen.getAllByText('Extraction de pièces').length).toBeGreaterThan(0));
  });

  it('charge et affiche le détail d’un add-on sélectionné', async () => {
    render(<AddonsPanel projectPath="/dossiers/premier" search="" />);
    await screen.findByText('Claude for Legal France — Litige');

    fireEvent.click(screen.getByText('Claude for Legal France — Litige'));
    await screen.findByText('Extrais les pièces du dossier.');
    expect(screen.getByText(/modele\.docx/)).toBeTruthy();
  });

  it('utilise l’add-on assistant sélectionné dans la session en cours', async () => {
    render(<AddonsPanel projectPath="/dossiers/premier" search="" />);
    await screen.findByText('Mike Core');

    fireEvent.click(screen.getByText('Mike Core'));
    fireEvent.click(await screen.findByRole('button', { name: 'Utiliser dans la session' }));
    expect(appendAddonsWorkflowDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'addon-mike' }));
    expect(readAddonsPage()).toBeNull();
  });

  it('affiche le libellé vide quand aucun add-on n’est disponible', async () => {
    getAddonsData.mockReset().mockImplementation((endpoint: string) => {
      if (endpoint === '/workflow-addons') return Promise.resolve([]);
      return Promise.reject(new Error(`endpoint inattendu: ${endpoint}`));
    });
    render(<AddonsPanel projectPath="/dossiers/premier" search="" />);
    await screen.findByText('Aucun add-on disponible.');
  });
});
