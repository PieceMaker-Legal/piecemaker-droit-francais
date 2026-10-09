import assert from 'node:assert/strict';
import test from 'node:test';

import type { Request, Response } from 'express';

import { createCompanySearchRouter, parseSearchLine } from './company-search.js';

test('company search accepts registry results without a legal form', () => {
  assert.deepEqual(
    parseSearchLine('- EXEMPLE BIOLOGICS | SIREN 000000000 | en activité | NAF 72.19Z | 1 RUE EXEMPLE 75012 PARIS 12'),
    {
      name: 'EXEMPLE BIOLOGICS',
      siren: '000000000',
      summary: 'en activité · NAF 72.19Z · 1 RUE EXEMPLE 75012 PARIS 12',
    },
  );
});

test('company search preserves a legal form in registry results', () => {
  assert.deepEqual(
    parseSearchLine('- EXEMPLE BIOLOGICS (SA) | SIREN 000000000 | en activité | NAF 72.19Z | 1 RUE EXEMPLE 75012 PARIS 12'),
    {
      name: 'EXEMPLE BIOLOGICS',
      siren: '000000000',
      summary: 'SA · en activité · NAF 72.19Z · 1 RUE EXEMPLE 75012 PARIS 12',
    },
  );
});

test('company search preserves parentheses belonging to the registered name', () => {
  assert.deepEqual(
    parseSearchLine('- JEAN DUPONT (DUPONT) (ATELIER EXEMPLE) | SIREN 123456789 | en activité | NAF 73.11Z | 12 RUE DES LILAS PARIS'),
    {
      name: 'JEAN DUPONT (DUPONT) (ATELIER EXEMPLE)',
      siren: '123456789',
      summary: 'en activité · NAF 73.11Z · 12 RUE DES LILAS PARIS',
    },
  );
});

test('returns an individual entrepreneur rather than a parenthesized name as the legal form', async (context) => {
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    if (request.method === 'notifications/initialized') return new globalThis.Response(null, { status: 204 });
    const text = request.params.name === 'rechercher_entreprise'
      ? '- JEAN DUPONT (DUPONT) (ATELIER EXEMPLE) | SIREN 123456789 | en activité | NAF 73.11Z | 12 RUE DES LILAS PARIS'
      : '# JEAN DUPONT (DUPONT) (ATELIER EXEMPLE) (En activité)\nSIREN : 123456789 | SIRET siège : 12345678900010\nForme juridique (code) : 1000 | NAF : 73.11Z';
    return globalThis.Response.json({ result: request.method === 'initialize' ? {} : { content: [{ type: 'text', text }] } });
  });
  let payload: { results: Array<{ name: string; fields: { legalForm: string; status: string } }> } | undefined;
  const router = createCompanySearchRouter();
  await router.stack[0].route!.stack[0].handle({ body: { query: '123456789' } } as Request, { json: (value: typeof payload) => { payload = value; } } as Response, () => {});
  assert.equal(payload?.results[0].fields.legalForm, 'Entrepreneur individuel');
  assert.equal(payload?.results[0].fields.status, 'En activité');
  assert.equal(payload?.results[0].name, 'JEAN DUPONT (DUPONT) (ATELIER EXEMPLE)');
});

test('returns the resolved legal form in the company search response', async (context) => {
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    if (request.method === 'notifications/initialized') return new globalThis.Response(null, { status: 204 });
    const text = request.params.name === 'rechercher_entreprise'
      ? '- SOCIETE EXEMPLE | SIREN 123456789 | en activité | NAF 62.01Z | 12 RUE DES LILAS PARIS'
      : '# SOCIETE EXEMPLE (En activité)\nSIREN : 123456789 | SIRET siège : 12345678900010\nForme juridique (code) : 5710 | NAF : 62.01Z\nAdresse du siège : 12 rue des Lilas, Paris';
    return globalThis.Response.json({ result: request.method === 'initialize' ? {} : { content: [{ type: 'text', text }] } });
  });
  let payload: { results: Array<{ fields: { legalForm: string; legalFormCode: string } }> } | undefined;
  const router = createCompanySearchRouter();
  await router.stack[0].route!.stack[0].handle({ body: { query: 'Société Exemple' } } as Request, { json: (value: typeof payload) => { payload = value; } } as Response, () => {});
  assert.equal(payload?.results[0].fields.legalForm, 'SAS');
  assert.equal(payload?.results[0].fields.legalFormCode, '5710');
});

test('preserves a sole-shareholder form in a heading containing a parenthesized trade name', async (context) => {
  context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    if (request.method === 'notifications/initialized') return new globalThis.Response(null, { status: 204 });
    const text = request.params.name === 'rechercher_entreprise'
      ? '- SOCIETE EXEMPLE (ATELIER EXEMPLE) (SASU) | SIREN 123456789 | en activité | NAF 62.01Z | 12 RUE DES LILAS PARIS'
      : '# SOCIETE EXEMPLE (ATELIER EXEMPLE) (SASU) (En activité)\nSIREN : 123456789\nForme juridique (code) : 5710 | NAF : 62.01Z';
    return globalThis.Response.json({ result: request.method === 'initialize' ? {} : { content: [{ type: 'text', text }] } });
  });
  let payload: { results: Array<{ name: string; fields: { legalForm: string; status: string } }> } | undefined;
  const router = createCompanySearchRouter();
  await router.stack[0].route!.stack[0].handle({ body: { query: '123456789' } } as Request, { json: (value: typeof payload) => { payload = value; } } as Response, () => {});
  assert.equal(payload?.results[0].fields.legalForm, 'SASU');
  assert.equal(payload?.results[0].fields.status, 'En activité');
  assert.equal(payload?.results[0].name, 'SOCIETE EXEMPLE (ATELIER EXEMPLE)');
});
