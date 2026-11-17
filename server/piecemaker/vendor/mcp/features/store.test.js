const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const load = () => import('./store.mjs');

function caseFolder() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'features-store-'));
  const pm = path.join(root, '.piecemaker');
  fs.mkdirSync(path.join(pm, 'okf', 'Pièces'), { recursive: true });
  fs.mkdirSync(path.join(pm, 'memoires'), { recursive: true });
  fs.writeFileSync(path.join(pm, 'okf', 'Pièces', 'contrat.md'), '---\ntype: Pièces\ntitle: Contrat Société Exemple SAS\n---\nCorps de la fiche.\n');
  fs.writeFileSync(path.join(pm, 'okf', 'index.md'), '---\nokf_version: "0.2"\n---\n');
  fs.writeFileSync(path.join(pm, 'assignation-suivi.json'), JSON.stringify({ matter: { client: 'Jean Dupont' }, evenements: {}, echeances: {} }));
  fs.writeFileSync(path.join(pm, 'memoires', 'assignation.md'), '# Assignation\n');
  return root;
}

const rejects = (promise, code) => assert.rejects(promise, (error) => error.code === code);

test('set, get, update, delete and versions', async () => {
  const { openStore } = await load();
  const store = openStore(caseFolder());
  assert.deepEqual(await store.set('review', 'notes/n1', { title: 'Première', tags: ['a'], meta: { level: 1, keep: true } }), { path: 'notes/n1', version: 1 });
  await store.update('review', 'notes/n1', { meta: { level: 2 }, tags: ['b'], title: { __delete__: true } }, { if_version: 1 });
  const doc = store.get('review', 'notes/n1');
  assert.deepEqual(doc.data, { tags: ['b'], meta: { level: 2, keep: true } });
  assert.equal(doc.version, 2);
  await rejects(store.strReplace('review', 'notes/n1', 'meta.level', 'x', 'y', { if_version: 2 }), 'invalid_argument');
  await store.set('review', 'notes/n1', { text: 'clause de non-concurrence, non-concurrence' }, { if_version: 2 });
  await rejects(store.strReplace('review', 'notes/n1', 'text', 'non-concurrence', 'confidentialité', { if_version: 3 }), 'invalid_argument');
  await store.strReplace('review', 'notes/n1', 'text', 'non-concurrence', 'confidentialité', { if_version: 3, replace_all: true });
  assert.equal(store.get('review', 'notes/n1').data.text, 'clause de confidentialité, confidentialité');
  await rejects(store.delete('review', 'notes/n1'), 'conflict');
  await store.delete('review', 'notes/n1', { if_version: 4 });
  assert.throws(() => store.get('review', 'notes/n1'), (error) => error.code === 'not_found');
});

test('update on a missing document is refused', async () => {
  const { openStore } = await load();
  await rejects(openStore(caseFolder()).update('review', 'notes/absent', { a: 1 }), 'invalid_argument');
});

test('if_version conflict', async () => {
  const { openStore } = await load();
  const store = openStore(caseFolder());
  await store.set('review', 'notes/n1', { a: 1 });
  await rejects(store.update('review', 'notes/n1', { a: 2 }, { if_version: 5 }), 'conflict');
  await rejects(store.set('review', 'notes/n1', { a: 2 }), 'conflict');
  await rejects(store.set('review', 'notes/n2', { a: 2 }, { if_version: 1 }), 'conflict');
  assert.equal(store.get('review', 'notes/n1').data.a, 1);
});

test('batch is all or nothing', async () => {
  const { openStore } = await load();
  const store = openStore(caseFolder());
  await rejects(store.batch('review', [
    { op: 'set', path: 'notes/n1', data: { a: 1 } },
    { op: 'update', path: 'notes/absent', data: { a: 1 } },
  ]), 'invalid_argument');
  assert.equal(store.list('review', 'notes').documents.length, 0);
  await store.batch('review', [{ op: 'set', path: 'notes/n1', data: { a: 1 } }, { op: 'set', path: 'notes/n2', data: { a: 2 } }]);
  assert.equal(store.list('review', 'notes').documents.length, 2);
  await rejects(store.batch('review', [{ op: 'str_replace', path: 'notes/n1', field: 'a', old_str: '1', new_str: '2' }]), 'invalid_argument');
  await rejects(store.batch('review', Array.from({ length: 51 }, (_, n) => ({ op: 'set', path: `notes/m${n}`, data: { n } }))), 'invalid_argument');
});

