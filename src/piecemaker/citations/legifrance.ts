export function legifranceQuoteUrl(decisionId: string | undefined, quote: string | undefined) {
  if (!decisionId || !/^(JURITEXT|CETATEXT|LEGIARTI)\d{12}$/.test(decisionId)) return null;
  const url = decisionId.startsWith('LEGIARTI')
    ? `https://www.legifrance.gouv.fr/codes/article_lc/${decisionId}/`
    : `https://www.legifrance.gouv.fr/${decisionId.startsWith('CETATEXT') ? 'ceta' : 'juri'}/id/${decisionId}/`;
  const segments = (quote ?? '').split(/\[\[PAGE_BREAK\]\]|\.{3}|…/).map((part) => part.trim()).filter(Boolean);
  const fragment = segments.map((segment) => `text=${encodeURIComponent(segment).replace(/-/g, '%2D')}`).join('&');
  return fragment ? `${url}#:~:${fragment}` : url;
}
