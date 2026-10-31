'use strict';

const ANCHOR_RE = /TEXTE INTÉGRAL\s*:/;
const SEPARATOR_LINE_RE = /^=+[ \t]*$/m;
const LIEN_LINE_RE = /^Lien\s*:.*$/m;
const TITRE_LINE_RE = /^D\u00c9CISION\s*:[ \t]*(.+)$/m;
const ARTICLE_NUM_RE = /^\*\*(.+?)\*\*[ \t]*$/m;
const ARTICLE_CODE_RE = /^Code\s*:[ \t]*(.+)$/m;
const ARTICLE_ID_LINE_RE = /^Identifiant\s*:[ \t]*(.+)$/m;
const MAX_TITRE_LENGTH = 300;

/**
 * Extrait le texte intégral encadré par le second séparateur `=` (celui qui
 * suit la ligne `TEXTE INTÉGRAL:`) jusqu'à la ligne `Lien:` finale (exclue),
 * trimé. Si l'ancre `TEXTE INTÉGRAL:` est absente, conserve le texte complet
 * reçu tel quel — une source plus large qu'aucune source, la vérification
 * reste exacte dans les deux cas.
 */
function extractFullText(raw) {
  if (typeof raw !== 'string' || !raw) return '';

  const anchorMatch = ANCHOR_RE.exec(raw);
  if (!anchorMatch) return raw;

  const afterAnchor = raw.slice(anchorMatch.index + anchorMatch[0].length);
  const sepMatch = SEPARATOR_LINE_RE.exec(afterAnchor);
  if (!sepMatch) return raw;

  let body = afterAnchor.slice(sepMatch.index + sepMatch[0].length);
  const lienMatch = LIEN_LINE_RE.exec(body);
  if (lienMatch) body = body.slice(0, lienMatch.index);

  return body.trim();
}

/**
 * Renvoie le titre lisible d'un article de code (« Code civil, article 1103 »)
 * à partir de l'entête de `consulter_article` : la ligne `**<num>**`, la
 * ligne `Code:` et la ligne `Identifiant:` qui atteste de cette forme.
 * Chaîne vide si l'entête n'est pas celui d'un article.
 */
function extractArticleTitle(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  const header = raw.slice(0, 2000);
  if (!ARTICLE_ID_LINE_RE.test(header)) return '';
  const numero = ARTICLE_NUM_RE.exec(header)?.[1].trim();
  if (!numero) return '';
  const code = ARTICLE_CODE_RE.exec(header)?.[1].trim();
  const article = /^article\b/i.test(numero) ? numero : `article ${numero}`;
  return (code ? `${code}, ${article}` : article.charAt(0).toUpperCase() + article.slice(1)).slice(0, MAX_TITRE_LENGTH);
}

/**
 * Titre lisible d'une source Légifrance, quelle que soit sa nature : décision
 * (`consulter_decision`) ou article de code (`consulter_article`).
 */
function extractSourceTitle(raw) {
  return extractDecisionTitle(raw) || extractArticleTitle(raw);
}

/**
 * Renvoie le titre lisible de la décision (« Cour de cassation, civile,
 * Chambre commerciale, 23 janvier 2016, … ») porté par la ligne `DÉCISION:`
 * en tête du résultat d'outil, avant la bannière `TEXTE INTÉGRAL:`.
 * Chaîne vide si l'entête est absent : l'appelant retombe sur l'identifiant.
 */
function extractDecisionTitle(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  const anchorMatch = ANCHOR_RE.exec(raw);
  const header = anchorMatch ? raw.slice(0, anchorMatch.index) : raw;
  const match = TITRE_LINE_RE.exec(header);
  if (!match) return '';
  return match[1].trim().slice(0, MAX_TITRE_LENGTH);
}

module.exports = {
  extractFullText,
  extractDecisionTitle,
  extractArticleTitle,
  extractSourceTitle,
};
