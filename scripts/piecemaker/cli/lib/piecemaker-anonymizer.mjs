import os from 'node:os';
import path from 'node:path';

import { PIECEMAKER_HOME } from './config.mjs';

/**
 * Répare le câblage PII de Codex/Claude Code avant chaque lancement de
 * `piecemaker`, indépendamment de l'état du serveur applicatif.
 *
 * Le serveur (`server:dev`) répare déjà ce câblage à son propre démarrage via
 * `startRequiredAnonymizer`, mais uniquement quand il tourne. Les applications
 * clientes (Codex notamment) réécrivent parfois `config.toml` en entier lors
 * d'une mise à jour et effacent le bloc géré sans le savoir. Ce module rejoue
 * la même réparation ici, tôt dans le CLI, pour que `piecemaker` seul —
 * sans dépendre du serveur — suffise à débloquer un client mal configuré.
 *
 * Best-effort : un échec ici ne doit jamais empêcher `piecemaker` de lancer
 * l'application. On rapporte simplement l'état au journal.
 */
export async function repairClientProxies({ appDir, report }) {
  const { step, ok, warn } = report;
  step('Vérification du routage PII (Claude, Codex)');

  let configureClaudeCodeProxy;
  let configureCodexProxy;
  try {
    const clientConfig = await import(
      path.join(appDir, 'server', 'piecemaker', 'anonymizer', 'client-config.cjs')
    );
    ({ configureClaudeCodeProxy, configureCodexProxy } = clientConfig);
  } catch (error) {
    warn(`réparation du routage PII ignorée : ${error.message}`);
    return;
  }

  const userHome = os.homedir();
  const origin = `http://127.0.0.1:${await resolveAnonymizerPort()}`;
  const caFile = path.join(userHome, '.piecemaker', 'certs', 'piecemaker-ca.crt');

  const attempt = (name, run) => {
    try {
      const result = run();
      if (result.conflict) {
        warn(`${name} : routage PII non réparé (${result.reason || 'conflit'}) — voir ${result.file}`);
      } else if (result.changed) {
        ok(`${name} : routage PII réparé`);
      }
      return result;
    } catch (error) {
      warn(`${name} : réparation du routage PII a échoué (${error.message})`);
      return null;
    }
  };

  attempt('claude', () => configureClaudeCodeProxy({ proxyUrl: origin, caFile, userHome }));
  attempt('codex', () => configureCodexProxy({
    codexHome: process.env.CODEX_HOME || path.join(userHome, '.codex'),
  }));
}

/**
 * Le port du proxy PII est publié dans `config.json` par le service au
 * démarrage (`mikePiiPort`). On le lit ici pour rester cohérent avec le port
 * réellement écouté même s'il a dévié du port préféré ; à défaut, on retombe
 * sur le port préféré par défaut du service.
 */
async function resolveAnonymizerPort() {
  const DEFAULT_PORT = 4111;
  try {
    const fs = await import('node:fs');
    const configFile = path.join(PIECEMAKER_HOME, 'config.json');
    const current = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const port = Number.parseInt(current?.mikePiiPort, 10);
    return Number.isInteger(port) && port > 0 ? port : DEFAULT_PORT;
  } catch {
    return DEFAULT_PORT;
  }
}
