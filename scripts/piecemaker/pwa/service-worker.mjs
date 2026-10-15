import { readFileSync } from 'node:fs';

export function withPieceMakerOfflinePage(upstreamSource) {
  const logo = readFileSync(new URL('../../../public/logo-128.png', import.meta.url)).toString('base64');
  const page = readFileSync(new URL('./offline.html', import.meta.url), 'utf8')
    .replace('__LOGO__', `data:image/png;base64,${logo}`)
    .replace('__LAUNCHER_PORT__', String(Number(process.env.VITE_PORT || process.env.PIECEMAKER_VITE_PORT || 5173)));

  return `self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate' || new URL(event.request.url).origin !== self.location.origin) return;
  event.stopImmediatePropagation();
  event.respondWith(fetch(event.request).then(response => {
    if (response.status >= 500) throw new Error('unavailable');
    return response;
  }).catch(() => new Response(${JSON.stringify(page)}, {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }
  })));
});
${upstreamSource}`;
}
