/**
 * Routes de l'anonymisation, montées sous `/api/piecemaker` derrière
 * `authenticateToken`.
 *
 * `/dictionary` ne renvoie que les orthographes dont l'interface a besoin pour
 * surligner : jamais le sens nom → code, jamais les codes eux-mêmes, jamais le
 * fichier de mapping. Les noms qui en sortent sont ceux que le chat affiche
 * déjà, la route n'expose donc rien de plus que l'écran. Les variantes en font
 * partie : une même personne s'y écrit de plusieurs façons, et une orthographe
 * absente de cette liste resterait sans teinte à l'écran.
 *
 * `names` et `acronyms` sont séparés parce que le moteur de substitution les
 * traite différemment — casse ignorée pour les premiers, casse respectée pour
 * les seconds. L'interface reproduit cette règle telle quelle : le surlignage
 * doit désigner exactement ce que le proxy code.
 */
function createAnonymizerRouter({ service }) {
  const express = require('express');
  const router = express.Router();

  router.get('/anonymizer/status', (_req, res) => {
    res.json(service.status());
  });

  router.get('/anonymizer/dictionary', (_req, res) => {
    const dictionary = service.dictionary.get();
    res.json({
      version: dictionary.version,
      updatedAt: dictionary.updatedAt,
      names: dictionary.displayNames,
      acronyms: dictionary.displayAcronyms,
    });
  });

  router.post('/anonymizer/refresh', (_req, res) => {
    service.dictionary.refresh();
    res.json(service.status());
  });

  return router;
}

module.exports = { createAnonymizerRouter };
