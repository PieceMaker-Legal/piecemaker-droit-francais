import type { SuiviDossier } from '../../../shared/piecemaker-suivi.js';
import { loadAll, loadBoardPage, verifySuivi } from './api.js';
import { withBoardShim } from './board-shim.js';
import { STYLES } from './styles.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void };

const REFRESH_MS = 5000;
const REPORT_PROMPT = 'Rédige un état des dossiers : d’abord ce qui demande attention, puis un court paragraphe par dossier ouvert.';
const cleanups = new WeakMap<HTMLElement, () => void>();

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;
const undated = (dossier: SuiviDossier) => dossier.snapshot.echeances.filter((deadline) => !deadline.date);
const issuesOf = (dossier: SuiviDossier, kind: 'erreur' | 'manque') => dossier.snapshot.issues.filter((issue) => issue.kind === kind);

const dossierHtml = (dossier: SuiviDossier) => {
  const issues = dossier.snapshot.issues.filter((issue) => issue.kind === 'erreur' || issue.kind === 'manque');
  return `<li class="pme-dossier">
    <div class="pme-dossier-head"><strong>${escape(dossier.nom)}</strong>
      <button type="button" data-verify="${escape(dossier.projectPath)}" data-suivi="${escape(dossier.fichier)}">Revérifier</button>
      ${dossier.session ? `<button type="button" data-open="${escape(dossier.session)}">Ouvrir le dossier</button>` : ''}
    </div>
    ${issues.length ? `<ul>${issues.map((issue) => `<li class="pme-${issue.kind}">${escape(issue.avocat ?? issue.text)}</li>`).join('')}</ul>` : ''}
    ${undated(dossier).length ? `<ul>${undated(dossier).map((deadline) => `<li class="pme-manque">Date à établir : ${escape(deadline.intitule)}</li>`).join('')}</ul>` : ''}
  </li>`;
};

const bandHtml = (dossiers: SuiviDossier[], open: boolean) => {
  const errors = dossiers.reduce((sum, dossier) => sum + issuesOf(dossier, 'erreur').length, 0);
  const gaps = dossiers.reduce((sum, dossier) => sum + issuesOf(dossier, 'manque').length, 0);
  const pending = dossiers.reduce((sum, dossier) => sum + undated(dossier).length, 0);
  const counts = [plural(dossiers.length, 'dossier'), errors ? plural(errors, 'erreur') : '', gaps ? `${plural(gaps, 'point')} à compléter` : '', pending ? `${plural(pending, 'date')} à établir` : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="pme-prompt" data-prompt title="${escape(REPORT_PROMPT)}">Rédiger un état des dossiers</button><details data-band${open ? ' open' : ''}><summary class="${errors ? 'pme-erreur' : ''}">${escape(counts)}</summary><ul class="pme-dossiers">${dossiers.map(dossierHtml).join('')}</ul></details>`;
};

export function mount(container: HTMLElement, api: Host) {
  const style = document.createElement('style');
  style.textContent = STYLES;
  const root = document.createElement('section');
  root.className = 'pme piecemaker-ui';
  root.setAttribute('aria-label', 'Suivi des dossiers');
  const band = document.createElement('div');
  band.className = 'pme-band';
  const frame = document.createElement('iframe');
  frame.className = 'pme-frame';
  frame.title = 'Matter board';
  frame.allow = 'clipboard-write';
  root.append(band, frame);
  container.replaceChildren(style, root);

  let last = '';
  let open = false;
  let pageUrl = '';
  const refresh = async () => {
    const dossiers = await loadAll();
    const signature = JSON.stringify(dossiers.map((dossier) => [dossier.projectPath, dossier.fichier, dossier.nom, dossier.session, dossier.snapshot.issues, undated(dossier).map((deadline) => deadline.intitule)]));
    if (signature === last) return;
    last = signature;
    band.innerHTML = dossiers.length ? bandHtml(dossiers, open) : '';
  };
  const applyTheme = (theme: Context['theme']) => {
    root.dataset.theme = theme;
    const page = frame.contentDocument?.documentElement;
    if (page) page.dataset.theme = theme;
  };
  frame.addEventListener('load', () => applyTheme(api.context.theme));
  band.addEventListener('toggle', (event) => { open = (event.target as HTMLDetailsElement).open; }, true);
  band.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) return;
    if ('prompt' in button.dataset) window.dispatchEvent(new CustomEvent('piecemaker:composer-insert', { detail: { text: REPORT_PROMPT } }));
    if (button.dataset.verify) {
      button.disabled = true;
      void verifySuivi(button.dataset.verify, button.dataset.suivi ?? '').then(refresh).catch(() => undefined).finally(() => { button.disabled = false; });
    }
    if (button.dataset.open) {
      window.history.pushState({}, '', `/session/${button.dataset.open}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  });
  const unsubscribe = api.onContextChange((context) => applyTheme(context.theme));
  const poll = () => { if (document.visibilityState === 'visible') void refresh().catch(() => undefined); };
  const timer = window.setInterval(poll, REFRESH_MS);
  document.addEventListener('visibilitychange', poll);
  applyTheme(api.context.theme);
  poll();
  void loadBoardPage().then((html) => {
    pageUrl = URL.createObjectURL(new Blob([withBoardShim(html)], { type: 'text/html' }));
    frame.src = `${pageUrl}#/p/cabinet`;
  }).catch((error: unknown) => { band.textContent = error instanceof Error ? error.message : 'Tableau indisponible.'; });
  cleanups.set(container, () => {
    unsubscribe();
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', poll);
    if (pageUrl) URL.revokeObjectURL(pageUrl);
    container.replaceChildren();
  });
}

export function unmount(container: HTMLElement) {
  cleanups.get(container)?.();
  cleanups.delete(container);
}
