import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { withPieceMakerOfflinePage } from './service-worker.mjs';

const upstream = readFileSync(new URL('../../../pwa/service-worker.js', import.meta.url), 'utf8');

function worker(fetch) {
  const listeners = new Map();
  const self = {
    location: { origin: 'http://localhost:5173' },
    addEventListener(name, handler) {
      listeners.set(name, [...(listeners.get(name) || []), handler]);
    },
  };
  vm.runInNewContext(withPieceMakerOfflinePage(upstream), { self, fetch, Response, URL });
  return listeners;
}

function navigation(listeners, url = 'http://localhost:5173/session/example') {
  let result;
  let stopped = false;
  const event = {
    request: { mode: 'navigate', url },
    stopImmediatePropagation() { stopped = true; },
    respondWith(response) { assert.equal(result, undefined); result = response; },
  };
  for (const handler of listeners.get('fetch')) {
    handler(event);
    if (stopped) break;
  }
  return result;
}

test('upstream worker stays intact and its notification handlers remain registered', () => {
  const config = readFileSync(new URL('../../../vite.config.js', import.meta.url), 'utf8');
  assert.match(config, /const serviceWorkerSource = withPieceMakerOfflinePage\(serviceWorkerTemplate/);
  assert.ok(withPieceMakerOfflinePage(upstream).endsWith(upstream));
  const listeners = worker();
  for (const name of ['install', 'activate', 'push', 'notificationclick']) {
    assert.equal(listeners.get(name).length, 1);
  }
});

test('online navigation keeps the exact network response', async () => {
  const response = new Response('login');
  assert.equal(await navigation(worker(async () => response)), response);
});

test('network failure and unavailable gateway show a self-contained recovery page', async () => {
  for (const fetch of [async () => { throw new Error('offline'); }, async () => new Response('', { status: 503 })]) {
    const response = await navigation(worker(fetch));
    const page = await response.text();
    assert.match(page, /Relancer PieceMaker/);
    assert.match(page, /Tailscale doit être connecté sur votre ordinateur et votre téléphone/);
    assert.match(page, /data:image\/png;base64,/);
    assert.doesNotMatch(page, /__LOGO__/);
    assert.match(response.headers.get('content-type'), /charset=utf-8/);
  }
});

function recoveryPage({ hostname = 'localhost', platform = 'MacIntel', storedTheme = 'dark', online = false, clientOnline = online } = {}) {
  const page = readFileSync(new URL('./offline.html', import.meta.url), 'utf8').replace('__LAUNCHER_PORT__', '5173');
  const elements = new Map();
  let click;
  let reloads = 0;
  let dark = false;
  const fetches = [];
  const location = { hostname, port: '5173', href: '', reload() { reloads++; } };
  const document = {
    documentElement: { classList: { toggle(_name, value) { dark = value; } } },
    addEventListener() {},
    querySelector() { return this.getElementById('footer'); },
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, { textContent: '', addEventListener(_name, handler) { click = handler; } });
      return elements.get(id);
    },
  };
  const context = vm.createContext({
    document, location, navigator: { platform, maxTouchPoints: 0 },
    localStorage: { getItem(key) { return key === 'user-preferences' ? JSON.stringify({ theme: storedTheme }) : null; } },
    matchMedia: () => ({ matches: false }), window: { addEventListener() {} },
    setInterval() {}, setTimeout() {}, AbortSignal,
    fetch: async (url, options) => {
      fetches.push({ url, options });
      if (url === '/') return new Response('application', { status: clientOnline ? 200 : 503, headers: { 'Content-Type': 'text/html' } });
      if (!online) throw new Error('offline');
      return Response.json({ needsSetup: false });
    },
  });
  let ready;
  for (const script of page.matchAll(/<script>([\s\S]*?)<\/script>/g)) ready = vm.runInContext(script[1], context);
  return { ready, context, location, elements, fetches, click: () => click(), dark: () => dark, reloads: () => reloads };
}

test('local Mac relaunch requires a click and uses the fixed protocol without passing case data', async () => {
  const page = recoveryPage();
  assert.equal(page.location.href, '');
  page.click();
  assert.equal(page.location.href, 'piecemaker-relaunch://start');
  assert.equal(page.elements.get('status').textContent, 'PieceMaker démarre…');
  assert.equal(page.elements.get('relaunch').disabled, true);
  await vm.runInContext('reconnect()', page.context);
  assert.equal(page.reloads(), 0);
  assert.equal(page.dark(), true);
});

test('remote access explains the powered-off computer and never opens a local protocol', async () => {
  const page = recoveryPage({ hostname: 'example.ts.net', platform: 'iPhone', online: true, storedTheme: 'light' });
  await page.ready;
  page.click();
  assert.equal(page.location.href, '');
  assert.equal(page.elements.get('relaunch').textContent, 'Réessayer');
  assert.equal(page.elements.get('title').textContent, 'Ordinateur injoignable');
  assert.equal(page.elements.get('description').hidden, true);
  assert.equal(page.elements.get('footer').hidden, true);
  assert.equal(page.elements.get('tailscale').hidden, false);
  assert.ok(page.reloads() >= 1);
  assert.equal(page.dark(), false);
  assert.equal(page.fetches[0].url, '/api/auth/status');
  assert.equal(page.fetches[0].options.cache, 'no-store');
});

test('the page waits for both the backend and the interface before reloading', async () => {
  const page = recoveryPage({ online: true, clientOnline: false });
  await page.ready;
  assert.equal(page.reloads(), 0);
  assert.equal(page.elements.get('tailscale').hidden, true);
});
