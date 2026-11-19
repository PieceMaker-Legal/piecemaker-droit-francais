import type { createOrchestratorService } from '../../../server/modules/piecemaker-orchestrateur/service.js';
import type { Output, Thread } from '../../../server/modules/piecemaker-orchestrateur/types.js';
import { ouvrirSession } from '../../piecemaker-echeances/src/navigation.js';

export type State = Awaited<ReturnType<ReturnType<typeof createOrchestratorService>['state']>>;
export type Actions = {
  save(path: string, data: object, method?: string): Promise<boolean>;
  open(output: Output): void;
};

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, ...children: (Node | string)[]) {
  const node = document.createElement(tag);
  node.append(...children);
  return node;
}

export function button(text: string, click: () => unknown, disabled = false) {
  const node = el('button', text);
  node.type = 'button';
  node.className = 'ptr-button';
  node.onclick = click;
  node.disabled = disabled;
  return node;
}

export function card(title: string, ...children: (Node | string)[]) {
  const node = el('section', el('strong', title), ...children);
  node.className = 'pmp-card';
  return node;
}

export const states = { queued: 'En attente', working: 'En cours', blocked: 'Bloqué', review_ready: 'À relire', done: 'Résolu', failed: 'Échec', stopped: 'Arrêté' };

export function threadCard(thread: Thread) {
  const node = button(thread.title, () => thread.sessionId && ouvrirSession(thread.sessionId), !thread.sessionId);
  const status = el('span', states[thread.state]);
  status.className = 'pmp-status';
  status.dataset.state = thread.state;
  node.className = 'pmp-thread';
  node.append(status, el('small', thread.provider));
  return node;
}

export function select(options: {value: string; label: string; disabled?: boolean}[], value: string) {
  const node = el('select');
  node.className = 'ptr-select';
  for (const option of options) {
    const item = new Option(option.label, option.value);
    item.disabled = Boolean(option.disabled);
    node.add(item);
  }
  node.value = value;
  return node;
}

export function overview(state: State, filter: string, change: (value: string) => void, actions: Actions) {
  const menu = select([{value: '', label: 'Tous les états'}, ...Object.entries(states).map(([value, label]) => ({value, label}))], filter);
  menu.onchange = () => change(menu.value);
  const page = el('div', el('label', 'État des fils', menu));
  function outputs(id: string | null) {
    return state.deliverables.filter(d => d.threadId === id).map(d => {
      const output: Output = { kind: d.kind === 'artifact' ? 'artifact' : 'file', ref: d.ref, title: d.title };
      const row = el('div', button(d.title, () => actions.open(output)), {brouillon: 'Brouillon', a_relire: 'À relire', valide: 'Validé'}[d.state]);
      if (d.state !== 'valide') row.append(button('Valider', () => actions.save('deliverable', {id: d.id, state: 'valide'}, 'PUT')));
      return row;
    });
  }
  const threads = state.threads.filter(t => !filter || t.state === filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const t of threads) {
    const group = el('section', threadCard(t), ...outputs(t.id));
    group.className = 'pmp-card';
    group.append(el('div', button(t.resolved ? 'Rouvrir' : 'Résoudre', () => actions.save('thread/resolve', {threadId: t.id, resolved: !t.resolved})),
      button('Arrêter', () => actions.save('thread/stop', {threadId: t.id}), !['working', 'blocked', 'queued'].includes(t.state))));
    page.append(group);
  }
  if (!threads.length) page.append(el('p', 'Aucun fil pour cet état.'));
  const standalone = outputs(null);
  if (standalone.length) page.append(card('Livrables du projet', ...standalone));
  return page;
}
