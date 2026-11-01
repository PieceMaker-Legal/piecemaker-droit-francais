import assert from 'node:assert/strict';

import { test } from 'vitest';

import { buildQuestionPrompt, readQuestionTurn } from '@/piecemaker/docx/commentQuestions';

const PROMPT = 'Question posée en commentaire du document « acte.docx ».\n\nCe délai est-il exact ?';
const ASKED_AT = Date.parse('2026-01-10T10:00:00.000Z');
const BEFORE = '2026-01-10T09:00:00.000Z';
const AFTER = '2026-01-10T10:00:01.000Z';

test('builds a prompt with only the document, the passage, its paragraph and the question', () => {
  const prompt = buildQuestionPrompt({
    documentName: 'acte.docx',
    filePath: '/dossier/acte.docx',
    passage: 'Société Exemple SAS\nest assignée',
    paragraphs: 'La Société Exemple SAS\nest assignée sous huit jours.',
    question: ' Ce délai est-il exact ? ',
  });
  assert.match(prompt, /« acte\.docx »/);
  assert.match(prompt, /> Société Exemple SAS\n> est assignée/);
  assert.match(prompt, /Paragraphe du passage :\n> La Société Exemple SAS\n> est assignée sous huit jours\./);
  assert.ok(prompt.endsWith('\n\nCe délai est-il exact ?'));
});

test('omits the paragraph when the passage already covers it', () => {
  const prompt = buildQuestionPrompt({
    documentName: 'acte.docx',
    filePath: '/dossier/acte.docx',
    passage: 'Paragraphe entier.',
    paragraphs: 'Paragraphe entier.',
    question: 'Exact ?',
  });
  assert.ok(!prompt.includes('Paragraphe du passage'));
});

test('returns null until the question reaches the transcript', () => {
  assert.equal(readQuestionTurn([{ kind: 'text', role: 'user', content: 'autre question', timestamp: AFTER }], PROMPT, ASKED_AT), null);
});

test('ignores the same question asked earlier', () => {
  const messages = [
    { kind: 'text', role: 'user', content: PROMPT, timestamp: BEFORE },
    { kind: 'text', role: 'assistant', content: 'Ancienne réponse.', timestamp: BEFORE },
  ];
  assert.equal(readQuestionTurn(messages, PROMPT, ASKED_AT), null);
});

test('finds the prompt when the chat appended instructions to it', () => {
  const turn = readQuestionTurn([
    { kind: 'text', role: 'user', content: `${PROMPT}\n\n<CONSIGNES>`, timestamp: AFTER },
    { kind: 'text', role: 'assistant', content: 'Oui.', timestamp: AFTER },
  ], PROMPT, ASKED_AT);
  assert.equal(turn, 'Oui.');
});

test('keeps only the assistant text of the question turn', () => {
  const turn = readQuestionTurn([
    { kind: 'text', role: 'assistant', content: 'réponse précédente', timestamp: BEFORE },
    { kind: 'text', role: 'user', content: PROMPT, timestamp: AFTER },
    { kind: 'thinking', content: 'réflexion' },
    { kind: 'text', role: 'assistant', content: 'Je vérifie.' },
    { kind: 'tool_use', content: 'recherche' },
    { kind: 'text', role: 'assistant', content: 'Le délai est exact.' },
    { kind: 'text', role: 'user', content: 'question suivante' },
    { kind: 'text', role: 'assistant', content: 'réponse suivante' },
  ], PROMPT, ASKED_AT);
  assert.equal(turn, 'Je vérifie.\n\nLe délai est exact.');
});
