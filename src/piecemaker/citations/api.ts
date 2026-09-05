import { authenticatedFetch } from '@/shared/api';

type CitationSource = {
  title: string;
  source: string;
  sourceOrigin?: 'decision-cache';
  citation: {
    ref: number;
    decision_id?: string;
    verified?: boolean;
    quotes: Array<{
      quote: string;
      page?: number | string;
      sheet?: string;
      cell?: string;
      verification?: { verified: boolean };
    }>;
  };
  ranges: Array<{ start: number; end: number; quoteIndex: number }>;
};

export async function fetchCitationSource(token: string, signal: AbortSignal): Promise<CitationSource> {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('Référence de citation invalide.');
  const response = await authenticatedFetch(`/api/piecemaker/citations/${token}`, { signal });
  if (!response.ok) throw new Error('La source de cette citation est indisponible.');
  return response.json();
}
