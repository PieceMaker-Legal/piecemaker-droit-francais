'use strict';

/**
 * Analyse et normalisation des citations du bloc `<CITATIONS>` produit par le
 * modèle, plus le normaliseur de texte tolérant aux espaces/casse utilisé par
 * la vérification (`verify-citations.cjs`).
 *
 * Porté depuis `backend/src/lib/chat/citations.ts` et
 * `backend/src/lib/chat/tools/documentOps.ts` du projet Mike — logique,
 * ordre des tests et seuils inchangés au caractère près. Seule adaptation
 * métier : Mike identifie une décision par `cluster_id` (entier
 * CourtListener) et un passage par `opinion_id` ; chez nous la source est
 * Légifrance, dont l'identifiant de décision est une CHAÎNE
 * (« JURITEXT000012345678 », « CETATEXT… »). Le champ `cluster_id`/`clusterId`
 * devient donc `decision_id`/`decisionId` (chaîne non vide, trim appliqué,
 * acceptée dans les deux graphies), et `opinion_id` disparaît des citations
 * de jurisprudence : une décision Légifrance n'a qu'un seul texte intégral,
 * il n'y a donc rien à distinguer entre plusieurs opinions. `type` et
 * `author` sont conservés quand ils sont fournis (inoffensifs). La branche
 * « document » (doc_id, page, quotes, sheet/cell, [[PAGE_BREAK]]) est
 * recopiée intégralement : elle sert pour les pièces du dossier.
 *
 * `createCitation` de Mike n'est PAS porté : il dépend de sa base Supabase
 * (docIndex, docStore, casesByClusterId), hors sujet ici.
 */

// ---------------------------------------------------------------------------
// Types internes de parsing des citations (documentés en commentaire, JS pur)
// ---------------------------------------------------------------------------

// DocumentQuote: { page: number|string, quote: string, sheet?: string, cell?: string }
// ParsedDocumentCitation: { kind: 'document', ref, doc_id, page, quote, sheet?, cell?, quotes }
// ParsedCaseCitation: { kind: 'case', ref, decision_id, quotes: { type, author, quote }[] }

function normalizeCitation(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw;
  const markerRef =
    typeof c.marker === 'string'
      ? Number((c.marker.match(/^\[(\d+)\]$/) || [])[1])
      : NaN;
  const ref =
    typeof c.ref === 'number'
      ? c.ref
      : Number.isFinite(markerRef)
        ? markerRef
        : null;
  if (typeof ref !== 'number') return null;
  const quote = typeof c.quote === 'string' ? c.quote : c.text;

  const rawDecisionId =
    typeof c.decision_id === 'string'
      ? c.decision_id
      : typeof c.decisionId === 'string'
        ? c.decisionId
        : null;
  const decisionId = rawDecisionId ? rawDecisionId.trim() : '';
  if (decisionId) {
    const quotes = normalizeCaseCitationQuotes(c);
    if (!quotes.length) {
      if (typeof quote !== 'string' || !quote) return null;
      quotes.push({ type: null, author: null, quote });
    }
    return { kind: 'case', ref, decision_id: decisionId, quotes };
  }

  if (typeof c.doc_id !== 'string') return null;
  const quotes = normalizeDocumentCitationQuotes(c);
  if (!quotes.length) {
    if (typeof quote !== 'string' || !quote) return null;
    quotes.push({
      page: normalizeCitationPage(c.page),
      quote,
      ...normalizeCellLocator(c),
    });
  }
  return {
    kind: 'document',
    ref,
    doc_id: c.doc_id,
    page: quotes[0].page,
    quote: quotes[0].quote,
    sheet: quotes[0].sheet,
    cell: quotes[0].cell,
    quotes,
  };
}

/** Extrait un éventuel repère tableur `{sheet, cell}` d'un objet brut. */
function normalizeCellLocator(c) {
  const out = {};
  if (typeof c.sheet === 'string' && c.sheet.trim()) out.sheet = c.sheet.trim();
  if (typeof c.cell === 'string' && c.cell.trim()) out.cell = c.cell.trim();
  return out;
}

function normalizeCitationPage(value) {
  if (typeof value === 'number') {
    return value;
  } else if (typeof value === 'string' && /^\d+\s*-\s*\d+$/.test(value)) {
    return value;
  } else {
    const n = parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(n)) return 1;
    return n;
  }
}

function normalizeDocumentCitationQuotes(c) {
  if (!Array.isArray(c.quotes)) return [];
  return c.quotes
    .slice(0, 3)
    .map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const row = raw;
      const text = typeof row.quote === 'string' ? row.quote : row.text;
      if (typeof text !== 'string' || !text.trim()) return null;
      // Retombe sur le sheet/cell de premier niveau pour qu'une citation
      // puisse les fixer une seule fois.
      return {
        page: normalizeCitationPage(row.page ?? c.page),
        quote: text,
        ...normalizeCellLocator({
          sheet: row.sheet ?? c.sheet,
          cell: row.cell ?? c.cell,
        }),
      };
    })
    .filter((quote) => !!quote);
}

