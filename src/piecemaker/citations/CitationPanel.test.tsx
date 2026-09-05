import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CitationPanel } from '@/piecemaker/citations/CitationPanel';
import { startCitationPanel } from '@/piecemaker/citations/bootstrap';
import { fetchCitationSource } from '@/piecemaker/citations/api';
import { legifranceQuoteUrl } from '@/piecemaker/citations/legifrance';

vi.mock('@/piecemaker/citations/api', () => ({ fetchCitationSource: vi.fn() }));

const token = 'a'.repeat(64);
const snapshot = {
  title: 'Décision JURITEXT1',
  source: 'Premier extrait. Texte intermédiaire. Deuxième extrait.',
  citation: { ref: 1, verified: true, quotes: [
    { quote: 'Premier extrait.', verification: { verified: true } },
    { quote: 'Deuxième extrait.', verification: { verified: true } },
  ] },
  ranges: [{ start: 0, end: 16, quoteIndex: 0 }, { start: 38, end: 55, quoteIndex: 1 }],
};

beforeEach(() => {
  vi.mocked(fetchCitationSource).mockResolvedValue(snapshot);
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.clearAllMocks());

describe('visionneuse de citations', () => {
  it('ouvre la source, surligne le passage et permet de passer au deuxième extrait', async () => {
    const close = vi.fn();
    const { container } = render(<CitationPanel token={token} onClose={close} />);
    await screen.findByText('Décision JURITEXT1');
    expect(container.querySelector('mark')?.textContent).toBe('Premier extrait.');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    fireEvent.click(screen.getByRole('button', { name: 'Extrait suivant' }));
    expect(container.querySelector('mark')?.textContent).toBe('Deuxième extrait.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('signale un extrait introuvable sans inventer de surlignage', async () => {
    vi.mocked(fetchCitationSource).mockResolvedValue({ ...snapshot, ranges: [], citation: { ref: 1, verified: false, quotes: [{ quote: 'Extrait inventé.', verification: { verified: false } }] } });
    const { container } = render(<CitationPanel token={token} onClose={() => {}} />);
    await screen.findByText(/Extrait non retrouvé/);
    expect(container.querySelector('mark')).toBeNull();
    expect(screen.getByLabelText('Texte source').textContent).toBe(snapshot.source);
  });

  it('un lien du chat ouvre le panneau à droite et la fermeture rend le focus au lien', async () => {
    const stop = startCitationPanel();
    const link = document.createElement('a');
    link.href = `#piecemaker-citation=${token}`;
    link.textContent = '[1]';
    document.body.appendChild(link);
    try {
      fireEvent.click(link);
      await screen.findByRole('complementary', { name: 'Source de la citation' });
      expect(document.documentElement.classList.contains('piecemaker-citation-open')).toBe(true);
      await screen.findByText('Décision JURITEXT1');
      fireEvent.click(screen.getByRole('button', { name: 'Fermer la source' }));
      expect(document.getElementById('piecemaker-citation-panel')).toBeNull();
      expect(document.activeElement).toBe(link);
    } finally { act(stop); link.remove(); }
  });

  it('une source indisponible affiche un message sans détails internes', async () => {
    vi.mocked(fetchCitationSource).mockRejectedValue(new Error('internal path secret'));
    render(<CitationPanel token={token} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('La source de cette citation est indisponible.'));
    expect(screen.queryByText(/internal path/)).toBeNull();
  });

  it('la copie locale est consultable sans masquer le statut initial et le lien officiel cible l’extrait actif', async () => {
    vi.mocked(fetchCitationSource).mockResolvedValue({ ...snapshot, sourceOrigin: 'decision-cache', citation: {
      ...snapshot.citation, decision_id: 'JURITEXT000007048138', verified: false,
      quotes: snapshot.citation.quotes.map((quote) => ({ ...quote, verification: { verified: false } })),
    } });
    const { container } = render(<CitationPanel token={token} onClose={() => {}} />);
    await screen.findByText(/La citation reste non vérifiée lors de la réponse/);
    expect(container.querySelector('mark')?.textContent).toBe('Premier extrait.');
    const link = screen.getByRole('link', { name: /Ouvrir ce passage sur Légifrance/ });
    expect(link.getAttribute('href')).toBe('https://www.legifrance.gouv.fr/juri/id/JURITEXT000007048138/#:~:text=Premier%20extrait.');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('referrerpolicy')).toBe('no-referrer');
    fireEvent.click(screen.getByRole('button', { name: 'Extrait suivant' }));
    expect(link.getAttribute('href')).toContain('text=Deuxi%C3%A8me%20extrait.');
    expect(container.querySelector('iframe')).toBeNull();
  });
});

it('les liens Légifrance utilisent uniquement le domaine officiel et ciblent chaque segment sans syntaxe parasite', () => {
  expect(legifranceQuoteUrl('CETATEXT000007048138', 'début-fin ... suite, exacte')).toBe('https://www.legifrance.gouv.fr/ceta/id/CETATEXT000007048138/#:~:text=d%C3%A9but%2Dfin&text=suite%2C%20exacte');
  expect(legifranceQuoteUrl('https://evil.example', 'texte')).toBeNull();
  expect(legifranceQuoteUrl(undefined, 'texte')).toBeNull();
});
