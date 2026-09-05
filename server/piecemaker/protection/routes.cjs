/**
 * Routes de la levée de protection, montées avant le routeur vendorisé pour
 * qu'aucune ligne de `admin-routes.cjs` n'ait à bouger. Le résolveur de dossier
 * et la bibliothèque de protection sont injectés par `router.cjs`.
 */
const { activateBypass, bypassState, deactivateBypass } = require('./bypass.cjs');

function createProtectionBypassRouter({ resolveCase, protection }) {
  const express = require('express');
  const router = express.Router();

  router.get('/protection/bypass', (request, response) => {
    try {
      const legalCase = resolveCase(request.query.case);
      response.json({ case: legalCase.id, ...bypassState(legalCase.root, protection) });
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  router.put('/protection/bypass', (request, response) => {
    try {
      if (typeof request.body?.active !== 'boolean') {
        throw new Error('« active » doit indiquer si la protection du dossier est levée.');
      }
      const legalCase = resolveCase(request.body.case);
      const state = request.body.active
        ? activateBypass(legalCase.root, protection)
        : deactivateBypass(legalCase.root, protection);
      response.json({ ok: true, case: legalCase.id, ...state });
    } catch (error) {
      response.status(400).json({ error: error.message });
    }
  });

  return router;
}

module.exports = { createProtectionBypassRouter };
