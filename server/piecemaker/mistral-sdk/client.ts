import fs from 'node:fs';
import { rootCertificates } from 'node:tls';

import { Mistral } from '@mistralai/mistralai';
import { HTTPClient } from '@mistralai/mistralai/lib/http.js';
import { ProxyAgent } from 'undici';

export function createMistralClient(apiKey: string) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const certificate = process.env.NODE_EXTRA_CA_CERTS;
  const dispatcher = proxy ? new ProxyAgent({
    uri: proxy,
    requestTls: certificate ? { ca: [...rootCertificates, fs.readFileSync(certificate, 'utf8')] } : undefined,
  }) : undefined;
  const httpClient = new HTTPClient({
    fetcher: (input, init) => fetch(input, { ...init, ...(dispatcher ? { dispatcher } : {}) } as Parameters<typeof fetch>[1]),
  });
  return {
    client: new Mistral({ apiKey, httpClient, timeoutMs: 120000 }),
    close: async () => { await dispatcher?.close(); },
  };
}
