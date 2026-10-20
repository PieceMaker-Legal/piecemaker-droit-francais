import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

import { DocxReasoningStatus, useDocxReasoning } from '@/modules/docx-reasoning';
import { checkDocxDocumentReasoning } from '@/modules/docx-reasoning/api';

vi.mock('@/modules/docx-reasoning/api', () => ({ checkDocxDocumentReasoning: vi.fn() }));

const tested = { status: 'tested' as const, issues: [], objectives: [{ objectif: 'Pénalité fictive', montant_calcule: 720 }] };

beforeEach(() => { vi.resetAllMocks(); });

test('un résultat ancien ne remplace jamais un état modifié pendant le contrôle', async () => {
  let resolve!: (value: { version: number; reasoning: unknown }) => void;
  vi.mocked(checkDocxDocumentReasoning).mockReturnValue(new Promise((done) => { resolve = done; }));
  const { result } = renderHook(() => useDocxReasoning());
  let request!: Promise<void>;
  act(() => { request = result.current.check('projet-fictif', 'contrat.docx', 1); });
  act(() => { result.current.dirty(); });
  await act(async () => { resolve({ version: 1, reasoning: tested }); await request; });
  expect(result.current.state.phase).toBe('dirty');
  expect(result.current.state.report).toBeNull();
});

test('une sauvegarde de la dernière retouche peut publier son résultat et invalide les précédentes', () => {
  const { result } = renderHook(() => useDocxReasoning());
  let first = 0;
  let second = 0;
  act(() => { first = result.current.begin(); });
  act(() => { result.current.dirty(); second = result.current.begin(); });
  act(() => { result.current.publish(second, tested); });
  act(() => { result.current.publish(first, { status: 'error', message: 'Ancienne réponse' }); });
  expect(result.current.state).toEqual({ phase: 'ready', report: tested });
});

test('changer de document efface le résultat et ignore les réponses du document précédent', () => {
  const { result } = renderHook(() => useDocxReasoning());
  let ticket = 0;
  act(() => { ticket = result.current.begin(); });
  act(() => { result.current.reset(); result.current.publish(ticket, tested); });
  expect(result.current.state).toEqual({ phase: 'idle', report: null });
});

test('une version différente sur disque impose une actualisation sans afficher son résultat', async () => {
  vi.mocked(checkDocxDocumentReasoning).mockResolvedValue({ version: 2, reasoning: tested });
  const { result } = renderHook(() => useDocxReasoning());
  await act(async () => { await result.current.check('projet-fictif', 'contrat.docx', 1); });
  expect(result.current.state.phase).toBe('dirty');
  expect(result.current.state.report).toBeNull();
});

test('le statut expose les limites du test et masque les anciens montants dès une modification', () => {
  const view = render(<DocxReasoningStatus state={{ phase: 'ready', report: tested }} onCheck={() => undefined} />);
  expect(screen.getByRole('status').textContent).toBe('Test local exécuté');
  expect(screen.getByText('Modèle embarqué dans ce document. Sources externes non relues.')).toBeTruthy();
  expect(screen.getByText('Pénalité fictive : 720')).toBeTruthy();
  view.rerender(<DocxReasoningStatus state={{ phase: 'dirty', report: tested }} onCheck={() => undefined} />);
  expect(screen.getByRole('status').textContent).toMatch(/vérification à actualiser/);
  expect(screen.queryByText('Pénalité fictive : 720')).toBeNull();
  expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
});

test('les documents sans modèle ne présentent pas de validation ni de commande', () => {
  render(<DocxReasoningStatus state={{ phase: 'ready', report: { status: 'unlinked' } }} onCheck={() => undefined} />);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

test('les erreurs du moteur restent visibles sans ouvrir les détails', () => {
  render(<DocxReasoningStatus state={{ phase: 'ready', report: { status: 'tested', issues: [{ kind: 'erreur', text: 'Référence fictive introuvable.' }] } }} onCheck={() => undefined} />);
  expect(screen.getByRole('status').textContent).toBe('Test local : 1 erreur');
});
