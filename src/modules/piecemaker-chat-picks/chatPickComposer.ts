import { activeProject } from '@/piecemaker/chat/fileRef';
import { authenticatedFetch } from '@/shared/api';

type Card = { titre: string; tab?: string; comment?: boolean; nature?: string; note?: string; fichier?: string; debut?: number; fin?: number; identifiant?: string; valeur?: string; scenario?: string; demande?: string };
type Thread = { card: Card; feature: string; id: string };
type Pending = { target: HTMLTextAreaElement; original: string; full: string; threads: Thread[] };

const CATALA_TAB = 'plugin:piecemaker-catala';
const CATALA_CARD_EVENT = 'piecemaker:catala-card-pick';
const PICK_EVENTS = ['piecemaker:chat-pick', CATALA_CARD_EVENT];
const FORM = 'form[data-slot="prompt-input"]';
const FIELD = 'textarea[data-slot="prompt-input-textarea"]';
const WATCH_INTERVAL = 200;
const WATCH_ROUNDS = 150;

const STYLES = `
.pmc-picks{display:flex;flex-wrap:wrap;gap:6px;width:100%;padding:8px 12px 0}
.pmc-picks[hidden]{display:none}
.pmc-pick{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 4px 2px 10px;border:1px solid hsl(var(--border));border-radius:999px;background:hsl(var(--muted));color:hsl(var(--foreground));font-size:12px;line-height:20px}
.pmc-pick>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pmc-pick>button{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:0;border-radius:999px;background:none;color:hsl(var(--muted-foreground));font-size:14px;line-height:1;cursor:pointer}
.pmc-pick[data-commented]{border-color:hsl(var(--primary))}
.pmc-pick>button[aria-pressed="true"]{background:hsl(var(--primary));color:hsl(var(--primary-foreground))}
.pmc-pick>button:hover{background:hsl(var(--border));color:hsl(var(--foreground))}
`;

const escape = (text: string) => text.replace(/[&<>"]/g, (sign) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[sign]!);
const heading = (card: Card) => `${card.nature || 'Carte'} « ${card.titre.replace(/[[\]]/g, '')} »`;
const lines = (card: Card) => (card.debut ? (card.fin && card.fin > card.debut ? `lignes ${card.debut} à ${card.fin}` : `ligne ${card.debut}`) : '');
const featureOf = (card: Card) => (card.tab === CATALA_TAB ? 'catala' : 'case');
const threadLine = (thread: Thread) => `${cardReference(thread.card)} — commentaire : FeatureComments read feature=${thread.feature} thread_id=${thread.id}`;
const place = (card: Card) => [card.fichier, card.fichier && lines(card)].filter(Boolean).join(', ');

export function cardReference(card: Card): string {
  if (card.demande) return card.demande;
  const label = heading(card);
  const link = card.fichier ? `[${label}](${card.fichier}${card.debut ? `:${card.debut}` : ''}${card.fin && card.debut && card.fin > card.debut ? ` "${lines(card)}"` : ''})` : label;
  const name = card.identifiant ? `\`${card.identifiant.replace(/`/g, '')}\`` : '';
  const value = card.valeur ? `${name ? '= ' : 'valeur '}${card.valeur.replace(/\s+/g, ' ').trim()}` : '';
  const state = [[name, value].filter(Boolean).join(' '), card.scenario && value ? `scénario ${card.scenario}` : ''].filter(Boolean).join(', ');
  return [link, state, card.note?.replace(/\s+/g, ' ').trim()].filter(Boolean).join(' — ');
}

