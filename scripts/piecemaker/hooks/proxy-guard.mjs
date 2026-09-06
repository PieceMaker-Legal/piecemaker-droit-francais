#!/usr/bin/env node
/**
 * Hook SessionStart — garde-fou contre le port mort du proxy PII.
 *
 * Le proxy de ce dépôt (server/piecemaker/anonymizer/proxy.cjs, démarré par
 * service.cjs) écoute un port fixe et vit avec le process serveur. Il meurt
 * avec lui, mais la configuration qu'il a écrite survit sur disque : une
 * session démarrée serveur éteint pointe alors vers un port fermé en boucle,
 * sans pouvoir se corriger elle-même en cours de route.
 *
 * Ce hook sert deux clients, distingués par la variable d'environnement
 * PIECEMAKER_HOOK_CLIENT :
 *   - claude (valeur par défaut) : la base vient de ~/.claude/settings.json
 *     → env.ANTHROPIC_BASE_URL, pathname attendu /anthropic. Nettoyage via
 *     bypassClaudeCodeProxy() (server/piecemaker/anonymizer/client-config.cjs).
 *   - codex : la base vient de ~/.codex/config.toml (ou $CODEX_HOME), dans
 *     le bloc géré délimité par les marqueurs PieceMaker Proxy PII, table
 *     [model_providers.piecemaker_proxy], pathname attendu /chatgpt.
 *     Nettoyage via bypassCodexProxy() du même module.
 *
 * Il sonde le port concerné, et si le proxy est bien mort retire l'entrée
 * périmée pour laisser la session démarrer en accès direct plutôt qu'en
 * échec de connexion permanent. Fail-open strict : aucune exception ne doit
 * empêcher le démarrage de la session.
 *
 * Verdicts possibles, journalisés dans ~/.piecemaker/proxy-guard.log :
 *   - direct  : aucune base configurée, la session n'est pas anonymisée.
 *   - externe : une base est configurée mais n'appartient pas à ce proxy.
 *   - actif   : notre base est configurée et le proxy répond.
 *   - nettoye : notre base est configurée mais le proxy est mort ; l'entrée
 *               vient d'être retirée.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

const DEFAULT_PORT = 4111;
const PROBE_TIMEOUT_MS = 1500;
const GUARD_NAME = 'repo';
const CODEX_BLOCK_START = '# >>> PieceMaker Proxy PII (géré automatiquement)';
const CODEX_BLOCK_END = '# <<< PieceMaker Proxy PII';

function lireEntierPort(valeur) {
  const nombre = Number.parseInt(valeur, 10);
  if (Number.isInteger(nombre) && nombre >= 1024 && nombre <= 65535) return nombre;
  return DEFAULT_PORT;
}

function lireJsonSiPresent(fichier) {
  try {
    if (!fs.existsSync(fichier)) return {};
    const contenu = fs.readFileSync(fichier, 'utf8');
    const analyse = JSON.parse(contenu);
    if (analyse && typeof analyse === 'object' && !Array.isArray(analyse)) return analyse;
    return {};
  } catch {
    return {};
  }
}

function lireStdin(delaiMs = 500) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    let donnees = '';
    let termine = false;
    const finir = () => {
      if (termine) return;
      termine = true;
      resolve(donnees);
    };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (bloc) => { donnees += bloc; });
    process.stdin.on('end', finir);
    process.stdin.on('error', finir);
    setTimeout(finir, delaiMs);
  });
}

function estUrlLoopback(valeur, pathAttendu) {
  try {
    const url = new URL(String(valeur || ''));
    const estLoopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    return estLoopback && url.pathname.replace(/\/$/, '') === pathAttendu;
  } catch {
    return false;
  }
}

function extraireBaseUrlClaude(userHome) {
  const settingsFile = path.join(userHome, '.claude', 'settings.json');
  const settings = lireJsonSiPresent(settingsFile);
  const env = settings && typeof settings.env === 'object' && settings.env !== null ? settings.env : {};
  return env.ANTHROPIC_BASE_URL;
}

function extraireBlocCodex(contenu) {
  const debut = contenu.indexOf(CODEX_BLOCK_START);
  const fin = contenu.indexOf(CODEX_BLOCK_END);
  if (debut === -1 || fin === -1 || fin < debut) return null;
  return contenu.slice(debut, fin + CODEX_BLOCK_END.length);
}

function extraireBaseUrlCodex(codexHome) {
  try {
    const configFile = path.join(codexHome, 'config.toml');
    if (!fs.existsSync(configFile)) return undefined;
    const contenu = fs.readFileSync(configFile, 'utf8');
    const bloc = extraireBlocCodex(contenu);
    if (!bloc) return undefined;
    const correspondance = bloc.match(/^\s*base_url\s*=\s*(?:"([^"]*)"|'([^']*)')/m);
    if (!correspondance) return undefined;
    return correspondance[1] !== undefined ? correspondance[1] : correspondance[2];
  } catch {
    return undefined;
  }
}

function portDeLaBase(valeur, portParDefaut) {
  try {
    const url = new URL(String(valeur || ''));
    if (url.port) return lireEntierPort(url.port);
    return url.protocol === 'https:' ? 443 : 80;
  } catch {
    return portParDefaut;
  }
}

function sonderPort(port) {
  return new Promise((resolve) => {
    const requete = http.request({ host: '127.0.0.1', port, path: '/', method: 'GET', timeout: PROBE_TIMEOUT_MS }, (reponse) => {
      reponse.resume();
      resolve('vivant');
    });
    requete.on('timeout', () => { requete.destroy(); resolve('mort'); });
    requete.on('error', () => resolve('mort'));
    requete.end();
  });
}

function journaliser(homeDir, entree) {
  try {
    const fichier = path.join(homeDir, '.piecemaker', 'proxy-guard.log');
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.appendFileSync(fichier, `${JSON.stringify(entree)}\n`, 'utf8');
  } catch {
  }
}

function sortir(payload) {
  if (payload) process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(0);
}

async function main() {
  const debut = Date.now();
  const userHome = os.homedir();
  const client = process.env.PIECEMAKER_HOOK_CLIENT === 'codex' ? 'codex' : 'claude';
  let route = 'inconnue';
  let verdict = 'inconnu';
  let probe = null;
  let port = DEFAULT_PORT;

  try {
    const entree = await lireStdin();
    let stdinAnalyse = {};
    try { stdinAnalyse = entree ? JSON.parse(entree) : {}; } catch { stdinAnalyse = {}; }
    const sessionId = stdinAnalyse.session_id ?? null;
    const source = stdinAnalyse.source ?? null;

    const terminer = (payload) => {
      journaliser(userHome, {
        ts: new Date().toISOString(), event: 'SessionStart', source, sessionId,
        client, port, route, probe, verdict, dureeMs: Date.now() - debut, guard: GUARD_NAME,
      });
      sortir(payload);
    };

    if (client === 'codex') {
      const codexHome = process.env.CODEX_HOME || path.join(userHome, '.codex');
      const baseUrl = extraireBaseUrlCodex(codexHome);

      if (!baseUrl) {
        route = 'absente';
        verdict = 'direct';
        terminer({
          systemMessage: "PieceMaker : aucun proxy PII configuré pour cette session Codex — elle démarre en accès direct, sans anonymisation.",
          hookSpecificOutput: {
            hookEventName: 'SessionStart',
            additionalContext: "Aucun fournisseur piecemaker_proxy n'est configuré dans ~/.codex/config.toml : la session n'est pas routée par le proxy PII PieceMaker, aucune anonymisation n'est appliquée.",
          },
        });
        return;
      }

      if (!estUrlLoopback(baseUrl, '/chatgpt')) {
        route = 'externe';
        verdict = 'externe';
        terminer(null);
        return;
      }

      route = 'proxy_piecemaker';
      port = portDeLaBase(baseUrl, DEFAULT_PORT);
      probe = await sonderPort(port);

      if (probe === 'vivant') {
        verdict = 'actif';
        terminer(null);
        return;
      }

      const { bypassCodexProxy } = require('../../../server/piecemaker/anonymizer/client-config.cjs');
      bypassCodexProxy({ codexHome });

      verdict = 'nettoye';
      terminer({
        systemMessage: `⚠️ PIECEMAKER : proxy PII injoignable sur le port ${port}. La configuration périmée a été retirée de ~/.codex/config.toml — cette session Codex démarre en ACCÈS DIRECT, SANS ANONYMISATION. Démarrer le serveur PieceMaker (commande \`piecemaker\`) pour rétablir la protection.`,
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: `Le proxy PII PieceMaker était configuré sur le port ${port} mais ne répond pas. Le bloc géré a été retiré de ~/.codex/config.toml et model_provider est revenu à "openai". Cette session n'est PAS anonymisée tant que le serveur PieceMaker (commande \`piecemaker\`) n'est pas relancé.`,
        },
      });
      return;
    }

    const configFile = path.join(userHome, '.piecemaker', 'config.json');
    const config = lireJsonSiPresent(configFile);
    port = lireEntierPort(config.mikePiiPort);

    const baseUrl = extraireBaseUrlClaude(userHome);

    if (!baseUrl) {
      route = 'absente';
      verdict = 'direct';
      terminer({
        systemMessage: "PieceMaker : aucun proxy PII configuré pour cette session — elle démarre en accès direct, sans anonymisation.",
        hookSpecificOutput: {
          hookEventName: 'SessionStart',
          additionalContext: "Aucune base ANTHROPIC_BASE_URL n'est configurée : la session n'est pas routée par le proxy PII PieceMaker, aucune anonymisation n'est appliquée.",
        },
      });
      return;
    }

    if (!estUrlLoopback(baseUrl, '/anthropic')) {
      route = 'externe';
      verdict = 'externe';
      terminer(null);
      return;
    }

    route = 'proxy_piecemaker';
    port = portDeLaBase(baseUrl, port);
    probe = await sonderPort(port);

    if (probe === 'vivant') {
      verdict = 'actif';
      terminer(null);
      return;
    }

    const { bypassClaudeCodeProxy } = require('../../../server/piecemaker/anonymizer/client-config.cjs');
    bypassClaudeCodeProxy({ userHome });

    verdict = 'nettoye';
    terminer({
      systemMessage: `⚠️ PIECEMAKER : proxy PII injoignable sur le port ${port}. La configuration périmée a été retirée — cette session démarre en ACCÈS DIRECT, SANS ANONYMISATION. Démarrer le serveur PieceMaker (commande \`piecemaker\`) pour rétablir la protection.`,
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: `Le proxy PII PieceMaker était configuré sur le port ${port} mais ne répond pas. L'entrée ANTHROPIC_BASE_URL périmée a été retirée de ~/.claude/settings.json. Cette session n'est PAS anonymisée tant que le serveur PieceMaker (commande \`piecemaker\`) n'est pas relancé.`,
      },
    });
  } catch {
    sortir(null);
  }
}

main();
