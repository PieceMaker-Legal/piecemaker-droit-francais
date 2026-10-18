import fs from 'node:fs/promises';
import path from 'node:path';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.pdf': 'application/pdf',
};

export function createUiHandler({ getOrigin, getFiles, embeddedDirectory, forward }) {
  return async (request) => {
    const url = new URL(request.url);
    if (url.origin !== getOrigin() || !['GET', 'HEAD'].includes(request.method)
      || /^\/(?:api|ws|shell|health)(?:\/|$)/.test(url.pathname)) return forward(request);
    let name;
    try {
      name = decodeURIComponent(url.pathname).slice(1);
    } catch {
      return new Response('Bad request', { status: 400 });
    }
    if (name.split('/').some((part) => part === '..' || part === '.') || name.includes('\\')) {
      return new Response('Bad request', { status: 400 });
    }
    if (name === 'sw.js') {
      return new Response(request.method === 'HEAD' ? null : "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));", {
        headers: { 'Content-Type': CONTENT_TYPES['.js'], 'Cache-Control': 'no-store', 'Service-Worker-Allowed': '/' },
      });
    }
    const files = getFiles();
    const isPage = name === '' || name === 'index.html'
      || (!path.posix.extname(name) && request.headers.get('accept')?.includes('text/html'));
    if (isPage) name = 'index.html';
    let content = files?.get(name);
    if (!content && !files && isPage) content = await fs.readFile(path.join(embeddedDirectory, 'index.html'));
    if (!content) {
      if (files && name.startsWith('assets/')) return new Response('Not found', { status: 404 });
      return forward(request);
    }
    return new Response(request.method === 'HEAD' ? null : content, {
      headers: {
        'Content-Type': CONTENT_TYPES[path.posix.extname(name)] || 'application/octet-stream',
        'Cache-Control': name.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };
}
