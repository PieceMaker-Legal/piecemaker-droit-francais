import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCompanyLegalForm } from '../index.js';

test('resolves registry codes without a legal form in the heading or search result', () => {
  for (const [code, form] of [['5710', 'SAS'], ['5510', 'SA'], ['5599', 'SA'], ['5699', 'SA'], ['5499', 'SARL'], ['5485', 'SELARL'], ['5785', 'SELAS'], ['6540', 'SCI'], ['5720', 'SASU'], ['5498', 'EURL']]) assert.equal(resolveCompanyLegalForm(code), form);
});

test('preserves an explicit form rather than losing details such as a sole shareholder', () => {
  assert.equal(resolveCompanyLegalForm('5710', ' SASU '), 'SASU');
  assert.equal(resolveCompanyLegalForm('5499', 'EURL'), 'EURL');
});

test('uses the registry category instead of names or conflicting forms', () => {
  assert.equal(resolveCompanyLegalForm('1000', 'DUPONT'), 'Entrepreneur individuel');
  assert.equal(resolveCompanyLegalForm('1000', 'SA'), 'Entrepreneur individuel');
  assert.equal(resolveCompanyLegalForm('5710', 'SA'), 'SAS');
  assert.equal(resolveCompanyLegalForm('', 'DUPONT'), '');
  assert.equal(resolveCompanyLegalForm('', 'SASU'), 'SASU');
});

test('uses the official label for other categories and does not guess unknown codes', () => {
  assert.equal(resolveCompanyLegalForm('6317'), 'Société coopérative agricole');
  assert.equal(resolveCompanyLegalForm('9900'), 'Autre personne morale de droit privé');
  assert.equal(resolveCompanyLegalForm('1234'), '');
  assert.equal(resolveCompanyLegalForm(''), '');
});

