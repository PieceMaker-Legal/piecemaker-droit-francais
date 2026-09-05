export function legifranceQuoteUrl(decisionId: string | undefined, quote: string | undefined) {
  if (!decisionId || !/^(JURITEXT|CETATEXT)\d{12}$/.test(decisionId)) return null;
  const category = decisionId.startsWith('CETATEXT') ? 'ceta' : 'juri';
  const url = `https://www.legifrance.gouv.fr/${category}/id/${decisionId}/`;
  const segments = (quote ?? '').split(/\[\[PAGE_BREAK\]\]|\.{3}|…/).map((part) => part.trim()).filter(Boolean);
  const fragment = segments.map((segment) => `text=${encodeURIComponent(segment).replace(/-/g, '%2D')}`).join('&');
  return fragment ? `${url}#:~:${fragment}` : url;
}
