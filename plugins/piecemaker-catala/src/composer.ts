type Card = { titre: string; fichier?: string; debut?: number; fin?: number };
type Pending = { target: HTMLTextAreaElement; original: string; full: string };

const PICK_EVENT = 'piecemaker:catala-card-pick';
const FORM = 'form[data-slot="prompt-input"]';
const FIELD = 'textarea[data-slot="prompt-input-textarea"]';
const WATCH_INTERVAL = 200;
const WATCH_ROUNDS = 150;

const STYLES = `
.pmc-chips{display:flex;flex-wrap:wrap;gap:6px;width:100%;padding:8px 12px 0}
.pmc-chips[hidden]{display:none}
.pmc-chip{display:inline-flex;align-items:center;gap:6px;max-width:100%;padding:2px 4px 2px 10px;border:1px solid hsl(var(--border));border-radius:999px;background:hsl(var(--muted));color:hsl(var(--foreground));font-size:12px;line-height:20px}
.pmc-chip>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pmc-chip>button{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border:0;border-radius:999px;background:none;color:hsl(var(--muted-foreground));font-size:14px;line-height:1;cursor:pointer}
.pmc-chip>button:hover{background:hsl(var(--border));color:hsl(var(--foreground))}
`;

const escape = (text: string) => text.replace(/[&<>"]/g, (sign) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[sign]!);
const place = (card: Card) => (card.fichier && card.debut ? `${card.fichier}, ${card.fin && card.fin > card.debut ? `lignes ${card.debut} à ${card.fin}` : `ligne ${card.debut}`}` : '');

export function cardReference(card: Card): string {
  const label = `Carte « ${card.titre.replace(/[[\]]/g, '')} »`;
  if (!card.fichier || !card.debut) return label;
  return `[${label}](${card.fichier}:${card.debut}${card.fin && card.fin > card.debut ? ` "lignes ${card.debut} à ${card.fin}"` : ''})`;
}

export function inject(): () => void {
  let cards: Card[] = [];
  let pending: Pending | null = null;
  let watch = 0;
  const style = document.createElement('style');
  style.textContent = STYLES;
  document.head.append(style);
  const row = document.createElement('div');
  row.className = 'pmc-chips';
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
    row.innerHTML = cards.map((card, index) => `<span class="pmc-chip" title="${escape(place(card))}"><span>Carte « ${escape(card.titre)} »</span><button type="button" data-remove="${index}" aria-label="Retirer la carte">×</button></span>`).join('');
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
    const card = (event as CustomEvent<Card>).detail;
    if (!card?.titre) return;
    if (!cards.some((other) => other.titre === card.titre && other.fichier === card.fichier && other.debut === card.debut)) cards.push(card);
    paint();
    field()?.focus();
  };
  const remove = (event: Event) => {
    const index = (event.target as Element).closest<HTMLElement>('[data-remove]')?.dataset.remove;
    if (index === undefined) return;
    cards.splice(Number(index), 1);
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
    const full = [original.trimEnd(), cards.map(cardReference).join('\n')].filter(Boolean).join('\n\n');
    stopWatch();
    write(target, full);
    pending = { target, original, full };
  };
  const settled = (event: Event) => {
    if (!pending) return;
    const { target, original, full } = pending;
    pending = null;
    if (target.value === full) write(target, original);
    if (event.type !== 'submit' && !event.defaultPrevented) return;
    if (target.value === '') clear();
    else startWatch();
  };
  const typed = (event: Event) => { if (event.isTrusted) stopWatch(); };

  const observer = new window.MutationObserver(attach);
  observer.observe(document.body, { childList: true, subtree: true });
  row.addEventListener('click', remove);
  window.addEventListener(PICK_EVENT, pick);
  window.addEventListener('input', typed, true);
  for (const type of ['keydown', 'click', 'submit']) {
    window.addEventListener(type, sending, true);
    window.addEventListener(type, settled);
  }
  attach();

  return () => {
    observer.disconnect();
    stopWatch();
    window.removeEventListener(PICK_EVENT, pick);
    window.removeEventListener('input', typed, true);
    for (const type of ['keydown', 'click', 'submit']) {
      window.removeEventListener(type, sending, true);
      window.removeEventListener(type, settled);
    }
    row.remove();
    style.remove();
  };
}
