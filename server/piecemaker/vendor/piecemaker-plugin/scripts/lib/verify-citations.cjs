'use strict';

/**
 * Vérification serveur des citations d'une annotation — recherche chaque
 * citation du modèle dans le texte source réel et signale les citations
 * fabriquées ou dérivées.
 *
 * Porté depuis `backend/src/lib/chat/verifyCitations.ts` du projet Mike —
 * logique, ordre des trois niveaux de recherche, seuils et cas limites
 * inchangés au caractère près. Seule adaptation métier : Mike vérifie une
 * citation de jurisprudence contre le texte de l'« opinion » ciblée parmi
 * plusieurs opinions d'une même décision CourtListener
 * (`getCaseOpinions(clusterId) => Promise<CaseOpinionSource[]>`). Chez nous,
 * une décision Légifrance n'a qu'un seul texte intégral : le résolveur
 * devient `getDecisionText(decisionId) => Promise<string>` et sert
 * directement de source à chaque quote, sans sélection d'opinion ni
 * concaténation (`completeCaseText` disparaît, de même que
 * `caseQuoteOpinionId`).
 */

const { normalizeWithMap } = require('./citations.cjs');

// Sentinelles de texte source renvoyées quand une pièce ou une décision ne
// peut pas être lue. À traiter comme « pas de source » pour que chaque quote
// retombe sur non-vérifiée au lieu d'un faux positif de correspondance
// littérale contre le message d'erreur. Les deux formulations de Mike sont
// gardées (au cas où un composant amont anglophone les renverrait encore) et
// complétées par leurs équivalents PieceMaker en français.
const UNREADABLE_SOURCES = new Set([
  'Document could not be read.',
  'Document not found.',
  "La pièce n'a pas pu être lue.",
  'Pièce introuvable.',
]);

// Reflète le frontend : une citation à cheval sur deux pages joint deux
// segments de page avec cette sentinelle (voir expandDocumentQuoteEntry côté
// Mike).
const PAGE_BREAK_SENTINEL = '[[PAGE_BREAK]]';
const ELLIPSIS_PATTERN = /\.{3}|…/;

// QuoteLocation: { start: number, end: number, excerpt: string }
// QuoteVerificationResult: QuoteVerification & { needs_correction: boolean }

/**
 * Localise `quote` dans `source`, en renvoyant la sous-chaîne d'origine
 * exacte (`excerpt`) et ses offsets dans `source`. Essaie des correspondances
 * de plus en plus tolérantes et renvoie la première trouvée :
 *   1. sous-chaîne exacte
 *   2. espaces + casse normalisés
 *   3. espaces + casse + ponctuation normalisés (tolérant/flou)
 * Les offsets indexent le texte source EXTRAIT, pas les octets bruts du fichier.
 */
function locateQuote(source, quote) {
  if (!source || !quote) return null;

  // Niveau 1 : exact.
  const exactIdx = source.indexOf(quote);
  if (exactIdx >= 0) {
    return { start: exactIdx, end: exactIdx + quote.length, excerpt: quote };
  }

  // Niveau 2 : espaces + casse. Niveau 3 : aussi tolérant à la ponctuation.
  return (
    locateNormalized(source, quote, {}) ??
    locateNormalized(source, quote, { stripPunctuation: true })
  );
}

function locateNormalized(source, quote, opts) {
  const { norm, origIdx } = normalizeWithMap(source, opts);
  const needle = normalizeWithMap(quote, opts).norm.trim();
  if (!needle) return null;
  const pos = norm.indexOf(needle);
  if (pos < 0) return null;
  const endNormPos = pos + needle.length;
  const start = origIdx[pos] ?? 0;
  const end =
    endNormPos - 1 < origIdx.length
      ? origIdx[endNormPos - 1] + 1
      : source.length;
  return { start, end, excerpt: source.slice(start, end) };
}

