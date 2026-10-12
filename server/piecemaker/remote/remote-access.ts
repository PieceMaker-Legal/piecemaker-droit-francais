import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import express, { type Request, type Response } from 'express';

import type { Gateway } from './gateway.js';
import type { KeepAwake } from './keep-awake.js';
import type { Tailscale } from './tailscale.js';

export const REMOTE_STATE_FILE = 'acces-telephone.json';

type RemoteState = { enabled: boolean; target: string | null };

type RemoteAccessOptions = {
  tailscale: Tailscale;
  dataRoot: string;
  devMode: boolean;
  serverPort: number;
  vitePort: number;
  keepAwake: KeepAwake;
  startGateway: (targetPort: () => number, ownerLogin: () => string | null) => Promise<Gateway>;
};

export class RemoteAccessError extends Error {
  readonly status: number;

  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
  }
}

export function createRemoteAccess(options: RemoteAccessOptions) {
  const file = path.join(options.dataRoot, REMOTE_STATE_FILE);
  const httpsPort = options.devMode ? 8443 : 443;
  const targetPort = options.devMode ? options.vitePort : options.serverPort;
  let gateway: Gateway | null = null;
  let ownerLogin: string | null = null;

  const readState = (): RemoteState => {
    try {
      const value = JSON.parse(readFileSync(file, 'utf8'));
      return { enabled: value.enabled === true, target: typeof value.target === 'string' ? value.target : null };
    } catch {
      return { enabled: false, target: null };
    }
  };

  const writeState = (state: RemoteState) => {
    mkdirSync(options.dataRoot, { recursive: true });
    writeFileSync(`${file}.tmp`, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
  };

  const closeGateway = async () => {
    await gateway?.close();
    gateway = null;
  };

  const status = async () => {
    const tailscale = await options.tailscale.status();
    const base = {
      tailscale: { installed: tailscale.installed, running: tailscale.running, httpsEnabled: tailscale.httpsEnabled, dnsName: tailscale.dnsName },
      httpsPort,
      devMode: options.devMode,
      keepAwake: options.keepAwake.active(),
      published: false,
      funnel: false,
      conflict: false,
      url: null as string | null,
    };
    if (!tailscale.running || !tailscale.dnsName) return base;
    const entry = await options.tailscale.serveEntry(tailscale.dnsName, httpsPort);
    const { enabled, target } = readState();
    const published = Boolean(gateway) && enabled && entry.proxy !== null && entry.proxy === target;
    return {
      ...base,
      published,
      funnel: entry.funnel,
      conflict: entry.proxy !== null && entry.proxy !== target,
      url: published ? `https://${tailscale.dnsName}${httpsPort === 443 ? '' : `:${httpsPort}`}` : null,
    };
  };

  const enable = async (): Promise<{ consentUrl: string | null }> => {
    const tailscale = await options.tailscale.status();
    if (!tailscale.installed) throw new RemoteAccessError('Tailscale n’est pas installé sur cet ordinateur.');
    if (!tailscale.running || !tailscale.dnsName) throw new RemoteAccessError('Tailscale n’est pas connecté sur cet ordinateur.');
    if (!tailscale.ownerLogin) throw new RemoteAccessError('Compte Tailscale de cet ordinateur introuvable.');
    const entry = await options.tailscale.serveEntry(tailscale.dnsName, httpsPort);
    if (entry.funnel) throw new RemoteAccessError(`Tailscale Funnel est actif sur le port ${httpsPort} : il rendrait PieceMaker public. Désactivez-le d’abord.`);
    const previous = readState().target;
    if (entry.proxy && entry.proxy !== previous) throw new RemoteAccessError(`Le port HTTPS ${httpsPort} de Tailscale Serve sert déjà ${entry.proxy}. PieceMaker ne l’écrase pas.`);
    ownerLogin = tailscale.ownerLogin;
    gateway ??= await options.startGateway(() => targetPort, () => ownerLogin);
    const target = `http://127.0.0.1:${gateway.port}`;
    const { consentUrl } = await options.tailscale.serve(httpsPort, target);
    if (consentUrl) {
      writeState({ enabled: false, target });
      return { consentUrl };
    }
    writeState({ enabled: true, target });
    options.keepAwake.start();
    return { consentUrl: null };
  };

  const disable = async () => {
    const tailscale = await options.tailscale.status();
    const target = readState().target;
    if (tailscale.running && tailscale.dnsName && target) {
      const entry = await options.tailscale.serveEntry(tailscale.dnsName, httpsPort);
      if (entry.proxy === target) await options.tailscale.stop(httpsPort);
    }
    writeState({ enabled: false, target: null });
    options.keepAwake.stop();
    await closeGateway();
  };

  const resume = async () => {
    if (!readState().enabled) return;
    try {
      await enable();
    } catch (error) {
      console.warn('[PieceMaker] Accès téléphone non republié :', error instanceof Error ? error.message : error);
    }
  };

  return { status, enable, disable, resume };
}

export type RemoteAccess = ReturnType<typeof createRemoteAccess>;

export function createRemoteRouter(remote: RemoteAccess) {
  const router = express.Router();
  const fail = (response: Response, error: unknown) => {
    const status = error instanceof RemoteAccessError ? error.status : 500;
    response.status(status).json({ error: error instanceof Error ? error.message : 'Accès téléphone indisponible.' });
  };

  router.get('/remote', async (_request: Request, response: Response) => {
    try {
      response.json(await remote.status());
    } catch (error) {
      fail(response, error);
    }
  });

  router.post('/remote', async (request: Request, response: Response) => {
    if (typeof request.body?.enabled !== 'boolean') return response.status(400).json({ error: 'enabled attendu' });
    try {
      if (request.body.enabled) {
        const { consentUrl } = await remote.enable();
        if (consentUrl) return response.json({ ...(await remote.status()), consentUrl });
      } else {
        await remote.disable();
      }
      response.json(await remote.status());
    } catch (error) {
      fail(response, error);
    }
  });

  return router;
}
