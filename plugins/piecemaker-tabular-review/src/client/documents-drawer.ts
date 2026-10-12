import type { MarkdownDocument, RowRequest } from '../shared.js';
import { REVIEW_FOLDER } from '../shared.js';
import type { App } from './app.js';
import { basename, errorMessage, escapeHtml, toast } from './dom.js';
import { openDrawer } from './drawer.js';
import { caseFiles } from './host.js';

type DraftRow = RowRequest & { key: string; checked: boolean };

export type DocumentsOptions = {
  project: string;
  sorting: boolean;
  existing: Set<string>;
  onSubmit(rows: RowRequest[]): Promise<boolean | void> | boolean | void;
};

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

const stripExtension = (value: string) => basename(value).replace(/\.md$/i, '');

export function openDocumentsDrawer(app: App, options: DocumentsOptions): void {
  let documents: MarkdownDocument[] | null = null;
  let pieces = new Map<string, string>();
  let error = '';
  let rows: DraftRow[] = [];
  let sequence = 0;
  let saving = false;
  const drawer = openDrawer(app.root, 'Ajouter des documents');
  drawer.element.classList.add('ptr-drawer-wide');
  drawer.body.innerHTML = `
    <div data-documents-notice></div>
    <section class="ptr-panel">
      <div class="ptr-panel-header">
        <span data-docs-count>Documents Markdown</span>
        <input class="ptr-input" data-filter placeholder="Filtrer…" style="max-width:220px;height:1.6rem;margin-left:auto">
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
    <div class="ptr-drawer-footer"><span class="ptr-spacer"></span><button type="button" class="ptr-button" data-drawer-close>Annuler</button><button type="button" class="ptr-button ptr-button-primary" data-documents-submit>Ajouter au tableau</button></div>`;
  const $ = <T extends HTMLElement>(selector: string) => drawer.body.querySelector<T>(selector)!;
  const filterInput = $<HTMLInputElement>('[data-filter]');
  const rowOf = (path: string) => rows.find((row) => row.documents.includes(path));

  const visible = () => {
    const query = normalize(filterInput.value.trim());
    return (documents ?? []).filter((document) => !options.existing.has(document.path) && (!options.sorting || pieces.has(document.path)) && (!query || normalize(document.path).includes(query)));
  };

  function renderDocuments() {
    const target = $('[data-docs]');
    $('[data-docs-count]').textContent = documents ? `Documents Markdown (${visible().length})` : 'Documents Markdown';
    $('[data-documents-notice]').innerHTML = [
      error ? `<div class="ptr-error-box">${escapeHtml(error)}</div>` : '',
      options.sorting ? '<div class="ptr-muted ptr-small">Tri des pièces : seules les pièces du dossier déjà converties en Markdown sont proposées.</div>' : '',
    ].join('');
    if (!documents) {
      target.innerHTML = '<div class="ptr-empty"><span class="ptr-spinner"></span> Chargement…</div>';
      return;
    }
    const entries = visible();
    if (!entries.length) {
      target.innerHTML = `<div class="ptr-empty">${documents.length ? 'Aucun document à ajouter.' : 'Aucun document .md dans ce dossier. Convertissez d’abord les pièces en Markdown.'}</div>`;
      return;
    }
    const groups = new Map<string, MarkdownDocument[]>();
    for (const document of entries) {
      const folder = document.path.includes('/') ? document.path.slice(0, document.path.lastIndexOf('/')) : '';
      groups.set(folder, [...(groups.get(folder) ?? []), document]);
    }
    target.innerHTML = [...groups.entries()].map(([folder, list]) => `
      <div class="ptr-doc-group">${escapeHtml(folder || 'Racine du dossier')}</div>
      ${list.map((document) => `
        <label class="ptr-doc" title="${escapeHtml(document.path)}">
          <input type="checkbox" data-doc="${escapeHtml(document.path)}"${rowOf(document.path) ? ' checked' : ''}>
          <span>${escapeHtml(basename(document.path))}</span>
          <span class="ptr-small ptr-muted" style="margin-left:auto;flex-shrink:0">${Math.max(1, Math.round(document.size / 1024))} Ko</span>
        </label>`).join('')}`).join('');
  }

  function renderRows() {
    const target = $('[data-rows]');
    $('[data-rows-count]').textContent = `Lignes (${rows.length})`;
    $<HTMLButtonElement>('[data-group]').disabled = options.sorting || rows.filter((row) => row.checked).length < 2;
    $<HTMLButtonElement>('[data-ungroup]').disabled = !rows.some((row) => row.checked && row.documents.length > 1);
    $<HTMLButtonElement>('[data-documents-submit]').disabled = saving || !rows.length;
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
        </div>
        ${row.documents.length > 1 ? `<span class="ptr-group-badge">${row.documents.length} docs</span>` : ''}
        <button type="button" class="ptr-icon-button" data-row-remove aria-label="Retirer la ligne">×</button>
      </div>`).join('');
  }

  function toggle(path: string, selected: boolean) {
    const row = rowOf(path);
    const piece = options.sorting ? pieces.get(path) : undefined;
    if (selected && !row) rows.push({ key: `r${sequence += 1}`, label: piece ? basename(piece).replace(/\.[^.]+$/, '') : stripExtension(path), documents: [path], checked: false, ...(piece ? { piece } : {}) });
    if (!selected && row) {
      row.documents = row.documents.filter((document) => document !== path);
      if (!row.documents.length) rows = rows.filter((entry) => entry !== row);
    }
  }

  async function submit() {
    saving = true;
    renderRows();
    try {
      const added = await options.onSubmit(rows.map((row) => ({ label: row.label.trim() || stripExtension(row.documents[0]), documents: row.documents, ...(row.piece ? { piece: row.piece } : {}) })));
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
      toggle(target.dataset.doc, target.checked);
      renderRows();
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
    if (target.closest('[data-documents-submit]') && !saving) void submit();
    else if (target.closest('[data-select-all]')) {
      for (const document of visible()) toggle(document.path, true);
      renderDocuments();
      renderRows();
    } else if (target.closest('[data-select-none]')) {
      rows = [];
      renderDocuments();
      renderRows();
    } else if (target.closest('[data-row-remove]')) {
      const key = target.closest<HTMLElement>('[data-row]')?.dataset.row;
      rows = rows.filter((row) => row.key !== key);
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
        ? row.documents.map((document) => ({ key: `r${sequence += 1}`, label: stripExtension(document), documents: [document], checked: false }))
        : [row]);
      renderRows();
    }
  });

  async function load() {
    const projectId = (await app.projects().catch(() => [])).find((entry) => entry.fullPath === options.project)?.projectId;
    const [listed, casePieces] = await Promise.all([
      app.rpc<{ documents: MarkdownDocument[] }>('GET', `/documents?project=${encodeURIComponent(options.project)}`).then((result) => result.documents).catch((failure) => {
        error = errorMessage(failure);
        return [];
      }),
      options.sorting && projectId ? caseFiles.pieces(projectId).catch((failure) => {
        error = `Pièces du dossier indisponibles : ${errorMessage(failure)}`;
        return [];
      }) : Promise.resolve([]),
    ]);
    pieces = new Map(casePieces.filter((piece) => piece.markdown && piece.path.split('/')[0] !== REVIEW_FOLDER).map((piece) => [piece.markdown!, piece.path]));
    documents = listed;
    renderDocuments();
  }

  renderDocuments();
  renderRows();
  void load();
}
