// Façade PieceMaker : assemble en un seul routeur Express les modules repris de
// PieceMaker-Installer (`server/piecemaker/vendor/`), pour être monté sur le
// serveur CloudCLI sous `/api/piecemaker`.
//
// `vendor/` est une copie mécanique du dépôt PieceMaker-Installer : l'arbre
// `websocket-server/` + `piecemaker-plugin/` + `installer/` est préservé, si
// bien qu'aucun `require` interne n'a eu à être réécrit. Ce fichier est le seul
// point d'entrée ; rien d'autre ne doit require `vendor/` directement.
const os = require('os');
const path = require('path');

const VENDOR_ROOT = path.join(__dirname, 'vendor');

const { createAnonymizerRouter } = require('./anonymizer/routes.cjs');
const { createAnonymizerService } = require('./anonymizer/service.cjs');
const { createAdminRouter, registerLegalCase } = require('./vendor/websocket-server/admin-routes.cjs');
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
function createPieceMakerRouter({ getRuntimeStatus = defaultRuntimeStatus } = {}) {
  const express = require('express');
  const router = express.Router();

  const homeDir = piecemakerHome();

  // Le montage se fait derrière `authenticateToken` : la restriction d'origine
  // du panneau d'administration autonome ferait double emploi et casserait
  // l'app de bureau (origine `file://`) comme l'accès depuis le réseau local.
  // LiteLLM est remplacé par le proxy PII local, et les deux se disputeraient les
  // mêmes blocs de configuration (`piecemaker_litellm` dans settings.json et
  // config.toml) sur deux ports différents. L'interface n'offre pas cette
  // installation, mais la route vendorisée l'accepte encore : on la ferme ici
  // plutôt que d'éditer le vendor, qui doit rester une copie mécanique.
  router.post('/configuration/install', (request, response, next) => {
    if (request.body?.component !== 'litellm') return next();
    response.status(409).json({
      error: 'LiteLLM est remplacé par le proxy d’anonymisation intégré, déjà actif. '
        + 'L’installer réécrirait la configuration des clients vers un autre port.',
    });
  });

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

  router.use(createAdminRouter({
    repoRoot: VENDOR_ROOT,
    homeDir,
    userHome: os.homedir(),
    getRuntimeStatus,
    isOriginAllowed: () => true,
  }));

  router.use(createStampingRouter({ homeDir }));

  // Le proxy PII remplace LiteLLM : il pose `ANTHROPIC_BASE_URL` dans
  // l'environnement du serveur, dont héritent le chat et le terminal lancés par
  // CloudCLI. Démarré ici, il vit et meurt avec le serveur hôte. L'écoute est
  // asynchrone mais gagne largement la course : aucun client IA n'est lancé
  // avant le premier message de l'utilisateur.
  const anonymizer = createAnonymizerService({ homeDir });
  void anonymizer.start();
  router.use(createAnonymizerRouter({ service: anonymizer }));

  return router;
}

module.exports = { createPieceMakerRouter, piecemakerHome, VENDOR_ROOT };
