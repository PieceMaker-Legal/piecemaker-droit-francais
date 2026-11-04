import { PLUGIN_STYLES } from '../../piecemaker-tabular-review/src/client/styles.js';
import type { SuiviDossier } from '../../../shared/piecemaker-suivi.js';
import { loadAll, loadBoardPage, verifySuivi } from './api.js';
import { withBoardShim } from './board-shim.js';
import { ouvrirSession } from './navigation.js';
import { STYLES } from './styles.js';
import { createTableau } from './tableau.js';
import { createTaches } from './taches.js';
import { createTelephone } from './telephone.js';

type Context = { theme: 'dark' | 'light'; project: { name: string; path: string } | null };
type Host = { readonly context: Context; onContextChange(callback: (context: Context) => void): () => void };

const REFRESH_MS = 5000;
const VUES = [['tableau', 'Tableau'], ['taches', 'Tâches'], ['echeances', 'Échéances']] as const;
type Vue = typeof VUES[number][0];
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
  style.textContent = PLUGIN_STYLES + STYLES;
  const root = document.createElement('section');
  root.className = 'pme ptr-root piecemaker-ui';
  root.setAttribute('aria-label', 'Suivi des dossiers');
  const tabs = document.createElement('nav');
  tabs.className = 'pme-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.innerHTML = `<div class="pme-segmented">${VUES.map(([vue, libelle]) => `<button type="button" role="tab" class="pme-tab" data-vue="${vue}">${libelle}</button>`).join('')}</div>`;
  tabs.append(createTelephone(root));
  const tableau = createTableau(root, () => api.context.project?.path ?? null);
  const taches = createTaches(root, tableau.ouvrirDossier);
  const echeances = document.createElement('div');
  echeances.className = 'pme-view pme-view--frame';
  const band = document.createElement('div');
  band.className = 'pme-band';
  const frame = document.createElement('iframe');
  frame.className = 'pme-frame';
  frame.title = 'Matter board';
  frame.allow = 'clipboard-write';
  echeances.append(band, frame);
  const zone = document.createElement('div');
  zone.className = 'pme-zone';
  zone.append(tableau.element, taches.element, echeances, tableau.drawer);
  root.append(tabs, zone);
  container.replaceChildren(style, root);

  let vue: Vue = 'tableau';
  let last = '';
  let open = false;
  let pageUrl = '';
  const refreshEcheances = async () => {
    const dossiers = await loadAll();
    const signature = JSON.stringify(dossiers.map((dossier) => [dossier.projectPath, dossier.fichier, dossier.nom, dossier.session, dossier.snapshot.issues, undated(dossier).map((deadline) => deadline.intitule)]));
    if (signature === last) return;
    last = signature;
    band.innerHTML = dossiers.length ? bandHtml(dossiers, open) : '';
  };
  const refreshVue = () => vue === 'taches' ? taches.refresh() : vue === 'echeances' ? refreshEcheances() : null;
  const refresh = () => Promise.all([vue === 'tableau' || tableau.panneauOuvert() ? tableau.refresh() : null, refreshVue()]);
  const show = (next: Vue) => {
    vue = next;
    tabs.querySelectorAll<HTMLElement>('[data-vue]').forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.vue === vue)));
    tableau.element.hidden = vue !== 'tableau';
    taches.element.hidden = vue !== 'taches';
    echeances.hidden = vue !== 'echeances';
    if (polling) void Promise.resolve(refreshVue()).catch(() => undefined);
    poll();
  };
  const applyTheme = (theme: Context['theme']) => {
    root.dataset.theme = theme;
    root.querySelectorAll('iframe').forEach((cadre) => {
      const page = cadre.contentDocument?.documentElement;
      if (page) page.dataset.theme = theme;
    });
  };
  const intercepter = (event: MouseEvent) => {
    const cible = event.target as HTMLElement;
    const id = cible.closest<HTMLElement>('.mcard[data-id]')?.dataset.id ?? cible.closest<HTMLElement>('[id^="row-"]')?.id.slice(4);
    if (!id || cible.closest('button, input, select, a[href^="http"]')) return;
    event.preventDefault();
    event.stopPropagation();
    tableau.ouvrirFiche(id);
  };
  tabs.addEventListener('click', (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[data-vue]');
    if (tab) show(tab.dataset.vue as Vue);
  });
  frame.addEventListener('load', () => {
    applyTheme(api.context.theme);
    frame.contentDocument?.addEventListener('click', intercepter, true);
  });
  band.addEventListener('toggle', (event) => { open = (event.target as HTMLDetailsElement).open; }, true);
  band.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest('button');
    if (!button) return;
    if ('prompt' in button.dataset) window.dispatchEvent(new CustomEvent('piecemaker:composer-insert', { detail: { text: REPORT_PROMPT } }));
    if (button.dataset.verify) {
      button.disabled = true;
      void verifySuivi(button.dataset.verify, button.dataset.suivi ?? '').then(refreshEcheances).catch(() => undefined).finally(() => { button.disabled = false; });
    }
    if (button.dataset.open) ouvrirSession(button.dataset.open);
  });
  const unsubscribe = api.onContextChange((context) => applyTheme(context.theme));
  let polling = false;
  function poll() {
    if (polling || document.visibilityState !== 'visible') return;
    polling = true;
    void refresh().catch(() => undefined).finally(() => { polling = false; });
  }
  const timer = window.setInterval(poll, REFRESH_MS);
  document.addEventListener('visibilitychange', poll);
  applyTheme(api.context.theme);
  show('tableau');
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
