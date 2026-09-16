import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import express, { type Request, type Response } from 'express';

type McpContent = {
  type?: string;
  text?: string;
  resource?: { text?: string };
};

type McpMessage = {
  id?: number;
  error?: { message?: string };
  result?: { content?: McpContent[]; isError?: boolean };
};

export type BodaccAnnouncement = {
  id: string;
  datePublication: string;
  typeAvis: string;
  familleAvis: string;
  commercant: string;
  ville: string;
  tribunal: string;
  jugement: string;
  acte: string;
  url: string;
};

export type BodaccSearchResult = {
  siren: string;
  total: number;
  alertes: string[];
  annonces: BodaccAnnouncement[];
};

const MCP_TIMEOUT_MS = 45_000;

function collectLauncherCandidates(): string[] {
  const candidates: string[] = [];
  const addRoot = (root: string | undefined) => {
    if (root) candidates.push(path.join(root, 'scripts', 'launcher.py'));
  };
  addRoot(process.env.LEGIFRANCE_MCP_ROOT);
  if (process.env.LEGIFRANCE_MCP_LAUNCHER) candidates.push(process.env.LEGIFRANCE_MCP_LAUNCHER);
  const pluginConfigPath = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');
  if (existsSync(pluginConfigPath)) {
    try {
      const configuration = JSON.parse(readFileSync(pluginConfigPath, 'utf8')) as { plugins?: Record<string, Array<{ installPath?: string }>> };
      for (const [plugin, installations] of Object.entries(configuration.plugins || {})) {
        if (!plugin.includes('mcp-legifrance')) continue;
        for (const installation of installations) addRoot(installation.installPath);
      }
    } catch {
      return candidates;
    }
  }
  const versionsRoot = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'mcp-legifrance', 'piecemaker');
  if (existsSync(versionsRoot)) {
    for (const version of readdirSync(versionsRoot).sort().reverse()) addRoot(path.join(versionsRoot, version));
  }
  return [...new Set(candidates)];
}

function resolveLauncher(): string {
  const launcher = collectLauncherCandidates().find((candidate) => existsSync(candidate));
  if (!launcher) throw new Error('Le lanceur du PERS_MORALE_1 Légifrance est introuvable.');
  return launcher;
}

function mcpCall(tool: string, argumentsValue: Record<string, string>): Promise<McpMessage> {
  return new Promise((resolve, reject) => {
    const processHandle = spawn(process.env.PYTHON_PATH || 'python3', [resolveLauncher()], {
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let settled = false;
    const timeout = setTimeout(() => {
      processHandle.kill('SIGTERM');
      reject(new Error('Le PERS_MORALE_1 Légifrance n’a pas répondu à temps.'));
    }, MCP_TIMEOUT_MS);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    processHandle.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      for (const line of stdout.split(/\r?\n/).slice(0, -1)) {
        try {
          const message = JSON.parse(line) as McpMessage;
          if (message.id === 3) finish(() => resolve(message));
        } catch {
          continue;
        }
      }
      stdout = stdout.split(/\r?\n/).at(-1) || '';
    });
    processHandle.once('error', (error) => finish(() => reject(error)));
    processHandle.once('close', (code) => {
      if (!settled) finish(() => reject(new Error(code === null ? 'Le processus Légifrance a été interrompu.' : `Le processus Légifrance s’est arrêté (${code}).`)));
    });
    processHandle.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'piecemaker-dossier', version: '0.1.0' } } })}\n`);
    processHandle.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}\n');
    processHandle.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: tool, arguments: argumentsValue } })}\n`);
    processHandle.stdin.end();
  });
}

function normalizedSiren(siren: string, siret: string): string {
  const sirenDigits = siren.replace(/\D/g, '');
  if (sirenDigits.length === 9) return sirenDigits;
  const siretDigits = siret.replace(/\D/g, '');
  if (siretDigits.length === 14) return siretDigits.slice(0, 9);
  if (sirenDigits.length === 14) return sirenDigits.slice(0, 9);
  throw new Error('Un SIREN à 9 chiffres ou un SIRET à 14 chiffres est requis.');
}

function resultContent(message: McpMessage): McpContent[] {
  if (message.error?.message) throw new Error(message.error.message);
  if (message.result?.isError) throw new Error(message.result.content?.find((entry) => entry.type === 'text')?.text || 'Recherche BODACC impossible.');
  return message.result?.content || [];
}

function readHistory(content: McpContent[], siren: string): BodaccSearchResult {
  const resourceText = content.find((entry) => entry.type === 'resource')?.resource?.text;
  if (!resourceText) throw new Error('La réponse BODACC ne contient pas de données exploitables.');
  const history = JSON.parse(resourceText) as { siren?: string; total_annonces?: number; alertes?: string[]; categories?: Record<string, Array<Record<string, unknown>>> };
  const annonces = Object.values(history.categories || {}).flat().map((annonce) => ({
    id: String(annonce.id || ''),
    datePublication: String(annonce.date_parution || annonce.date || ''),
    typeAvis: String(annonce.type_avis || annonce.type || ''),
    familleAvis: String(annonce.famille_avis || ''),
    commercant: String(annonce.commercant || ''),
    ville: String(annonce.ville || ''),
    tribunal: String(annonce.tribunal || ''),
    jugement: String(annonce.jugement || ''),
    acte: String(annonce.acte || ''),
    url: String(annonce.url || ''),
  }));
  return { siren: history.siren || siren, total: Number(history.total_annonces || annonces.length), alertes: history.alertes || [], annonces };
}

async function searchBodacc(siren: string, siret: string): Promise<BodaccSearchResult> {
  const normalized = normalizedSiren(siren, siret);
  const response = await mcpCall('Tracking_BODACC', { siren: normalized, type_recherche: 'historique' });
  return readHistory(resultContent(response), normalized);
}

export function createBodaccSearchRouter() {
  const router = express.Router();
  router.post('/bodacc-search', async (request: Request, response: Response) => {
    const siren = typeof request.body?.siren === 'string' ? request.body.siren : '';
    const siret = typeof request.body?.siret === 'string' ? request.body.siret : '';
    try {
      response.json(await searchBodacc(siren, siret));
    } catch (error) {
      response.status(502).json({ error: error instanceof Error ? error.message : 'Recherche BODACC impossible.' });
    }
  });
  return router;
}