export function startChatPickComposer(): () => void {
  let cards: Card[] = [];
  let pending: Pending | null = null;
  let watch = 0;
  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.append(style);
  const row = document.createElement('div');
  row.className = 'pmc-picks';
  row.hidden = true;

  const field = () => document.querySelector<HTMLTextAreaElement>(`${FORM} ${FIELD}`);
  const write = (target: HTMLTextAreaElement, value: string) => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(target, value);
    target.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const attach = () => {
    const form = document.querySelector(FORM);
    if (form && row.parentElement !== form) form.prepend(row);
  };
  const paint = () => {
    row.hidden = !cards.length;
    row.innerHTML = cards.map((card, index) => `<span class="pmc-pick"${card.comment ? ' data-commented' : ''} title="${escape(place(card))}"><span>${escape(card.demande ? card.titre : heading(card))}</span>${card.demande ? '' : `<button type="button" data-comment="${index}" aria-pressed="${Boolean(card.comment)}" aria-label="Commenter">💬</button>`}<button type="button" data-remove="${index}" aria-label="Retirer">×</button></span>`).join('');
    attach();
  };
  const stopWatch = () => { window.clearInterval(watch); watch = 0; };
  const clear = () => { stopWatch(); cards = []; paint(); };
  const startWatch = () => {
    stopWatch();
    let rounds = 0;
    watch = window.setInterval(() => {
      if (field()?.value === '') clear();
      else if (++rounds >= WATCH_ROUNDS) stopWatch();
    }, WATCH_INTERVAL);
  };

  const pick = (event: Event) => {
    const detail = (event as CustomEvent<Card>).detail;
    if (!detail?.titre) return;
    const card = { ...detail, tab: detail.tab ?? (event.type === CATALA_CARD_EVENT ? CATALA_TAB : undefined) };
    if (card.demande) cards = cards.filter((other) => !other.demande);
    if (!cards.some((other) => other.titre === card.titre && other.fichier === card.fichier && other.debut === card.debut)) cards.push(card);
    paint();
    field()?.focus();
  };
  const remove = (event: Event) => {
    const button = (event.target as Element).closest<HTMLElement>('[data-remove], [data-comment]');
    if (!button) return;
    if (button.dataset.comment !== undefined) cards[Number(button.dataset.comment)].comment = !cards[Number(button.dataset.comment)].comment;
    else cards.splice(Number(button.dataset.remove), 1);
    paint();
  };
  const sending = (event: Event) => {
    if (!cards.length || pending) return;
    const target = field();
    const origin = event.target as Element | null;
    if (!target || !origin) return;
    if (event.type === 'keydown') {
      const key = event as KeyboardEvent;
      if (origin !== target || key.key !== 'Enter' || key.shiftKey || key.isComposing) return;
    } else if (event.type === 'click') {
      if (!origin.closest?.(`${FORM} button[type="submit"]`)) return;
    } else if (!origin.matches?.(FORM)) return;
    const original = target.value;
    const threads = cards.filter((card) => card.comment).map((card) => ({ card, feature: featureOf(card), id: window.crypto.randomUUID().slice(0, 8) }));
    const full = [original.trimEnd(), cards.map((card) => { const thread = threads.find((entry) => entry.card === card); return thread ? threadLine(thread) : cardReference(card); }).join('\n')].filter(Boolean).join('\n\n');
    stopWatch();
    write(target, full);
    pending = { target, original, full, threads };
  };
  const settled = (event: Event) => {
    if (!pending) return;
    const { target, original, full, threads } = pending;
    pending = null;
    if (target.value === full) write(target, original);
    if (event.type !== 'submit' && !event.defaultPrevented) return;
    for (const thread of threads) {
      thread.card.comment = false;
      const { tab, titre: title, nature: kind, fichier: file, debut: start, fin: end } = thread.card;
      void authenticatedFetch(`/api/piecemaker/feature-comments?${new URLSearchParams({ projectId: activeProject() })}`, {
        method: 'POST',
        body: JSON.stringify({ feature: thread.feature, id: thread.id, text: original.trim() || heading(thread.card), anchor: { tab, title, kind, file, start, end } }),
      }).catch(() => undefined);
    }
    if (threads.length) paint();
    if (target.value === '') clear();
    else startWatch();
  };
  const typed = (event: Event) => { if (event.isTrusted) stopWatch(); };

  const observer = new window.MutationObserver(attach);
  observer.observe(document.body, { childList: true, subtree: true });
  row.addEventListener('click', remove);
  for (const type of PICK_EVENTS) window.addEventListener(type, pick);
  window.addEventListener('input', typed, true);
  for (const type of ['keydown', 'click', 'submit']) {
    window.addEventListener(type, sending, true);
    window.addEventListener(type, settled);
  }
  attach();

  return () => {
    observer.disconnect();
    stopWatch();
    for (const type of PICK_EVENTS) window.removeEventListener(type, pick);
    window.removeEventListener('input', typed, true);
    for (const type of ['keydown', 'click', 'submit']) {
      window.removeEventListener(type, sending, true);
      window.removeEventListener(type, settled);
    }
    row.remove();
    style.remove();
  };
}
