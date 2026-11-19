import type { ChatMessage, Widget } from '../../../server/modules/piecemaker-orchestrateur/types.js';
import { button, card, el, threadCard, type Actions, type State } from './ui.js';

function widgetCard(w: Widget, id: string, actions: Actions) {
  const node = card(w.title ?? {draft: 'Brouillon', buttons: 'Choix', comparison: 'Comparaison', steps: 'Étapes'}[w.type]);
  if (w.body) node.append(el('p', w.body));
  const draft = el('textarea');
  if (w.draft) {
    draft.defaultValue = w.state?.text ?? w.draft.body;
    draft.dataset.draft = id;
    node.append(el('p', [w.draft.to, w.draft.subject].filter(Boolean).join(' · ')), el('label', 'Texte du brouillon', draft));
  }
  if (w.rows) {
    const table = el('table', el('thead', el('tr', el('th'), ...(w.columns ?? []).map(c => el('th', c)))));
    for (const row of w.rows) table.append(el('tr', el('th', row.label), ...row.cells.map(c => el('td', c))));
    node.append(table);
  }
  if (w.steps) node.append(el('ol', ...w.steps.map(s => el('li', s.label + ' · ' + {todo: 'À faire', doing: 'En cours', done: 'Terminé'}[s.status]))));
  for (const b of w.buttons ?? (w.draft ? [{label: 'Envoyer le brouillon', action_id: 'envoyer'}] : [])) {
    const control = button(b.label, () => actions.save('widget', {messageId: id, actionId: b.action_id, text: w.draft ? draft.value : undefined}));
    if (b.style) control.classList.add('ptr-button-' + b.style);
    control.setAttribute('aria-pressed', String(w.state?.clicked === b.action_id));
    node.append(control);
  }
  return node;
}

export function messageCard(m: ChatMessage, state: State, actions: Actions) {
  const row = el('article', el('small', m.authorName ?? {user: 'Vous', orchestrator: 'Orchestrateur', system: 'Système'}[m.author]));
  row.className = 'pmp-message';
  row.dataset.author = m.author;
  if (m.text) row.append(el('p', m.text));
  const thread = state.threads.find(t => t.id === m.threadId);
  if (thread) row.append(threadCard(thread));
  for (const id of m.decisionIds) {
    const d = state.decisions.find(item => item.id === id);
    if (!d) continue;
    const group = card(d.question);
    if (d.reason) group.append(el('p', d.reason));
    for (const [option, item] of d.options.entries()) {
      const label = [item.label, option === d.recommended && 'Recommandée', option === d.chosen && 'Choisie'].filter(Boolean).join(' · ');
      group.append(el('div', button(label, () => actions.save('decision', {decisionId: id, option}), Boolean(d.closedBy)), el('p', item.consequence)));
    }
    if (d.withdrawn) group.append('Décision retirée');
    row.append(group);
  }
  function approval(path: string, title: string, detail: string, status: string) {
    const group = card(title, el('p', detail));
    if (status === 'pending') {
      for (const allow of [true, false]) group.append(button(allow ? (path === 'setup' ? 'Accepter' : 'Autoriser') : 'Refuser',
        () => actions.save(path, {messageId: m.id, [path === 'setup' ? 'accept' : 'allow']: allow})));
    } else group.append(({allowed: 'Autorisé', denied: 'Refusé', accepted: 'Acceptée', declined: 'Refusée', resolved: 'Traitée'})[status] ?? status);
    row.append(group);
  }
  if (m.approval) approval('approval', m.approval.toolName, JSON.stringify(m.approval.input, null, 2), m.approval.status);
  if (m.folderRequest) approval('folder', 'Accès au dossier', m.folderRequest.folder, m.folderRequest.status);
  if (m.setup) approval('setup', 'Mise en route', [m.setup.instructions, ...m.setup.threads.map(t => [t.title, t.provider, t.instructions].filter(Boolean).join(' · '))].filter(Boolean).join('\n'), m.setup.status);
  if (m.widget) row.append(widgetCard(m.widget, m.id, actions));
  if (m.connect) {
    const target = m.connect.target;
    row.append(card(target, button((m.connect.reconnect ? 'Reconnecter ' : 'Connecter ') + target, () => {
      window.dispatchEvent(new CustomEvent('piecemaker:open-settings', {detail: {tab: 'agents'}}));
      if (['claude', 'codex', 'mistral'].includes(target.toLowerCase())) requestAnimationFrame(() => {
        const controls = document.querySelectorAll<HTMLButtonElement>('[role=dialog] button');
        Array.from(controls).find(b => b.textContent?.trim().toLowerCase() === target.toLowerCase())?.click();
      });
    })));
  }
  for (const output of m.attachments) row.append(card({file: 'Fichier', artifact: 'Artifact', link: 'Lien'}[output.kind],
    button(output.title ?? output.ref, () => actions.open(output))));
  const reactions = el('div');
  for (const emoji of new Set([...m.reactions.map(r => r.emoji), '👍', '👎'])) {
    const current = m.reactions.filter(r => r.emoji === emoji);
    const mine = current.some(r => r.by === 'user');
    const control = button(emoji + (current.length ? ' ' + current.length : ''), () => actions.save('react', {messageId: m.id, emoji, on: !mine}));
    control.setAttribute('aria-pressed', String(mine));
    reactions.append(control);
  }
  row.append(reactions);
  return row;
}
