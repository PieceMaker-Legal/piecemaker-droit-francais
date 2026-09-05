'use strict';

/**
 * Vérification mécanique des citations d'un tour de chat — équivalent
 * serveur du hook Stop `verify-citations.mjs` de l'autre dépôt
 * (`piecemaker-plugin/scripts/verify-citations.mjs`).
 *
 * Ce dépôt n'a pas de hook Claude Code : tout le trafic IA passe par le
 * proxy PII local (`server/piecemaker/anonymizer/proxy.cjs`), qui est donc
 * l'unique point d'observation possible pour un texte produit par le modèle.
 * Contrairement au hook d'origine, ce module n'a pas le pouvoir de bloquer
 * un tour (il n'y a pas de conversation Claude Code à interrompre côté
 * proxy) : il se contente d'observer, de vérifier mécaniquement et de
 * journaliser — le blocage éventuel reste une décision de l'appelant
 * (câblage laissé à une tâche ultérieure).
 *
 * Enchaînement, fidèle à Mike et au hook d'origine : détection du bloc
 * `<CITATIONS>` (cas de très loin le plus fréquent : absent, silence total)
 * → parse (`citations.cjs`) → résolution des sources (`citation-sources.cjs`,
 * décisions Légifrance + pièces du dossier) → vérification mécanique
 * (`verify-citations.cjs`) → journalisation dans
 * `<homeDir>/citations-verifiees.jsonl`.
 *
 * Garantie de confidentialité : le journal ne contient JAMAIS le texte d'une
 * citation ni celui d'une source — seulement des identifiants et un motif
 * d'échec parmi trois valeurs fixes (« source inconnue », « source
 * illisible », « introuvable dans la source »).
 *
 * Ne jette jamais : toute erreur inattendue (bloc malformé compris) retombe
 * sur `{ analysee: false, citations: 0, nonVerifiees: 0, details: [] }`.
 */

const fs = require('node:fs');
const path = require('node:path');

const { parseCitationsWithDiagnostics } = require('../vendor/piecemaker-plugin/scripts/lib/citations.cjs');
const { verifyCitations, UNREADABLE_SOURCES } = require('../vendor/piecemaker-plugin/scripts/lib/verify-citations.cjs');
const {
  createDecisionTextResolver,
  createDocumentTextResolver,
} = require('../vendor/piecemaker-plugin/scripts/lib/citation-sources.cjs');

const LOG_FILE_NAME = 'citations-verifiees.jsonl';

function emptyResult() {
  return { analysee: false, citations: 0, nonVerifiees: 0, details: [] };
}

/** mkdir -p qui ne jette jamais. */
function ensureDirSafe(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/** Identifiant lisible d'une citation pour le journal. */
function citationIdentifier(citation) {
  if (citation?.kind === 'case') return `decision:${citation.decision_id ?? '?'}#${citation.ref ?? '?'}`;
  return `document:${citation?.doc_id ?? '?'}#${citation?.ref ?? '?'}`;
}

/**
 * Reclasse l'échec d'une citation en rappelant la source qui a servi (ou pas)
 * à sa vérification — jamais un LLM, purement mécanique. Trois motifs, sans
 * jamais exposer de texte : source inconnue (résolveur vide : identifiant
 * introuvable), source illisible (sentinelle `UNREADABLE_SOURCES`), ou
 * introuvable dans la source (la source existe mais ne contient pas la
 * citation, même tolérante aux espaces/casse/ponctuation).
 */
async function classifyFailureReason(citation, getSourceText, getDecisionText) {
  let source = '';
  try {
    source = citation.kind === 'case'
      ? await getDecisionText(citation.decision_id)
      : await getSourceText(citation.doc_id);
  } catch {
    source = '';
  }
  const text = typeof source === 'string' ? source : '';
  if (!text) return 'source inconnue';
  if (UNREADABLE_SOURCES.has(text)) return 'source illisible';
  return 'introuvable dans la source';
}

/** Journalise une ligne — jamais de texte de citation ni de source. */
function logVerification(homeDir, entry) {
  if (typeof homeDir !== 'string' || !homeDir) return;
  try {
    ensureDirSafe(homeDir);
    fs.appendFileSync(path.join(homeDir, LOG_FILE_NAME), `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    // Une panne du journal ne doit jamais faire échouer la vérification.
  }
}

/**
 * Vérifie les citations du bloc `<CITATIONS>` d'un message d'assistant.
 *
 * @param {string} texteAssistant Dernier message produit par le modèle.
 * @param {object} [options]
 * @param {string} [options.homeDir] Dossier où journaliser (`~/.piecemaker` typiquement).
 * @param {string|null} [options.session] Identifiant d'session, purement informatif.
 * @param {{getDecisionText: Function, getSourceText: Function}} [options.resolvers]
 *   Résolveurs de source injectables (tests) ; par défaut, ceux de
 *   `citation-sources.cjs` sur le répertoire courant.
 * @returns {Promise<{analysee: boolean, citations: number, nonVerifiees: number, details: Array}>}
 */
async function verifierReponse(texteAssistant, options = {}) {
  try {
    if (typeof texteAssistant !== 'string' || !texteAssistant) return emptyResult();

    const { citations, diagnostics } = parseCitationsWithDiagnostics(texteAssistant);
    if (!diagnostics.hasBlock) return emptyResult(); // cas de très loin le plus fréquent

    const { homeDir, session, resolvers } = options;
    const getDecisionText = resolvers?.getDecisionText || createDecisionTextResolver([process.cwd()]);
    const getSourceText = resolvers?.getSourceText || createDocumentTextResolver(process.cwd());

    let verified = [];
    try {
      verified = await verifyCitations(citations, getSourceText, getDecisionText);
    } catch {
      verified = [];
    }

    const details = [];
    let nonVerifiees = 0;
    for (const citation of verified) {
      const id = citationIdentifier(citation);
      if (citation?.verified === false) {
        nonVerifiees += 1;
        const motif = await classifyFailureReason(citation, getSourceText, getDecisionText);
        details.push({ id, verified: false, motif });
      } else {
        details.push({ id, verified: true, motif: null });
      }
    }

    logVerification(homeDir, {
      session_id: session || null,
      at: new Date().toISOString(),
      citations: verified.length,
      non_verifiees: nonVerifiees,
      details,
    });

    return { analysee: true, citations: verified.length, nonVerifiees, details };
  } catch {
    return emptyResult();
  }
}

module.exports = {
  LOG_FILE_NAME,
  verifierReponse,
};
