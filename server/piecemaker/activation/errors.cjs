'use strict';

/**
 * Erreur porteuse d'un statut HTTP, pour que les routes n'aient qu'à la
 * relayer telle quelle sans deviner un code au moment de répondre.
 */
class ActivationError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ActivationError';
    this.status = status;
  }
}

module.exports = { ActivationError };
