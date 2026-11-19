import { afterEach, expect, it, vi } from 'vitest';
import { mount, unmount } from '../client.js';

const project = '/dossiers/exemple';
const container = document.createElement('div');

function setup() {
  const state = {
    revision: 1, messages: [] as object[], threads: [] as object[], decisions: [] as object[], deliverables: [] as object[], files: [], schedules: [],
    settings: {instructions: '', folders: [], defaultModels: {}, defaultProvider: 'auto', orchestratorProvider: 'auto', orchestratorModel: '', concurrency: {claude: 3, codex: 3, mistral: 3}},
    memory: {revision: 1, text: 'Version initiale'}, providers: [],
  };
  const writes: {url: string; method: string; body: object}[] = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    if (!init.body) return Response.json(state);
    writes.push({url, method: init.method!, body: JSON.parse(String(init.body))});
    if (url.endsWith('/memory')) return Response.json({error: 'Révision périmée'}, {status: 400});
    return Response.json({});
  });
  vi.stubGlobal('fetch', fetch);
  document.body.append(container);
  mount(container, {context: {project: {name: 'Exemple', path: project}, theme: 'light', session: null}, rpc: vi.fn(), onContextChange: () => () => {}});
  return {state, writes, fetch};
}

const click = (label: string) => {
  const control = Array.from(container.querySelectorAll('button')).find(b => b.textContent === label);
  expect(control).toBeDefined();
  control!.click();
};

afterEach(() => {
  unmount(container);
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('conserve le message pendant la relève, puis envoie par Entrée et suspend la relève dans un volet masqué', async () => {
  vi.useFakeTimers();
  const {writes, fetch} = setup();
  await vi.advanceTimersByTimeAsync(0);
  const input = container.querySelector('form textarea') as HTMLTextAreaElement;
  input.value = 'Première ligne';
  const newline = new KeyboardEvent('keydown', {key: 'Enter', shiftKey: true, cancelable: true});
  input.dispatchEvent(newline);
  expect(newline.defaultPrevented).toBe(false);
  container.hidden = true;
  await vi.advanceTimersByTimeAsync(4000);
  expect(fetch).toHaveBeenCalledTimes(1);
  container.hidden = false;
  await vi.advanceTimersByTimeAsync(2000);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(input.value).toBe('Première ligne');
  input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', cancelable: true}));
  await vi.advanceTimersByTimeAsync(0);
  expect(writes).toEqual([{url: '/api/piecemaker/orchestrateur/message', method: 'POST', body: {project, text: 'Première ligne'}}]);
  expect(input.value).toBe('');
});

it('conserve la révision éditée lors d’une modification concurrente et permet de relire la mémoire', async () => {
  vi.useFakeTimers();
  const {state, writes} = setup();
  await vi.advanceTimersByTimeAsync(0);
  click('Paramètres');
  const memory = Array.from(container.querySelectorAll('label')).find(label => label.textContent === 'Mémoire du projet')!.querySelector('textarea')!;
  memory.value = 'Notes en cours';
  state.memory = {text: 'Nouvelle version', revision: 2};
  await vi.advanceTimersByTimeAsync(2000);
  click('Enregistrer la mémoire');
  await vi.advanceTimersByTimeAsync(0);
  expect(writes[0].body).toEqual({project, text: 'Notes en cours', revision: 1});
  expect(container.querySelector('[role=alert]')?.textContent).toContain('Révision périmée');
  expect(memory.value).toBe('Notes en cours');
  click('Relire la mémoire enregistrée');
  expect(memory.value).toBe('Nouvelle version');
});

it('rattache la décision au post et désactive les options après le choix confirmé', async () => {
  vi.useFakeTimers();
  const {state, writes} = setup();
  const decision = {id: 'dec1', question: 'Quel format ?', options: [{label: 'Note', consequence: 'Texte court'}, {label: 'Tableau', consequence: 'Comparaison'}], recommended: 1, closedBy: null as string | null, chosen: null as number | null};
  state.decisions.push(decision);
  state.messages.push({id: 'post1', author: 'orchestrator', text: 'Choisissez le format.', attachments: [], decisionIds: ['dec1'], reactions: []});
  state.revision++;
  await vi.advanceTimersByTimeAsync(2000);
  click('Tableau · Recommandée');
  await vi.advanceTimersByTimeAsync(0);
  expect(writes[0].body).toEqual({project, decisionId: 'dec1', option: 1});
  decision.closedBy = 'user';
  decision.chosen = 1;
  state.revision++;
  await vi.advanceTimersByTimeAsync(2000);
  expect(container.querySelector('article')?.textContent).toContain('Tableau · Recommandée · Choisie');
  const chosen = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Choisie'));
  expect(chosen?.disabled).toBe(true);
});

it('ouvre la session du fil annoncé et conserve le rattachement du livrable après filtrage', async () => {
  vi.useFakeTimers();
  const {state, writes} = setup();
  const thread = {id: 'fil1', title: 'Préparer la note', provider: 'claude', sessionId: 'session-exemple', state: 'review_ready', updatedAt: '2026-01-01'};
  state.threads.push(thread, {...thread, id: 'fil2', title: 'Classer les pièces', state: 'working', updatedAt: '2026-01-02'});
  state.messages.push({id: 'ack', author: 'orchestrator', text: 'Préparation lancée.', attachments: [], decisionIds: [], threadId: 'fil1', reactions: []});
  state.deliverables.push({id: 'doc1', threadId: 'fil1', kind: 'document', ref: 'note.md', title: 'Note', state: 'a_relire'});
  state.revision++;
  await vi.advanceTimersByTimeAsync(2000);
  container.querySelector<HTMLButtonElement>('article button')!.click();
  expect(location.pathname).toBe('/session/session-exemple');
  click('Vue d’ensemble');
  const sections = container.querySelectorAll('main section');
  expect(sections[0].textContent).toContain('Classer les pièces');
  const filter = container.querySelector('main select') as HTMLSelectElement;
  filter.value = 'review_ready';
  filter.dispatchEvent(new Event('change'));
  expect(container.querySelector('main')?.textContent).not.toContain('Classer les pièces');
  click('Valider');
  await vi.advanceTimersByTimeAsync(0);
  expect(writes[0]).toEqual({url: '/api/piecemaker/orchestrateur/deliverable', method: 'PUT', body: {project, id: 'doc1', state: 'valide'}});
});