/**
 * Vérifie une citation unique du modèle contre le texte source, en renvoyant
 * l'enregistrement de vérification par quote. Les citations à cheval sur deux
 * pages et celles abrégées par `...` ou `…` sont découpées et chaque segment
 * vérifié indépendamment ; les offsets de caractères ne sont attachés que
 * pour les citations d'un seul segment contigu.
 */
function verifyQuoteAgainstSource(source, quote) {
  if (!source || UNREADABLE_SOURCES.has(source)) {
    return { verified: false, needs_correction: false };
  }

  if (quote.includes(PAGE_BREAK_SENTINEL)) {
    const segments = quote
      .split(PAGE_BREAK_SENTINEL)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (!segments.length) return { verified: false, needs_correction: false };
    const verified = segments.map((seg) =>
      verifyQuoteAgainstSource(source, seg),
    );
    if (verified.some((result) => !result.verified)) {
      return { verified: false, needs_correction: false };
    }
    return {
      verified: true,
      needs_correction: verified.some((result) => result.needs_correction),
      source_excerpt: verified
        .map((result, index) => result.source_excerpt ?? segments[index])
        .join(` ${PAGE_BREAK_SENTINEL} `),
    };
  }

  // Les visionneuses de documents traitent les points de suspension ASCII et
  // Unicode comme des séparateurs d'omission et surlignent chaque segment
  // cité indépendamment. On reproduit ce comportement ici pour qu'une
  // citation abrégée légitime ne soit pas rejetée simplement parce que du
  // texte a été volontairement omis entre ses segments littéraux.
  if (ELLIPSIS_PATTERN.test(quote)) {
    const segments = quote
      .split(ELLIPSIS_PATTERN)
      .map((segment) => segment.trim())
      // Reflète la normalisation des visionneuses : un reliquat fait de pure
      // ponctuation (par exemple le quatrième point de "....") ne forme pas
      // un segment cité.
      .filter((segment) => /[\p{L}\p{N}]/u.test(segment));
    if (!segments.length) return { verified: false, needs_correction: false };
    const located = segments.map((segment) => ({
      segment,
      location: locateQuote(source, segment),
    }));
    if (located.some(({ location }) => !location)) {
      return { verified: false, needs_correction: false };
    }
    return {
      verified: true,
      needs_correction: located.some(
        ({ segment, location }) => location.excerpt !== segment,
      ),
      source_excerpt: located
        .map(({ location }) => location.excerpt)
        .join(' ... '),
    };
  }

  const loc = locateQuote(source, quote);
  if (!loc) return { verified: false, needs_correction: false };
  return {
    verified: true,
    needs_correction: loc.excerpt !== quote,
    start_char: loc.start,
    end_char: loc.end,
    source_excerpt: loc.excerpt,
  };
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function withVerifiedDocumentQuotes(documentValue, verifiedQuotes) {
  const document = record(documentValue);
  if (!document) return undefined;
  const documentQuotes = Array.isArray(document.quotes) ? document.quotes : [];
  return {
    ...document,
    quotes: documentQuotes.map((value, index) => {
      const quote = record(value);
      const verifiedQuote = verifiedQuotes[index];
      return quote && verifiedQuote
        ? {
            ...quote,
            quote: verifiedQuote.quote,
            verification: verifiedQuote.verification,
          }
        : value;
    }),
  };
}

/**
 * Vérifie chaque quote d'une citation de jurisprudence contre le texte
 * intégral de la décision Légifrance visée par `decision_id`/`decisionId`
 * (chaîne non vide, trim appliqué). Une décision n'ayant qu'un seul texte
 * intégral, ce texte sert de source unique à toutes ses quotes — pas de
 * sélection d'opinion ni de concaténation comme chez Mike.
 */
async function verifyCaseCitationAnnotation(annotation, getDecisionText) {
  const a = record(annotation);
  if (!a || a.kind !== 'case') return annotation;
  const rawDecisionId =
    typeof a.decision_id === 'string'
      ? a.decision_id
      : typeof a.decisionId === 'string'
        ? a.decisionId
        : null;
  const decisionId = rawDecisionId ? rawDecisionId.trim() : '';
  if (!decisionId) return annotation;

  const entries = Array.isArray(a.quotes)
    ? a.quotes
        .map((value) => record(value))
        .filter((value) => !!value && typeof value.quote === 'string' && !!value.quote)
    : [];
  if (!entries.length) return annotation;

  let source;
  try {
    source = await getDecisionText(decisionId);
  } catch {
    source = '';
  }

  const verifiedQuotes = entries.map((entry) => {
    const result = verifyQuoteAgainstSource(source, entry.quote);
    const { needs_correction, ...verification } = result;
    const quote =
      needs_correction && verification.source_excerpt
        ? verification.source_excerpt
        : entry.quote;
    return { ...entry, quote, verification };
  });

  const verifiedDocument = withVerifiedDocumentQuotes(a.document, verifiedQuotes);

  return {
    ...a,
    quotes: verifiedQuotes,
    verified: verifiedQuotes.every((quote) => quote.verification.verified),
    ...(verifiedDocument ? { document: verifiedDocument } : {}),
  };
}

/**
 * Attache la vérification serveur à une annotation de citation de document.
 * Les annotations de jurisprudence sont traitées séparément par
 * `verifyCaseCitationAnnotation`. Pour les annotations de document, le texte
 * source est récupéré une seule fois via `getSourceText(doc_id)` et chaque
 * quote y est localisée ; les quotes corrigées voient l'extrait source exact
 * substitué pour que l'interface n'affiche jamais un texte dérivé.
 */
async function verifyDocumentCitationAnnotation(annotation, getSourceText) {
  if (!annotation || typeof annotation !== 'object') return annotation;
  const a = annotation;
  if (a.kind === 'case') return annotation;
  const docId = typeof a.doc_id === 'string' ? a.doc_id : null;
  if (!docId) return annotation;

  const entries = Array.isArray(a.quotes)
    ? a.quotes
    : typeof a.quote === 'string'
      ? [{ page: a.page ?? 1, quote: a.quote }]
      : [];
  if (!entries.length) return annotation;

  let source;
  try {
    source = await getSourceText(docId);
  } catch {
    source = '';
  }

  const verifiedQuotes = entries.map((entry) => {
    const result = verifyQuoteAgainstSource(source, entry.quote);
    const { needs_correction, ...verification } = result;
    // Substitue le texte source exact dans la quote affichée quand elle a
    // dérivé, pour qu'une quote dérivée ne soit jamais présentée comme les
    // mots de la source.
    const quote =
      needs_correction && verification.source_excerpt
        ? verification.source_excerpt
        : entry.quote;
    return { ...entry, quote, verification };
  });

  const verified = verifiedQuotes.every((q) => q.verification.verified);

  const verifiedDocument = withVerifiedDocumentQuotes(a.document, verifiedQuotes);

  return {
    ...a,
    quote: verifiedQuotes[0]?.quote ?? a.quote,
    quotes: verifiedQuotes,
    verified,
    ...(verifiedDocument ? { document: verifiedDocument } : {}),
  };
}

/**
 * Vérifie un lot d'annotations de citations. Les annotations de document sont
 * vérifiées contre le texte extrait des pièces, les annotations de
 * jurisprudence contre le texte intégral de la décision Légifrance visée.
 * Les appelants doivent fournir les deux résolveurs pour qu'aucun type de
 * citation ne puisse contourner la vérification.
 */
async function verifyCitations(annotations, getSourceText, getDecisionText) {
  return Promise.all(
    annotations.map((annotation) => {
      const value = record(annotation);
      return value?.kind === 'case'
        ? verifyCaseCitationAnnotation(annotation, getDecisionText)
        : verifyDocumentCitationAnnotation(annotation, getSourceText);
    }),
  );
}

module.exports = {
  UNREADABLE_SOURCES,
  locateQuote,
  verifyQuoteAgainstSource,
  verifyCaseCitationAnnotation,
  verifyDocumentCitationAnnotation,
  verifyCitations,
};
