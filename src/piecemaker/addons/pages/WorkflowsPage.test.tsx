import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import '@/modules/i18n/config';

const { getAddonsData } = vi.hoisted(() => ({ getAddonsData: vi.fn() }));
vi.mock('@/piecemaker/addons/api', () => ({ getAddonsData }));

const { appendAddonsWorkflowDraft } = vi.hoisted(() => ({ appendAddonsWorkflowDraft: vi.fn() }));
vi.mock('@/piecemaker/addons/ComposerActions', () => ({ appendAddonsWorkflowDraft }));

import { WorkflowsPage } from '@/piecemaker/addons/pages/WorkflowsPage';
import { readAddonsPage, setAddonsPage } from '@/piecemaker/addons/page';

const WORKFLOWS = [
  {
    id: 'wf-assistant',
    metadata: {
      title: 'Analyse de contrat',
      description: 'Vérifie les clauses essentielles',
      type: 'assistant',
      practice: 'Droit des contrats',
      language: 'fr',
      jurisdictions: null,
    },
    skill_md: 'Lis le contrat puis résume les clauses.',
    columns_config: null,
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'wf-tabular',
    metadata: {
      title: 'Extraction de pièces',
      description: 'Tableau des pièces versées',
      type: 'tabular',
      practice: null,
      language: 'fr',
      jurisdictions: null,
    },
    skill_md: null,
    columns_config: null,
    created_at: '2026-01-02T00:00:00.000Z',
  },
];

const ADDONS = [
  {
    id: 'addon-mike',
    addon_key: 'contract-review',
    pack_key: 'mike-core',
    pack_title: 'Mike Core',
    pack_description: null,
    pack_version: '1.2.0',
    version: '1.0.0',
    title: 'Analyse de contrat (add-on)',
    description: null,
    type: 'assistant',
    contributors: null,
    language: 'fr',
    practice: null,
    jurisdictions: null,
    active: true,
    updated_at: '2026-01-01T00:00:00.000Z',
    assets: [],
  },
];

beforeEach(() => {
  getAddonsData.mockReset().mockImplementation((endpoint: string) => {
    if (endpoint === '/workflows') return Promise.resolve(WORKFLOWS);
    if (endpoint === '/workflow-addons') return Promise.resolve(ADDONS);
    return Promise.reject(new Error(`endpoint inattendu: ${endpoint}`));
  });
  appendAddonsWorkflowDraft.mockReset();
  setAddonsPage('/workflows');
});

describe('page Workflows', () => {
  it('filtre par type de workflow', async () => {
    render(<WorkflowsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Extraction de pièces');

    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
    expect(screen.queryByText('Extraction de pièces')).toBeNull();
    expect(screen.getAllByText('Analyse de contrat').length).toBeGreaterThan(0);
  });

  it('filtre par recherche insensible aux accents', async () => {
    render(<WorkflowsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Extraction de pièces');

    fireEvent.change(screen.getByPlaceholderText('Rechercher un workflow…'), { target: { value: 'verifie' } });
    await waitFor(() => expect(screen.queryByText('Extraction de pièces')).toBeNull());
    expect(screen.getAllByText('Analyse de contrat').length).toBeGreaterThan(0);
  });

  it('utilise le workflow sélectionné dans la session en cours', async () => {
    render(<WorkflowsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Extraction de pièces');

    fireEvent.click(screen.getByRole('button', { name: 'Utiliser dans la session' }));
    expect(appendAddonsWorkflowDraft).toHaveBeenCalledWith(expect.objectContaining({ id: 'wf-assistant' }));
    expect(readAddonsPage()).toBeNull();
  });

  it('bascule vers l’onglet Add-ons et change le champ de recherche', async () => {
    render(<WorkflowsPage projectPath="/dossiers/premier" />);
    await screen.findByText('Extraction de pièces');

    fireEvent.click(screen.getByRole('button', { name: 'Add-ons' }));
    expect(screen.getByPlaceholderText('Rechercher un add-on…')).toBeTruthy();
    await screen.findByText('Mike Core');
    expect(screen.queryByText('Extraction de pièces')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Tous' }));
    expect(screen.getByPlaceholderText('Rechercher un workflow…')).toBeTruthy();
    await screen.findByText('Extraction de pièces');
  });
});