test('paths that leave the store are refused', async () => {
  const { openStore } = await load();
  const store = openStore(caseFolder());
  await rejects(store.set('review', '../escape', { a: 1 }), 'invalid_argument');
  await rejects(store.set('review', 'notes/../../x', { a: 1 }), 'invalid_argument');
  await rejects(store.set('../review', 'notes/n1', { a: 1 }), 'invalid_argument');
  await rejects(store.set('review', 'notes', { a: 1 }), 'invalid_argument');
  await rejects(store.set('review', 'notes/n 1', { a: 1 }), 'invalid_argument');
  await rejects(store.set('review', 'notes/n1', { a: { __delete__: true } }), 'invalid_argument');
  assert.throws(() => store.list('review', 'notes/n1'), (error) => error.code === 'invalid_argument');
});

test('query with where, orderBy and limit', async () => {
  const { openStore } = await load();
  const store = openStore(caseFolder());
  await store.batch('review', [1, 2, 3, 4].map((n) => ({ op: 'set', path: `rows/r${n}`, data: { n, tags: n % 2 ? ['odd'] : ['even'] } })));
  const { documents, next_cursor: cursor } = store.query('review', 'rows', { where: [['n', 'gte', 2], ['tags', 'array-contains', 'even']], order_by: { field: 'n', direction: 'desc' }, limit: 1 });
  assert.deepEqual(documents.map((doc) => doc.data.n), [4]);
  assert.equal(cursor, undefined);
  const first = store.list('review', 'rows', { limit: 3 });
  assert.equal(first.next_cursor, 'r3');
  assert.deepEqual(store.list('review', 'rows', { cursor: first.next_cursor }).documents.map((doc) => doc.id), ['r4']);
});

test('case views are readable and not writable', async () => {
  const { openStore } = await load();
  const store = openStore(caseFolder());
  const okf = store.list('case', 'okf').documents;
  assert.deepEqual(okf.map((doc) => Buffer.from(doc.id, 'base64url').toString()), ['Pièces/contrat.md']);
  assert.equal(store.get('case', okf[0].path).data.title, 'Contrat Société Exemple SAS');
  assert.equal(store.get('case', 'deadlines/assignation').data.matter.client, 'Jean Dupont');
  assert.equal(store.get('case', 'memories/assignation').data.text, '# Assignation\n');
  await rejects(store.set('case', 'deadlines/assignation', { a: 1 }), 'permission_denied');
  await rejects(store.set('case', 'memories/assignation', { a: 1 }), 'permission_denied');
  await rejects(store.update('case', okf[0].path, { title: 'x' }), 'permission_denied');
  await store.set('case', 'notes/n1', { a: 1 });
});

test('comments open, reply and resolve', async () => {
  const { openComments } = await load();
  const comments = openComments(caseFolder());
  const thread = await comments.open('deadlines', { tab: 'suivi_dossiers', file: '.piecemaker/assignation-suivi.json', start: 3, end: 5 }, 'Vérifier ce délai');
  await comments.reply('deadlines', thread.id, 'Délai corrigé');
  assert.equal(comments.read('deadlines')[0].messages.length, 2);
  await comments.resolve('deadlines', thread.id);
  await comments.reply('deadlines', thread.id, 'Précision');
  assert.equal(comments.read('deadlines', thread.id)[0].resolved, true);
  await rejects(comments.reply('deadlines', thread.id, 'x'.repeat(4097)), 'invalid_argument');
});

test('comments open with a given id, once', async () => {
  const { openComments } = await load();
  const comments = openComments(caseFolder());
  assert.equal((await comments.open('deadlines', null, 'Relire', 'lawyer', 'ab12cd34')).id, 'ab12cd34');
  await rejects(comments.open('deadlines', null, 'Relire', 'lawyer', 'ab12cd34'), 'conflict');
  await rejects(comments.open('deadlines', null, 'Relire', 'lawyer', '../x'), 'invalid_argument');
});