function normalizeCaseCitationQuotes(c) {
  if (!Array.isArray(c.quotes)) return [];
  return c.quotes
    .slice(0, 3)
    .map((raw) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const row = raw;
      const text = typeof row.quote === 'string' ? row.quote : row.text;
      if (typeof text !== 'string' || !text.trim()) return null;
      return {
        type: typeof row.type === 'string' ? row.type : null,
        author: typeof row.author === 'string' ? row.author : null,
        quote: text,
      };
    })
    .filter((quote) => !!quote);
}

// ---------------------------------------------------------------------------
// Constantes et parseurs du bloc de citations
// ---------------------------------------------------------------------------

const CITATIONS_BLOCK_RE = /<CITATIONS>\s*([\s\S]*?)\s*<\/CITATIONS>/;
const CITATIONS_OPEN_TAG = '<CITATIONS>';
const CITATIONS_CLOSE_TAG = '</CITATIONS>';

// CitationParseDiagnostics: { hasBlock: boolean, rawLength: number, error: string|null }

function parseCitationsWithDiagnostics(text) {
  const match = text.match(CITATIONS_BLOCK_RE);
  if (!match) {
    return { citations: [], diagnostics: { hasBlock: false, rawLength: 0, error: null } };
  }
  const raw = match[1] ?? '';
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return {
        citations: [],
        diagnostics: { hasBlock: true, rawLength: raw.length, error: 'Le bloc CITATIONS ne contenait pas un tableau JSON.' },
      };
    }
    return {
      citations: parsed.map(normalizeCitation).filter((c) => c !== null),
      diagnostics: { hasBlock: true, rawLength: raw.length, error: null },
    };
  } catch (error) {
    return {
      citations: [],
      diagnostics: {
        hasBlock: true,
        rawLength: raw.length,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function parseCitations(text) {
  return parseCitationsWithDiagnostics(text).citations;
}

function parsePartialCitationObjects(text) {
  const beforeClose = text.split(CITATIONS_CLOSE_TAG)[0] ?? text;
  const arrayStart = beforeClose.indexOf('[');
  if (arrayStart < 0) return [];

  const parsed = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let objectStart = -1;

  for (let i = arrayStart + 1; i < beforeClose.length; i += 1) {
    const char = beforeClose[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\') { escaped = inString; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') {
      if (depth === 0) objectStart = i;
      depth += 1;
    } else if (char === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        try {
          const raw = JSON.parse(beforeClose.slice(objectStart, i + 1));
          const citation = normalizeCitation(raw);
          if (citation) parsed.push(citation);
        } catch { /* ignore objet partiel/malformé */ }
        objectStart = -1;
      }
    } else if (char === ']' && depth === 0) {
      break;
    }
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// normalizeWithMap — porté depuis documentOps.ts (Mike), inchangé
// ---------------------------------------------------------------------------

function isPunctuation(ch) {
  return !/[\p{L}\p{N}\s]/u.test(ch);
}

/**
 * Construit une copie de `text` aux espaces réduits et en minuscules, plus une
 * table faisant correspondre chaque index de la forme normalisée à l'index
 * correspondant dans le texte d'origine. Utilisé par la vérification de
 * citations pour que les correspondances tolèrent les écarts de casse et
 * d'espacement tout en renvoyant l'extrait original exact.
 *
 * Avec `stripPunctuation`, les caractères de ponctuation sont aussi retirés
 * de la forme normalisée, ce qui tolère un écart de ponctuation (par exemple
 * une virgule ajoutée ou un point supprimé par le modèle). La table d'index
 * continue de pointer vers les caractères d'origine survivants, donc
 * l'extrait récupéré reste exact.
 */
function normalizeWithMap(text, opts = {}) {
  const stripPunctuation = opts.stripPunctuation ?? false;
  const norm = [];
  const origIdx = [];
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        norm.push(' ');
        origIdx.push(i);
        prevSpace = true;
      }
    } else if (stripPunctuation && isPunctuation(ch)) {
      // Ignore la ponctuation sans perturber l'état de fusion des espaces,
      // donc "foo, bar" -> "foo bar" mais "U.S." -> "us".
      continue;
    } else {
      norm.push(ch.toLowerCase());
      origIdx.push(i);
      prevSpace = false;
    }
  }
  return { norm: norm.join(''), origIdx };
}

module.exports = {
  normalizeCitation,
  normalizeCitationPage,
  normalizeDocumentCitationQuotes,
  normalizeCaseCitationQuotes,
  normalizeCellLocator,
  CITATIONS_BLOCK_RE,
  CITATIONS_OPEN_TAG,
  CITATIONS_CLOSE_TAG,
  parseCitationsWithDiagnostics,
  parseCitations,
  parsePartialCitationObjects,
  normalizeWithMap,
};
