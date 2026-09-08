// Façade PieceMaker : assemble en un seul routeur Express les modules de
// `server/piecemaker/vendor/`, pour être monté sur le serveur CloudCLI sous
// `/api/piecemaker`.
//
// `vendor/` appartient à ce dépôt et s'y modifie comme le reste du code. Le nom
// et l'arborescence `websocket-server/` + `piecemaker-plugin/` sont conservés
// parce que les `require` internes en dépendent, pas parce qu'une source
// extérieure ferait autorité. Ce fichier est le seul point d'entrée ; rien
// d'autre ne doit require `vendor/` directement.
const os = require('os');
const path = require('path');

const VENDOR_ROOT = path.join(__dirname, 'vendor');

const { createAnonymizerRouter } = require('./anonymizer/routes.cjs');
const { createAnonymizerService } = require('./anonymizer/service.cjs');
const { createAdminRouter, registerLegalCase } = require('./vendor/websocket-server/admin-routes.cjs');
const { readRegistryConfig, resolveCaseReference } = require('./vendor/websocket-server/case-registry.cjs');
const protectionLibrary = require('./vendor/piecemaker-plugin/scripts/lib/protection.cjs');
const { createProtectionBypassRouter } = require('./protection/routes.cjs');
const { createActivationRouter } = require('./activation/index.cjs');
const { createMikeRouter } = require('./mike/routes.cjs');
const { createStampingRouter } = require('./vendor/websocket-server/stamping-routes.cjs');
const { findSoffice } = require('./vendor/websocket-server/lib/office-to-pdf.cjs');

/**
 * État du serveur hôte affiché par la carte des composants. Il est calculé ici
 * plutôt que dans `server/index.ts` pour que le montage côté CloudCLI tienne en
 * une ligne.
 */
function defaultRuntimeStatus() {
  let libreOffice = false;
  try {
    libreOffice = Boolean(findSoffice());
  } catch {
    // LibreOffice est optionnel : sans lui, seuls les PDF et les images se tamponnent.
  }
  return {
    port: Number(process.env.SERVER_PORT || process.env.PORT) || undefined,
    host: process.env.HOST || undefined,
    libreOffice,
    terminalReady: true,
  };
}

/** Racine des données PieceMaker, partagée avec l'installateur historique. */
function piecemakerHome() {
  return process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker');
}

/**
 * @param {object} [options]
 * @param {() => object} [options.getRuntimeStatus] Ce que la carte des composants
 *   affiche du serveur hôte (port, hôte, dépendances système).
 */
function createPieceMakerRouter({ getRuntimeStatus = defaultRuntimeStatus, anonymizer: applicationAnonymizer } = {}) {
  const express = require('express');
  const router = express.Router();

  const homeDir = piecemakerHome();

  // Le montage se fait derrière `authenticateToken` : la restriction d'origine
  // du panneau d'administration autonome ferait double emploi et casserait
  // l'app de bureau (origine `file://`) comme l'accès depuis le réseau local.
  router.post('/repository/cases/selected', async (request, response) => {
    try {
      const result = await registerLegalCase({
        folder: request.body?.folder,
        configFile: path.join(homeDir, 'config.json'),
        repoRoot: VENDOR_ROOT,
        homeDir,
        userHome: os.homedir(),
      });
      response.status(201).json({ ok: true, ...result });
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  // Levée de protection à l'échelle du dossier : ajout PieceMaker monté avant
  // le vendor, qui n'expose que le classement pièce par pièce.
  router.use(createProtectionBypassRouter({
    resolveCase: (reference) => resolveCaseReference(readRegistryConfig(path.join(homeDir, 'config.json')), reference),
    protection: protectionLibrary,
  }));

  router.use(createActivationRouter({
    repoRoot: VENDOR_ROOT,
    piecemakerHome: homeDir,
    userHome: os.homedir(),
  }));

  router.use(createMikeRouter({ applicationRoot: path.resolve(__dirname, '../..'), homeDir }));

  router.use(createAdminRouter({
    repoRoot: VENDOR_ROOT,
    homeDir,
    userHome: os.homedir(),
    getRuntimeStatus,
    isOriginAllowed: () => true,
  }));

  router.use(createStampingRouter({ homeDir }));

  const anonymizer = applicationAnonymizer || createAnonymizerService({ homeDir });
  if (!applicationAnonymizer) void anonymizer.start();
  router.use(createAnonymizerRouter({ service: anonymizer }));

  return router;
}

module.exports = { createPieceMakerRouter, piecemakerHome, VENDOR_ROOT };
