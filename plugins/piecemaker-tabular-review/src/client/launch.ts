import type { MarkdownDocument, Provider, ReviewDetail, Template } from '../shared.js';
import { hasActions, REVIEW_FOLDER } from '../shared.js';
import type { App, View } from './app.js';
import { basename, confirmDialog, errorMessage, escapeHtml, toast } from './dom.js';
import { anonymizationProxyOrigin, caseFiles, loadModels } from './host.js';
import type { CasePiece } from './sorting.js';
import type { HostProject, ModelOption } from './host.js';

type DraftRow = {
  key: string;
  label: string;
  documents: string[];
  checked: boolean;
  piece?: string;
};

const PROVIDERS: { value: Provider; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'mistral', label: 'Mistral' },
];

function stripExtension(value: string): string {
  return basename(value).replace(/\.md$/i, '');
}

function filenamePreview(templateName: string, title: string): string {
  const now = new Date();
  const stamp = [now.getFullYear() % 100, now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, '0')).join('-');
  const template = /^tabular review/i.test(templateName) ? templateName : `Tabular Review ${templateName}`;
  return `${stamp} - ${template} - ${title || '…'}`;
}

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function createLaunchView(app: App): View {
  const element = document.createElement('div');
  element.className = 'ptr-page';
  element.innerHTML = `
    <div class="ptr-grid">
      <label class="ptr-field"><span class="ptr-label">Dossier</span><select class="ptr-select" data-project></select></label>
      <label class="ptr-field"><span class="ptr-label">Modèle de tabular review</span><select class="ptr-select" data-template></select></label>
      <label class="ptr-field"><span class="ptr-label">Nom de la tabular review</span><input class="ptr-input" data-title maxlength="120" placeholder="ex. Notion de faute lourde"></label>
    </div>
    <div data-notice></div>
    <div class="ptr-panels">
      <section class="ptr-panel">
        <div class="ptr-panel-header">
          <span data-docs-count>Documents</span>
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
    </div>
    <div class="ptr-footer-bar">
      <label class="ptr-field" style="width:120px"><span class="ptr-label">IA</span><select class="ptr-select" data-provider>${PROVIDERS.map((provider) => `<option value="${provider.value}">${provider.label}</option>`).join('')}</select></label>
      <label class="ptr-field" style="width:240px"><span class="ptr-label">Modèle IA</span><select class="ptr-select" data-model></select></label>
      <label class="ptr-field" style="width:150px"><span class="ptr-label">Sessions simultanées</span><select class="ptr-select" data-concurrency>${[1, 2, 3, 4, 5, 6, 8].map((value) => `<option value="${value}"${value === 3 ? ' selected' : ''}>${value}</option>`).join('')}</select></label>
      <span class="ptr-spacer"></span>
      <span class="ptr-small ptr-muted" data-filename></span>
      <button type="button" class="ptr-button ptr-button-primary" data-launch>Lancer la tabular review</button>
    </div>
    <div data-model-warning></div>`;

  const $ = <T extends HTMLElement>(selector: string) => element.querySelector<T>(selector)!;
  const projectSelect = $<HTMLSelectElement>('[data-project]');
  const templateSelect = $<HTMLSelectElement>('[data-template]');
  const titleInput = $<HTMLInputElement>('[data-title]');
  const filterInput = $<HTMLInputElement>('[data-filter]');
  const providerSelect = $<HTMLSelectElement>('[data-provider]');
  const modelSelect = $<HTMLSelectElement>('[data-model]');
  const concurrencySelect = $<HTMLSelectElement>('[data-concurrency]');

  let projects: HostProject[] = [];
  let protectedProjects = new Set<string>();
  let project: string | null = null;
  let templates: Template[] = [];
  let documents: MarkdownDocument[] | null = null;
  let documentsError = '';
  let rows: DraftRow[] = [];
  let rowSequence = 0;
  let models: { options: ModelOption[]; cheapest: string } = { options: [], cheapest: '' };
  let launching = false;
  let documentsRequest = 0;
  // Tri des pièces : chaque ligne est une pièce originale, analysée par son Markdown converti.
  let pieces: CasePiece[] | null = null;
  let piecesError = '';
  let sortingMode = false;

  const selectedTemplate = () => templates.find((template) => template.id === templateSelect.value) ?? null;
  const isSorting = () => hasActions(selectedTemplate()?.columns ?? []);
  const pieceByMarkdown = () => new Map((pieces ?? []).filter((piece) => piece.markdown && piece.path.split('/')[0] !== REVIEW_FOLDER).map((piece) => [piece.markdown!, piece.path]));
  const documentRow = new Map<string, DraftRow>();
  const reindex = () => {
    documentRow.clear();
    for (const row of rows) for (const document of row.documents) documentRow.set(document, row);
  };

  const filteredDocuments = () => {
    const query = normalize(filterInput.value.trim());
    const sortable = isSorting() ? pieceByMarkdown() : null;
    return (documents ?? []).filter((document) => (!sortable || sortable.has(document.path)) && (!query || normalize(document.path).includes(query)));
  };

  function renderNotice() {
    const notices: string[] = [];
    if (project && !protectedProjects.has(project)) {
      notices.push('<div class="ptr-warning">Ce dossier n’est pas sous bouclier vert (anonymisation non terminée ou protection levée) : vérifiez que les documents Markdown sélectionnés sont bien pseudonymisés.</div>');
    }
    if (documentsError) notices.push(`<div class="ptr-error-box">${escapeHtml(documentsError)}</div>`);
    if (isSorting()) {
      const waiting = (pieces ?? []).filter((piece) => !piece.markdown && piece.path.split('/')[0] !== REVIEW_FOLDER).length;
      notices.push(piecesError
        ? `<div class="ptr-error-box">Pièces du dossier indisponibles : ${escapeHtml(piecesError)}</div>`
        : `<div class="ptr-muted">Tri des pièces : chaque ligne est une pièce du dossier, lue dans son Markdown converti.${waiting ? ` ${waiting} pièce${waiting > 1 ? 's ne sont' : ' n’est'} pas encore convertie${waiting > 1 ? 's' : ''} : « Ajouter les nouvelles pièces », dans la review, la${waiting > 1 ? 's' : ''} convertira.` : ''}</div>`);
    }
    $('[data-notice]').innerHTML = notices.join('');
  }

  function renderDocuments() {
    const target = $('[data-docs]');
    const visible = filteredDocuments();
    $('[data-docs-count]').textContent = documents ? `Documents Markdown (${documents.length})` : 'Documents Markdown';
    if (!project) {
      target.innerHTML = '<div class="ptr-empty">Choisissez un dossier.</div>';
      return;
    }
    if (!documents) {
      target.innerHTML = '<div class="ptr-empty"><span class="ptr-spinner"></span> Chargement…</div>';
      return;
    }
    if (!visible.length) {
      target.innerHTML = `<div class="ptr-empty">${documents.length ? 'Aucun document ne correspond au filtre.' : 'Aucun document .md dans ce dossier. Convertissez d’abord les pièces en Markdown.'}</div>`;
      return;
    }
    const groups = new Map<string, MarkdownDocument[]>();
    for (const document of visible) {
      const folder = document.path.includes('/') ? document.path.slice(0, document.path.lastIndexOf('/')) : '';
      groups.set(folder, [...(groups.get(folder) ?? []), document]);
    }
    target.innerHTML = [...groups.entries()].map(([folder, entries]) => `
      <div class="ptr-doc-group">${escapeHtml(folder || 'Racine du dossier')}</div>
      ${entries.map((document) => `
        <label class="ptr-doc" title="${escapeHtml(document.path)}">
          <input type="checkbox" data-doc="${escapeHtml(document.path)}"${documentRow.has(document.path) ? ' checked' : ''}>
          <span>${escapeHtml(basename(document.path))}</span>
          <span class="ptr-small ptr-muted" style="margin-left:auto;flex-shrink:0">${Math.max(1, Math.round(document.size / 1024))} Ko</span>
        </label>`).join('')}`).join('');
  }

  function renderRows() {
    const target = $('[data-rows]');
    $('[data-rows-count]').textContent = `Lignes (${rows.length})`;
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

  function renderFooter() {
    const template = selectedTemplate();
    $('[data-filename]').textContent = template ? `${REVIEW_FOLDER}/${filenamePreview(template.name, titleInput.value.trim())}` : '';
    $<HTMLButtonElement>('[data-launch]').disabled = launching || !project || !template || !rows.length || !titleInput.value.trim() || !modelSelect.value;
    $<HTMLButtonElement>('[data-launch]').textContent = launching ? 'Lancement…' : 'Lancer la tabular review';
    $<HTMLButtonElement>('[data-group]').disabled = isSorting() || rows.filter((row) => row.checked).length < 2;
    $<HTMLButtonElement>('[data-ungroup]').disabled = !rows.some((row) => row.checked && row.documents.length > 1);
    const costly = modelSelect.value && modelSelect.value !== models.cheapest;
    $('[data-model-warning]').innerHTML = costly
      ? `<div class="ptr-warning">Modèle plus puissant que le modèle par défaut : chaque ligne lance une session IA complète (${rows.length} session${rows.length > 1 ? 's' : ''}), la consommation de tokens peut être très élevée.</div>`
      : '';
  }

  function renderAll() {
    reindex();
    renderNotice();
    renderDocuments();
    renderRows();
    renderFooter();
  }

  function renderProjects() {
    projectSelect.innerHTML = projects.length
      ? projects.map((entry) => `<option value="${escapeHtml(entry.fullPath)}"${entry.fullPath === project ? ' selected' : ''}>${escapeHtml(entry.displayName)}${protectedProjects.has(entry.fullPath) ? ' 🛡' : ''}</option>`).join('')
      : '<option value="">Aucun dossier</option>';
  }

  function renderTemplates() {
    const current = templateSelect.value;
    templateSelect.innerHTML = templates.length
      ? templates.map((template) => `<option value="${escapeHtml(template.id)}">${escapeHtml(template.name)} — ${template.columns.length} question${template.columns.length > 1 ? 's' : ''}</option>`).join('')
      : '<option value="">Aucun modèle — créez-en un dans l’onglet Modèles</option>';
    if (templates.some((template) => template.id === current)) templateSelect.value = current;
  }

  async function loadPieces(request: number) {
    const projectId = projects.find((entry) => entry.fullPath === project)?.projectId;
    try {
      if (!projectId) throw new Error('dossier inconnu de PieceMaker.');
      const loaded = await caseFiles.pieces(projectId);
      if (request === documentsRequest) pieces = loaded;
    } catch (error) {
      if (request === documentsRequest) piecesError = errorMessage(error);
    }
  }

  async function loadDocuments() {
    const request = ++documentsRequest;
    documents = null;
    documentsError = '';
    pieces = null;
    piecesError = '';
    rows = [];
    renderAll();
    if (!project) return;
    const piecesLoaded = loadPieces(request);
    try {
      const result = await app.rpc<{ documents: MarkdownDocument[] }>('GET', `/documents?project=${encodeURIComponent(project)}`);
      if (request !== documentsRequest) return;
      documents = result.documents;
    } catch (error) {
      if (request !== documentsRequest) return;
      documents = [];
      documentsError = errorMessage(error);
    }
    await piecesLoaded;
    if (request === documentsRequest) renderAll();
  }

  async function selectProject(path: string | null) {
    if (!path || path === project) return;
    project = path;
    renderProjects();
    await loadDocuments();
  }

  async function loadProviderModels() {
    const provider = providerSelect.value as Provider;
    modelSelect.innerHTML = '<option value="">Chargement…</option>';
    try {
      models = await loadModels(provider);
    } catch {
      models = { options: provider === 'claude' ? [{ value: 'haiku', label: 'Haiku' }] : [], cheapest: provider === 'claude' ? 'haiku' : '' };
    }
    modelSelect.innerHTML = models.options.length
      ? models.options.map((option) => `<option value="${escapeHtml(option.value)}"${option.value === models.cheapest ? ' selected' : ''}>${escapeHtml(option.label)}${option.value === models.cheapest ? ' (par défaut, économique)' : ''}</option>`).join('')
      : '<option value="">Aucun modèle disponible</option>';
    renderFooter();
  }

  function toggleDocument(path: string, selected: boolean) {
    const row = documentRow.get(path);
    const piece = isSorting() ? pieceByMarkdown().get(path) : undefined;
    if (selected && !row) rows.push({ key: `r${rowSequence += 1}`, label: piece ? basename(piece).replace(/\.[^.]+$/, '') : stripExtension(path), documents: [path], checked: false, ...(piece ? { piece } : {}) });
    if (!selected && row) {
      row.documents = row.documents.filter((document) => document !== path);
      if (!row.documents.length) rows = rows.filter((entry) => entry !== row);
    }
  }

  async function launch() {
    const template = selectedTemplate();
    const title = titleInput.value.trim();
    if (!project || !template || !rows.length || !title) return;
    const provider = providerSelect.value as Provider;
    const model = modelSelect.value;
    const costly = model !== models.cheapest;
    const sessions = rows.length;
    const confirmed = await confirmDialog(
      app.root,
      'Lancer la tabular review ?',
      `<p>Vous allez lancer <strong>${sessions} session${sessions > 1 ? 's' : ''} IA</strong> (une par ligne) avec <strong>${escapeHtml(provider)} — ${escapeHtml(modelSelect.selectedOptions[0]?.textContent ?? model)}</strong>, chacune pour ${template.columns.length} question${template.columns.length > 1 ? 's' : ''}.</p>
       <p class="ptr-muted">Les documents sont copiés dans « ${escapeHtml(REVIEW_FOLDER)}/docs » du dossier et le résultat est enregistré dans « ${escapeHtml(filenamePreview(template.name, title))} ». Les sessions passent par le proxy d’anonymisation et n’apparaissent pas dans l’historique des sessions.</p>
       ${costly ? '<div class="ptr-warning">Attention : ce modèle consomme beaucoup de tokens.</div>' : ''}`,
      'Lancer',
    );
    if (!confirmed) return;
    launching = true;
    renderFooter();
    try {
      const proxyOrigin = await anonymizationProxyOrigin();
      const detail = await app.rpc<ReviewDetail>('POST', '/reviews', {
        project,
        templateId: template.id,
        title,
        rows: rows.map((row) => ({ label: row.label.trim(), documents: row.documents, ...(row.piece ? { piece: row.piece } : {}) })),
        provider,
        model,
        concurrency: Number(concurrencySelect.value),
        proxyOrigin,
      });
      titleInput.value = '';
      rows = [];
      renderAll();
      app.openReview(detail.project, detail.file);
    } catch (error) {
      toast(app.root, errorMessage(error), 'error');
    } finally {
      launching = false;
      renderFooter();
    }
  }

  element.addEventListener('change', (event) => {
    const target = event.target as HTMLElement;
    if (target === projectSelect) void selectProject(projectSelect.value);
    else if (target === providerSelect) void loadProviderModels();
    else if (target === templateSelect && isSorting() !== sortingMode) {
      // Les lignes d'un tri portent une pièce : on ne mélange pas les deux modes.
      sortingMode = isSorting();
      rows = [];
      renderAll();
    } else if (target === templateSelect || target === modelSelect) renderFooter();
    else if (target instanceof HTMLInputElement && target.dataset.doc) {
      toggleDocument(target.dataset.doc, target.checked);
      reindex();
      renderRows();
      renderFooter();
    } else if (target instanceof HTMLInputElement && target.hasAttribute('data-row-check')) {
      const row = rows.find((entry) => entry.key === target.closest<HTMLElement>('[data-row]')?.dataset.row);
      if (row) row.checked = target.checked;
      renderFooter();
    }
  });

  element.addEventListener('input', (event) => {
    const target = event.target as HTMLElement;
    if (target === filterInput) renderDocuments();
    else if (target === titleInput) renderFooter();
    else if (target instanceof HTMLInputElement && target.hasAttribute('data-row-label')) {
      const row = rows.find((entry) => entry.key === target.closest<HTMLElement>('[data-row]')?.dataset.row);
      if (row) row.label = target.value;
    }
  });

  element.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-launch]')) void launch();
    else if (target.closest('[data-select-all]')) {
      for (const document of filteredDocuments()) toggleDocument(document.path, true);
      renderAll();
    } else if (target.closest('[data-select-none]')) {
      rows = [];
      renderAll();
    } else if (target.closest('[data-row-remove]')) {
      const key = target.closest<HTMLElement>('[data-row]')?.dataset.row;
      rows = rows.filter((row) => row.key !== key);
      renderAll();
    } else if (target.closest('[data-group]')) {
      const checked = rows.filter((row) => row.checked);
      if (checked.length < 2) return;
      const merged: DraftRow = {
        key: `r${rowSequence += 1}`,
        label: `Groupe — ${checked[0].label}`,
        documents: checked.flatMap((row) => row.documents),
        checked: false,
      };
      const position = rows.indexOf(checked[0]);
      rows = rows.filter((row) => !row.checked);
      rows.splice(position, 0, merged);
      renderAll();
    } else if (target.closest('[data-ungroup]')) {
      rows = rows.flatMap((row) => row.checked && row.documents.length > 1
        ? row.documents.map((document) => ({ key: `r${rowSequence += 1}`, label: stripExtension(document), documents: [document], checked: false }))
        : [row]);
      renderAll();
    }
  });

  const stopTemplates = app.onTemplatesChange((next) => {
    templates = next;
    renderTemplates();
    if (isSorting() !== sortingMode) {
      sortingMode = isSorting();
      rows = [];
      renderAll();
    }
    renderFooter();
  });

  async function initialize() {
    renderAll();
    void loadProviderModels();
    try {
      const [loadedProjects, loadedTemplates, protectedResult] = await Promise.all([
        app.projects(),
        app.templates(),
        app.rpc<{ projects: string[] }>('GET', '/protected-projects').catch(() => ({ projects: [] })),
      ]);
      projects = loadedProjects;
      templates = loadedTemplates;
      protectedProjects = new Set(protectedResult.projects);
    } catch (error) {
      toast(app.root, errorMessage(error), 'error');
    }
    renderTemplates();
    sortingMode = isSorting();
    const preferred = app.takeTargetProject() ?? app.context().project?.path ?? null;
    const initial = projects.find((entry) => entry.fullPath === preferred)?.fullPath ?? projects[0]?.fullPath ?? null;
    project = null;
    renderProjects();
    await selectProject(initial);
  }

  void initialize();

  return {
    element,
    show() {
      const preferred = app.takeTargetProject();
      if (preferred && preferred !== project && projects.some((entry) => entry.fullPath === preferred)) void selectProject(preferred);
      void app.rpc<{ projects: string[] }>('GET', '/protected-projects').then((result) => {
        protectedProjects = new Set(result.projects);
        renderProjects();
        renderNotice();
      }).catch(() => undefined);
    },
    destroy() {
      stopTemplates();
    },
  };
}
