'use strict';

/**
 * Façade du harnais de citations vérifiées, à brancher sur le proxy PII
 * local (`server/piecemaker/anonymizer/proxy.cjs`) — câblage laissé à une
 * tâche ultérieure, ce module ne modifie rien de `proxy.cjs`.
 *
 * Deux observateurs, symétriques au sens et au retour du proxy lui-même :
 *  - `observerRequete` regarde ce qui PART vers le fournisseur (avant
 *    anonymisation) pour y capter une éventuelle lecture de décision
 *    Légifrance via `consulter_decision` (`decisions.cjs`).
 *  - `observerReponse` regarde le dernier message produit par le modèle
 *    (après dé-anonymisation) pour y vérifier mécaniquement un éventuel bloc
 *    `<CITATIONS>` (`verification.cjs`).
 *
 * Les deux ne jettent jamais : une erreur d'observation ne doit jamais faire
 * échouer une requête ou une réponse qui, elle, doit continuer son chemin.
 *
 * Interrupteur `PIECEMAKER_CITATIONS=off` : les deux observateurs deviennent
 * des no-op, à l'image de `PIECEMAKER_CITATIONS_VERIFY=off` dans l'autre
 * dépôt (hook `verify-citations.mjs`).
 */

const path = require('node:path');

const { captureDecisions } = require('./decisions.cjs');
const { verifierReponse } = require('./verification.cjs');

function isJsonLike(contentType) {
  return /\bjson\b/i.test(String(contentType || ''));
}

function parseJsonBody(body) {
  if (body === null || body === undefined) return null;
  const text = typeof body === 'string' ? body : body.toString('utf8');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isOff() {
  return process.env.PIECEMAKER_CITATIONS === 'off';
}

function emptyVerification() {
  return { analysee: false, citations: 0, nonVerifiees: 0, details: [] };
}

/**
 * @param {object} options
 * @param {string} options.homeDir Dossier PieceMaker (`~/.piecemaker` en
 *   production) — les décisions vont dans `<homeDir>/decisions/`, le journal
 *   de vérification dans `<homeDir>/citations-verifiees.jsonl`.
 */
function createHarnessJuridique({ homeDir, verifyResponses = true } = {}) {
  const decisionsDir = typeof homeDir === 'string' && homeDir ? path.join(homeDir, 'decisions') : null;
  const stats = { decisions: 0, tours: 0, nonVerifiees: 0 };

  return {
    stats,

    /**
     * N'agit que sur un corps JSON. Renvoie le nombre de décisions capturées
     * (0 si l'interrupteur est coupé, si le content-type n'est pas JSON, si
     * le corps ne s'analyse pas, ou en cas d'erreur quelconque).
     */
    observerRequete(body, contentType, { session } = {}) {
      try {
        if (isOff() || !decisionsDir || !isJsonLike(contentType)) return 0;
        const payload = parseJsonBody(body);
        if (!payload) return 0;
        const count = captureDecisions(payload, { decisionsDir, session });
        stats.decisions += count;
        return count;
      } catch {
        return 0;
      }
    },

    /**
     * Vérifie le dernier message du modèle. Renvoie toujours la forme de
     * `verifierReponse`, jamais une exception.
     */
    async observerReponse(texteAssistant, { session } = {}) {
      try {
        if (isOff() || !verifyResponses) return emptyVerification();
        const result = await verifierReponse(texteAssistant, { homeDir, session });
        if (result?.analysee) {
          stats.tours += 1;
          stats.nonVerifiees += result.nonVerifiees;
        }
        return result;
      } catch {
        return emptyVerification();
      }
    },
  };
}

module.exports = { createHarnessJuridique };
