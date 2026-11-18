export { sourceContext } from '../../../shared/piecemaker/catala-sources.js';

export function logicalText(text: string) {
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  return (text.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:et|ou|and|or)\b|[^"']+?(?=\b(?:et|ou|and|or)\b|["']|$)|./gs) ?? []).map((token) => /^(?:et|ou|and|or)$/.test(token) ? `<span class="pmc-logic-pill" data-operator="${token === 'and' ? 'et' : token === 'or' ? 'ou' : token}">${token === 'and' ? 'et' : token === 'or' ? 'ou' : token}</span>` : escape(token)).join('');
}
