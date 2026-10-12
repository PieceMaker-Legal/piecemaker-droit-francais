import type { MarkdownDocument, RowRequest } from '../shared.js';
import { REVIEW_FOLDER } from '../shared.js';
import type { App } from './app.js';
import { basename, errorMessage, escapeHtml, toast } from './dom.js';
import { openDrawer } from './drawer.js';
import { caseFiles } from './host.js';

type DraftRow = RowRequest & { key: string; checked: boolean };

type Entry = { key: string; markdown: string | null; piece: string | null; size: number | null };

type Conversion = { percent: number; queued: boolean; error?: string };

export type DocumentsOptions = {
  project: string;
  sorting: boolean;
  existing: Set<string>;
  onSubmit(rows: RowRequest[]): Promise<boolean | void> | boolean | void;
};

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const stripExtension = (value: string) => basename(value).replace(/\.[^.]+$/, '');

export function openDocumentsDrawer(app: App, options: DocumentsOptions): void {
  let entries: Entry[] | null = null;
  let projectId: string | null = null;
  const conversions = new Map<string, Conversion>();
  let converting = false;
  let error = '';
  let rows: DraftRow[] = [];
  let sequence = 0;
  let saving = false;
  let anchor: string | null = null;
  let shift = false;
  const drawer = openDrawer(app.root, 'Ajouter des documents');
  drawer.element.classList.add('ptr-drawer-wide');
  drawer.body.innerHTML = `
    <div data-documents-notice></div>
    <section class="ptr-panel">
      <div class="ptr-panel-header">
        <span data-docs-count>Documents du dossier</span>
        <input class="ptr-input" data-filter placeholder="Filtrer…" style="max-width:220px;height:1.6rem;margin-left:auto">
        <button type="button" class="ptr-button" data-browse title="Choisir les documents dans le Finder ou l’Explorateur Windows">Parcourir…</button>
        <button type="button" class="ptr-button" data-select-all>Tout</button>
        <button type="button" class="ptr-button" data-select-none>Aucun</button>
      </div>
      <div class="ptr-panel-body" data-docs></div>
    </section>
    <section class="ptr-panel">
      <div class="ptr-panel-header">
        <span data-rows-count>Lignes</span>
        <span class="ptr-spacer"></span>
        <button type="button" class="ptr-button" data-group title="Fusionner les lignes cochées en une seule ligne">Regrouper</button>
        <button type="button" class="ptr-button" data-ungroup title="Séparer les groupes cochés en une ligne par document">Dégrouper</button>
      </div>
      <div class="ptr-panel-body" data-rows></div>
    </section>
    <div class="ptr-drawer-footer"><span class="ptr-spacer"></span><button type="button" class="ptr-button" data-drawer-close>Annuler</button><button type="button" class="ptr-button ptr-button-primary" data-documents-submit>Enregistrer</button></div>`;
  const $ = <T extends HTMLElement>(selector: string) => drawer.body.querySelector<T>(selector)!;
  const filterInput = $<HTMLInputElement>('[data-filter]');
  const rowOf = (key: string) => rows.find((row) => row.documents.includes(key));
  const entryOf = (key: string) => entries?.find((entry) => entry.key === key);
  const pending = () => rows.some((row) => row.documents.some((key) => !entryOf(key)?.markdown));

  const visible = () => {
    const query = normalize(filterInput.value.trim());
    return (entries ?? []).filter((entry) => !(entry.markdown && options.existing.has(entry.markdown)) && !(entry.piece && options.existing.has(entry.piece)) && (!options.sorting || entry.piece) && (!query || normalize(entry.key).includes(query)));
  };

  function conversionHtml(key: string): string {
    const conversion = conversions.get(key);
    if (conversion?.error) return `<span class="ptr-small ptr-status-error" title="${escapeHtml(conversion.error)}">Conversion impossible</span>`;
    if (conversion) return conversion.queued ? '<span class="ptr-small ptr-muted">En attente de conversion</span>' : `<span class="ptr-progress ptr-progress-mini" title="Conversion en Markdown"><div data-progress="${escapeHtml(key)}" style="width:${conversion.percent}%"></div></span>`;
    return entryOf(key)?.markdown ? '' : '<span class="ptr-small ptr-muted">À convertir</span>';
  }

  function renderDocuments() {
    const target = $('[data-docs]');
    $('[data-docs-count]').textContent = entries ? `Documents du dossier (${visible().length})` : 'Documents du dossier';
    $('[data-documents-notice]').innerHTML = [
      error ? `<div class="ptr-error-box">${escapeHtml(error)}</div>` : '',
      options.sorting ? '<div class="ptr-muted ptr-small">Tri des pièces : seules les pièces du dossier sont proposées.</div>' : '',
    ].join('');
    if (!entries) {
      target.innerHTML = '<div class="ptr-empty"><span class="ptr-spinner"></span> Chargement…</div>';
      return;
    }
    const list = visible();
    if (!list.length) {
      target.innerHTML = `<div class="ptr-empty">${entries.length ? 'Aucun document à ajouter.' : 'Aucun document dans ce dossier.'}</div>`;
      return;
    }
    const groups = new Map<string, Entry[]>();
    for (const entry of list) {
      const folder = entry.key.includes('/') ? entry.key.slice(0, entry.key.lastIndexOf('/')) : '';
      groups.set(folder, [...(groups.get(folder) ?? []), entry]);
    }
    target.innerHTML = [...groups.entries()].map(([folder, group]) => `
      <div class="ptr-doc-group">${escapeHtml(folder || 'Racine du dossier')}</div>
      ${group.map((entry) => `
        <label class="ptr-doc" title="${escapeHtml(entry.markdown && entry.markdown !== entry.key ? `${entry.key} → ${entry.markdown}` : entry.key)}">
          <input type="checkbox" data-doc="${escapeHtml(entry.key)}"${rowOf(entry.key) ? ' checked' : ''}>
          <span>${escapeHtml(basename(entry.key))}</span>
          <span style="margin-left:auto;flex-shrink:0;display:inline-flex;align-items:center;gap:8px">${conversionHtml(entry.key)}${entry.size === null ? '' : `<span class="ptr-small ptr-muted">${Math.max(1, Math.round(entry.size / 1024))} Ko</span>`}</span>
        </label>`).join('')}`).join('');
  }

  function renderRows() {
    const target = $('[data-rows]');
    $('[data-rows-count]').textContent = `Lignes (${rows.length})`;
    $<HTMLButtonElement>('[data-group]').disabled = options.sorting || rows.filter((row) => row.checked).length < 2;
    $<HTMLButtonElement>('[data-ungroup]').disabled = !rows.some((row) => row.checked && row.documents.length > 1);
    $<HTMLButtonElement>('[data-documents-submit]').disabled = saving || !rows.length || pending();
    $<HTMLButtonElement>('[data-documents-submit]').textContent = pending() ? 'Conversion en cours…' : 'Enregistrer';
    if (!rows.length) {
      target.innerHTML = '<div class="ptr-empty">Cochez des documents : chacun devient une ligne. Cochez ensuite plusieurs lignes pour les regrouper.</div>';
      return;
    }
    target.innerHTML = rows.map((row) => `
      <div class="ptr-row-item" data-row="${row.key}">
        <input type="checkbox" data-row-check${row.checked ? ' checked' : ''} aria-label="Sélectionner la ligne" style="margin-top:6px">
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px">
          <input class="ptr-input" data-row-label value="${escapeHtml(row.label)}" aria-label="Nom de la ligne">
          <div class="ptr-row-docs" title="${escapeHtml(row.documents.join('\n'))}">${escapeHtml(row.documents.map(basename).join(' · '))}</div>
          ${row.documents.map(conversionHtml).filter(Boolean).join('')}
        </div>
        ${row.documents.length > 1 ? `<span class="ptr-group-badge">${row.documents.length} docs</span>` : ''}
        <button type="button" class="ptr-icon-button" data-row-remove aria-label="Retirer la ligne">×</button>
      </div>`).join('');
  }

  function toggle(key: string, selected: boolean) {
    const row = rowOf(key);
    const entry = entryOf(key);
    const piece = options.sorting ? entry?.piece : undefined;
    if (selected && !row) {
      rows.push({ key: `r${sequence += 1}`, label: stripExtension(key), documents: [key], checked: false, ...(piece ? { piece } : {}) });
      if (entry && !entry.markdown && !conversions.has(key)) conversions.set(key, { percent: 0, queued: true });
    }
    if (!selected && row) {
      row.documents = row.documents.filter((document) => document !== key);
      if (!row.documents.length) rows = rows.filter((other) => other !== row);
      if (conversions.get(key)?.queued || conversions.get(key)?.error) conversions.delete(key);
    }
  }

  function updateProgress(keys: string[], percent: number) {
    for (const key of keys) {
      const conversion = conversions.get(key);
      if (conversion) conversion.percent = percent;
      drawer.body.querySelectorAll<HTMLElement>(`[data-progress="${CSS.escape(key)}"]`).forEach((bar) => { bar.style.width = `${percent}%`; });
    }
  }

  async function convertQueued() {
    const batch = [...conversions.entries()].filter(([, conversion]) => conversion.queued).map(([key]) => key);
    if (converting || !batch.length || !projectId) return;
    converting = true;
    for (const key of batch) conversions.set(key, { percent: 0, queued: false });
    renderDocuments();
    renderRows();
    let failure = '';
    try {
      await caseFiles.convert(projectId, batch, (percent) => updateProgress(batch, percent));
    } catch (problem) {
      failure = errorMessage(problem);
    }
    const fresh = await caseFiles.pieces(projectId).catch(() => []);
    for (const key of batch) {
      const markdown = fresh.find((piece) => piece.path === key)?.markdown ?? null;
      const entry = entryOf(key);
      if (entry && markdown) entry.markdown = markdown;
      if (markdown) conversions.delete(key);
      else conversions.set(key, { percent: 0, queued: false, error: failure || 'Aucun Markdown produit pour ce document.' });
    }
    converting = false;
    renderDocuments();
    renderRows();
    void convertQueued();
  }

  async function browse() {
    const button = $<HTMLButtonElement>('[data-browse]');
    button.disabled = true;
    try {
      const { files, outside } = await app.rpc<{ files: string[]; outside: number }>('POST', '/documents/pick', { project: options.project });
      let unknown = 0;
      for (const file of files) {
        const entry = entryOf(file) ?? entries?.find((candidate) => candidate.markdown === file);
        if (entry && visible().includes(entry)) toggle(entry.key, true);
        else unknown += 1;
      }
      if (outside) toast(app.root, `${outside} document${outside > 1 ? 's' : ''} hors du dossier ignoré${outside > 1 ? 's' : ''}.`, 'error');
      if (unknown) toast(app.root, `${unknown} fichier${unknown > 1 ? 's' : ''} non pris en charge ou déjà ajouté${unknown > 1 ? 's' : ''}.`, 'error');
      renderDocuments();
      renderRows();
      void convertQueued();
    } catch (problem) {
      toast(app.root, errorMessage(problem), 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function submit() {
    saving = true;
    renderRows();
    try {
      const added = await options.onSubmit(rows.map((row) => ({ label: row.label.trim() || stripExtension(row.documents[0]), documents: row.documents.map((key) => entryOf(key)?.markdown ?? key), ...(row.piece ? { piece: row.piece } : {}) })));
      if (added !== false) drawer.close();
    } catch (failure) {
      toast(app.root, errorMessage(failure), 'error');
    } finally {
      saving = false;
      renderRows();
    }
  }

  drawer.body.addEventListener('change', (event) => {
    const target = event.target as HTMLInputElement;
    if (target.dataset.doc) {
      const paths = visible().map((entry) => entry.key);
      const from = anchor ? paths.indexOf(anchor) : -1;
      const to = paths.indexOf(target.dataset.doc);
      const range = shift && from >= 0 && to >= 0 ? paths.slice(Math.min(from, to), Math.max(from, to) + 1) : [target.dataset.doc];
      const before = conversions.size;
      for (const path of range) toggle(path, target.checked);
      anchor = target.dataset.doc;
      if (range.length > 1 || conversions.size !== before) renderDocuments();
      renderRows();
      void convertQueued();
    } else if (target.hasAttribute('data-row-check')) {
      const row = rows.find((entry) => entry.key === target.closest<HTMLElement>('[data-row]')?.dataset.row);
      if (row) row.checked = target.checked;
      renderRows();
    }
  });
  drawer.body.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    if (target === filterInput) renderDocuments();
    else if (target.hasAttribute('data-row-label')) {
      const row = rows.find((entry) => entry.key === target.closest<HTMLElement>('[data-row]')?.dataset.row);
      if (row) row.label = target.value;
    }
  });
  drawer.body.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    shift = event.shiftKey;
    if (target.closest('[data-documents-submit]') && !saving && !pending()) void submit();
    else if (target.closest('[data-browse]')) void browse();
    else if (target.closest('[data-select-all]')) {
      for (const entry of visible()) toggle(entry.key, true);
      renderDocuments();
      renderRows();
      void convertQueued();
    } else if (target.closest('[data-select-none]')) {
      rows = [];
      for (const [key, conversion] of conversions) if (conversion.queued || conversion.error) conversions.delete(key);
      renderDocuments();
      renderRows();
    } else if (target.closest('[data-row-remove]')) {
      const key = target.closest<HTMLElement>('[data-row]')?.dataset.row;
      for (const document of rows.find((row) => row.key === key)?.documents ?? []) toggle(document, false);
      renderDocuments();
      renderRows();
    } else if (target.closest('[data-group]')) {
      const checked = rows.filter((row) => row.checked);
      if (checked.length < 2) return;
      const merged: DraftRow = { key: `r${sequence += 1}`, label: `Groupe — ${checked[0].label}`, documents: checked.flatMap((row) => row.documents), checked: false };
      const position = rows.indexOf(checked[0]);
      rows = rows.filter((row) => !row.checked);
      rows.splice(position, 0, merged);
      renderRows();
    } else if (target.closest('[data-ungroup]')) {
      rows = rows.flatMap((row) => row.checked && row.documents.length > 1
        ? row.documents.map((document) => ({ key: `r${sequence += 1}`, label: stripExtension(document), documents: [document], checked: false, ...(options.sorting && entryOf(document)?.piece ? { piece: entryOf(document)!.piece! } : {}) }))
        : [row]);
      renderRows();
    }
  });

  async function load() {
    projectId = (await app.projects().catch(() => [])).find((entry) => entry.fullPath === options.project)?.projectId ?? null;
    const [listed, casePieces] = await Promise.all([
      app.rpc<{ documents: MarkdownDocument[] }>('GET', `/documents?project=${encodeURIComponent(options.project)}`).then((result) => result.documents).catch((failure) => {
        error = errorMessage(failure);
        return [];
      }),
      projectId ? caseFiles.pieces(projectId).catch((failure) => {
        error = `Pièces du dossier indisponibles : ${errorMessage(failure)}`;
        return [];
      }) : Promise.resolve([]),
    ]);
    const sizes = new Map(listed.map((document) => [document.path, document.size]));
    const pieces = casePieces.filter((piece) => piece.path.split('/')[0] !== REVIEW_FOLDER);
    const converted = new Set(pieces.map((piece) => piece.markdown).filter(Boolean));
    entries = [
      ...pieces.map((piece) => ({ key: piece.path, markdown: piece.markdown, piece: piece.path, size: piece.markdown ? sizes.get(piece.markdown) ?? null : null })),
      ...listed.filter((document) => !converted.has(document.path)).map((document) => ({ key: document.path, markdown: document.path, piece: null, size: document.size })),
    ].sort((left, right) => left.key.localeCompare(right.key, 'fr'));
    renderDocuments();
  }

  renderDocuments();
  renderRows();
  void load();
}
