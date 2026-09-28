/**
 * Surface des commandes du binaire `piecemaker`.
 *
 * Isolée dans son propre module parce que `installer/bin/piecemaker.mjs`
 * lance `main()` dès son import : rien ne peut l'importer sans ouvrir le menu
 * interactif et donc toucher aux services réels de la machine. Ce module-ci
 * est importable sans effet de bord.
 */

export const COMMANDS = new Set(['conversion', 'install', 'doctor', 'check', 'update']);
