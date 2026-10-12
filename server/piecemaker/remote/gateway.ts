import http, { type IncomingHttpHeaders } from 'node:http';
import net, { type AddressInfo } from 'node:net';

export type Gateway = { port: number; close(): Promise<void> };

const LOGIN_HEADER = 'tailscale-user-login';

export function isOwner(headers: IncomingHttpHeaders, ownerLogin: string | null): boolean {
  const login = headers[LOGIN_HEADER];
  return Boolean(ownerLogin) && typeof login === 'string' && login.toLowerCase() === ownerLogin!.toLowerCase();
}

function forwardedHeaders(headers: IncomingHttpHeaders, targetPort: number): IncomingHttpHeaders {
  return {
    ...headers,
    host: `localhost:${targetPort}`,
    'x-forwarded-host': headers['x-forwarded-host'] || headers.host,
    'x-forwarded-proto': 'https',
    'x-forwarded-for': headers['x-forwarded-for'] || 'tailnet',
    'x-piecemaker-remote': '1',
  };
}

function rawHeaders(headers: IncomingHttpHeaders): string {
  return Object.entries(headers)
    .flatMap(([name, value]) => (Array.isArray(value) ? value : [value]).filter((item) => item !== undefined).map((item) => `${name}: ${item}\r\n`))
    .join('');
}

export function startGateway(targetPort: () => number, ownerLogin: () => string | null): Promise<Gateway> {
  const server = http.createServer((request, response) => {
    if (!isOwner(request.headers, ownerLogin())) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Accès réservé au propriétaire de cet ordinateur sur Tailscale.');
      return;
    }
    const port = targetPort();
    const upstream = http.request({ host: '127.0.0.1', port, method: request.method, path: request.url, headers: forwardedHeaders(request.headers, port) }, (reply) => {
      response.writeHead(reply.statusCode || 502, reply.headers);
      reply.pipe(response);
    });
    upstream.on('error', () => {
      if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('PieceMaker ne répond pas sur cet ordinateur.');
    });
    request.pipe(upstream);
  });

  server.on('upgrade', (request, socket, head) => {
    if (!isOwner(request.headers, ownerLogin())) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    const port = targetPort();
    const upstream = net.connect(port, '127.0.0.1', () => {
      upstream.write(`${request.method} ${request.url} HTTP/1.1\r\n${rawHeaders(forwardedHeaders(request.headers, port))}\r\n`);
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve({
      port: (server.address() as AddressInfo).port,
      close: () => new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
    }));
  });
}
