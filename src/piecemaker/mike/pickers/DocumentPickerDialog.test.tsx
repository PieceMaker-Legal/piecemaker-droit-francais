import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMikeData } = vi.hoisted(() => ({ getMikeData: vi.fn() }));
vi.mock('@/piecemaker/mike/api', () => ({ getMikeData }));

import { DocumentPickerDialog } from '@/piecemaker/mike/pickers/DocumentPickerDialog';

const ROOT_RESPONSE = {
  documents: [
    { id: 'doc-1', filename: 'Assignation.pdf', file_type: 'pdf', size_bytes: 2_400_000, status: 'ready', created_at: '2026-01-05T00:00:00.000Z', folder_id: null },
  ],
  folders: [{ id: 'folder-1', name: 'Contrats', parent_folder_id: null }],
};

const FOLDER_RESPONSE = {
  documents: [
    { id: 'doc-2', filename: 'Bail commercial.docx', file_type: 'docx', size_bytes: 15_000, status: 'ready', created_at: '2026-01-06T00:00:00.000Z', folder_id: 'folder-1' },
  ],
  folders: [],
};

const SEARCH_RESPONSE = {
  documents: [
    { id: 'doc-3', filename: 'Bail commercial 2024.docx', file_type: 'docx', size_bytes: 16_000, status: 'ready', created_at: '2026-01-07T00:00:00.000Z', folder_id: null },
  ],
  folders: [],
};

beforeEach(() => {
  getMikeData.mockReset().mockImplementation(async (endpoint: string) => {
    if (endpoint.includes('view=search')) return SEARCH_RESPONSE;
    if (endpoint.includes('parent_folder_id')) return FOLDER_RESPONSE;
    return ROOT_RESPONSE;
  });
});

describe('DocumentPickerDialog', () => {
  it('affiche les dossiers et documents de la bibliothèque', async () => {
    render(<DocumentPickerDialog open onClose={vi.fn()} onConfirm={vi.fn()} />);
    await screen.findByText('Assignation.pdf');
    expect(screen.getByText('Contrats')).toBeTruthy();
    expect(getMikeData).toHaveBeenCalledWith('/library/file');
  });

  it('recherche un document côté serveur', async () => {
    render(<DocumentPickerDialog open onClose={vi.fn()} onConfirm={vi.fn()} />);
    await screen.findByText('Assignation.pdf');

    fireEvent.change(screen.getByPlaceholderText('Rechercher un document…'), { target: { value: 'bail' } });
    await screen.findByText('Bail commercial 2024.docx');
    expect(getMikeData).toHaveBeenCalledWith('/library/file?view=search&search=bail');
  });

  it('sélectionne des documents à travers la navigation puis confirme', async () => {
    const onConfirm = vi.fn();
    render(<DocumentPickerDialog open onClose={vi.fn()} onConfirm={onConfirm} />);
    await screen.findByText('Assignation.pdf');

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByText('Contrats'));
    await screen.findByText('Bail commercial.docx');
    fireEvent.click(screen.getByRole('checkbox'));

    expect(screen.getByText('2 documents sélectionnés')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(onConfirm).toHaveBeenCalledWith(expect.arrayContaining(['doc-1', 'doc-2']));
    expect(onConfirm.mock.calls[0][0]).toHaveLength(2);
  });

  it('désactive Confirmer tant qu’aucun document n’est sélectionné', async () => {
    render(<DocumentPickerDialog open onClose={vi.fn()} onConfirm={vi.fn()} />);
    await screen.findByText('Assignation.pdf');
    expect((screen.getByRole('button', { name: 'Confirmer' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('affiche une erreur récupérable', async () => {
    getMikeData.mockReset().mockRejectedValueOnce(new Error('Bibliothèque Mike indisponible')).mockResolvedValueOnce(ROOT_RESPONSE);
    render(<DocumentPickerDialog open onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect((await screen.findByRole('alert')).textContent).toContain('Bibliothèque Mike indisponible');

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await screen.findByText('Assignation.pdf');
  });

  it('ne charge rien tant que la boîte de dialogue est fermée', () => {
    render(<DocumentPickerDialog open={false} onClose={vi.fn()} onConfirm={vi.fn()} />);
    expect(getMikeData).not.toHaveBeenCalled();
  });
});
