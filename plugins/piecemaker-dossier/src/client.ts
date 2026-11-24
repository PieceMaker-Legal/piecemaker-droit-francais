import { isPieceRow, mountIndexAnalysis } from './index-analysis.js';
import type { IndexChronology } from './index-analysis.js';
import { editClassification } from './classification.js';
import { pendingProposals } from './pending-proposals.js';
import { etapesApi, knowledgeApi } from './api.js';
import { isParty, okfApi } from './okf.js';
import { mountGraph } from './okf-graph.js';
import type { OkfGraph } from './okf-graph.js';
import { ficheCardMarkup } from './okf-card.js';
import type { PendingProposals } from './okf.js';
import { buildCompanyValidationOperations } from './company-search.js';
import { askConfirm, askPrompt, bindAliasEditors, deleteEntity, documentEditor, institutionalTermsEditor, modal, nodeEditor, partyTypePicker } from './editors.js';
import { removedAliasOperations } from './exclusions.js';
import { partyCodeChange, partyRemovalOperations } from './party-codes.js';
import { PLUGIN_STYLES } from './styles.js';
import { chronologyView, graphView, proposalBanner, documentResource, escapeHtml, linksMarkup, generalView, mappingView, nodeVariants, parseAliases, scanPercentLabel, scanProgress, shell } from './views.js';
import type { BodaccScanState, Tab, ViewData } from './views.js';
import type { ScanJob } from './api.js';
import type { KnowledgeUpdateOperation } from './types.js';
import type { PartySide } from './party-codes.js';

type PluginContext = {
  theme: 'dark' | 'light';
  project: { name: string; path: string } | null;
  session: { id: string; title: string } | null;
};

type PluginApi = {
  readonly context: PluginContext;
  onContextChange(callback: (context: PluginContext) => void): () => void;
  openFileInEditor(filePath: string): void;
};

const PANEL_FOCUS_EVENT = 'piecemaker:panel-focus';
const KNOWLEDGE_SCAN_EVENT = 'piecemaker:knowledge-scan-job';
const VIEW_EVENT = 'piecemaker:dossier-view';
const VIEW_KEY = '__piecemakerDossierView';
const MAPPING_EVENT = 'piecemaker:mapping-show';
const MAPPING_KEY = '__piecemakerMappingShow';
const ANONYMIZATION_STATE_EVENT = 'piecemaker:anonymization-state';
const SCAN_POLL_INTERVAL_MS = 1000;
const VERSION_POLL_INTERVAL_MS = 5000;
const viewCache = new Map<string, ViewData>();

function takeRequestedView(): Tab | 'index-analysis' | null {
  const pending = window as Window & { [VIEW_KEY]?: unknown };
  const view = pending[VIEW_KEY];
  delete pending[VIEW_KEY];
  return view === 'general' || view === 'chronology' || view === 'graph' || view === 'index-analysis' ? view : null;
}

function takeRequestedMapping(): string | null {
  const pending = window as Window & { [MAPPING_KEY]?: unknown };
  const project = pending[MAPPING_KEY];
  delete pending[MAPPING_KEY];
  return typeof project === 'string' ? project : null;
}

export function mount(container: HTMLElement, api: PluginApi): void {
  const style = document.createElement('style');
  style.textContent = PLUGIN_STYLES;
  const root = document.createElement('div');
  root.className = 'pmd-root piecemaker-ui';
  root.dataset.chatTab = 'plugin:piecemaker-dossier';
  root.style.position = 'relative';
  container.replaceChildren(style, root);
  let context = api.context;
  const requestedView = takeRequestedView();
  let active: Tab = requestedView === 'index-analysis' ? 'chronology' : requestedView ?? 'general';
  let data: ViewData | null = null;
  // L'Index : la revue tabulaire de l'Index, montée une fois par dossier et rattachée à l'onglet à chaque affichage.
  let indexHost: HTMLElement | null = null;
  let indexProject = '';
  let disposeIndex: (() => void) | null = null;
  let indexChronology = (() => { try { return localStorage.getItem('pmd-index-chronologie') === '1'; } catch { return false; } })();
  const chronologyListeners = new Set<() => void>();
  const notifyChronology = () => chronologyListeners.forEach((listener) => listener());
  const chronology: IndexChronology = {
    active: () => indexChronology,
    isPiece: (row) => isPieceRow(data?.okf, row),
    subscribe: (callback) => { chronologyListeners.add(callback); return () => chronologyListeners.delete(callback); },
  };
  const closeIndex = () => {
    disposeIndex?.();
    disposeIndex = null;
    indexHost = null;
    indexProject = '';
  };
  let proposals: PendingProposals | undefined;
  let showPremises = (() => { try { return localStorage.getItem('pmd-okf-premises') !== '0'; } catch { return true; } })();
  let destroyGraph: (() => void) | null = null;
  let okfDetail: string | null = null;
  let loadSequence = 0;
  let scanJob: ScanJob | null = null;
  let mappingValidated: string | null = null;
  let mappingRequested = takeRequestedMapping();
  const bodaccStates = new Map<string, BodaccScanState>();
  let draggedNodeId = '';
  const compactWorkspace = window.matchMedia('(max-width: 1024px)');
  let tiersCollapsed = compactWorkspace.matches;

  const showError = (error: unknown) => {
    const target = root.querySelector<HTMLElement>('[data-error]');
    if (target) target.innerHTML = `<div class="pmd-error">${escapeHtml(error instanceof Error ? error.message : error)}</div>`;
  };

  const designatedCompany = (companyId: string) => {
    const company = data?.graph.nodes.find((node) => node.id === companyId);
    return Boolean(company && company.kind === 'company' && (company.data.partySide === 'client' || company.data.partySide === 'adversaire'));
  };

  const searchBodaccCompany = async (companyId: string, siren: string, siret: string) => {
    if (!designatedCompany(companyId)) return;
    const state = bodaccStates.get(companyId) || { status: 'idle' as const };
    if (!siren && !siret) {
      state.status = 'error';
      state.error = 'Aucun SIREN ou SIRET n’est renseigné pour cette personne morale.';
      bodaccStates.set(companyId, state);
      render();
      return;
    }
    state.status = 'loading';
    state.error = '';
    bodaccStates.set(companyId, state);
    render();
    try {
      const result = await knowledgeApi.searchBodacc(context.project?.path || '', siren, siret);
      state.status = 'idle';
      api.openFileInEditor(result.reportPath);
    } catch (error) {
      state.status = 'error';
      state.error = error instanceof Error ? error.message : 'Recherche BODACC impossible.';
    }
    bodaccStates.set(companyId, state);
    if (context.project) render();
  };

  const companySearchQuery = (companyId: string, siren: string, siret: string): string => {
    const company = data?.graph.nodes.find((node) => node.id === companyId);
    if (!company) return '';
    const pseudonymPattern = /^(?:CLIENT|ADVERSAIRE|PERSONNE_MORALE|PERSONNE_PHYSIQUE|PERS_MORALE|PERS_PHYSIQUE)(?:_|$)/;
    const mappedName = data?.graph.mappings.filter((mapping) => mapping.nodeId === companyId).map((mapping) => mapping.real.trim()).find((value) => value && !pseudonymPattern.test(value));
    const label = mappedName || (pseudonymPattern.test(company.label.trim()) ? '' : company.label.trim());
    const legalForm = typeof company.data.legalForm === 'string' && company.data.legalForm !== 'Personne morale' ? company.data.legalForm.trim() : '';
    return [label, legalForm, siren, siret].filter(Boolean).join(' ');
  };

  const searchCompanyIdentity = async (companyId: string, siren: string, siret: string) => {
    if (!designatedCompany(companyId)) return;
    const state = bodaccStates.get(companyId) || { status: 'idle' as const };
    state.companySearchStatus = 'loading';
    state.companySearchResults = [];
    state.companySearchError = '';
    bodaccStates.set(companyId, state);
    render();
    const query = companySearchQuery(companyId, siren, siret);
    if (!query) {
      state.companySearchStatus = 'error';
      state.companySearchError = 'Aucun nom exploitable n’est disponible pour rechercher cette personne morale.';
      bodaccStates.set(companyId, state);
      render();
      return;
    }
    try {
      const response = await knowledgeApi.searchCompanies(query);
      state.companySearchResults = response.results;
      state.companySearchStatus = 'loaded';
    } catch (error) {
      state.companySearchStatus = 'error';
      state.companySearchError = error instanceof Error ? error.message : 'Recherche Registre Public impossible.';
    }
    bodaccStates.set(companyId, state);
    render();
  };

  const publishScanJob = (job: ScanJob) => {
    if (!context.project) return;
    window.dispatchEvent(new CustomEvent(KNOWLEDGE_SCAN_EVENT, {
      detail: { projectPath: context.project.path, projectName: context.project.name, job },
    }));
  };

  const paintScanProgress = () => {
    const track = root.querySelector<HTMLElement>('.pmd-scan-progress-track');
    const bar = root.querySelector<HTMLElement>('.pmd-scan-progress-bar');
    const label = root.querySelector<HTMLElement>('.pmd-scan-progress-label');
    if (!scanJob || !track || !bar || !label) {
      render();
      return;
    }
    const percent = Math.max(0, Math.min(100, scanJob.percent || 0));
    bar.style.width = `${percent}%`;
    track.setAttribute('aria-valuenow', String(Math.round(percent)));
    label.textContent = scanPercentLabel(scanJob);
  };

  const followScan = async (started: ScanJob) => {
    const projectId = context.project?.name || '';
    scanJob = started;
    publishScanJob(started);
    render();
    while (scanJob && scanJob.state === 'running') {
      await new Promise((resolve) => window.setTimeout(resolve, SCAN_POLL_INTERVAL_MS));
      if (context.project?.name !== projectId) return;
      const { job } = await knowledgeApi.scanJob(scanJob.id, projectId);
      if (!job) break;
      scanJob = job;
      publishScanJob(job);
      paintScanProgress();
    }
    const failure = scanJob?.state === 'error' ? scanJob.error : '';
    scanJob = null;
    await load();
    if (failure) showError(new Error(failure));
  };

  const load = async () => {
    const sequence = ++loadSequence;
    if (!context.project) {
      data = null;
      render();
      return;
    }
    const projectId = context.project.name;
    const cached = viewCache.get(projectId);
    if (cached) {
      data = cached;
      render();
      openRequestedMapping();
    } else if (!data) {
      render();
    }
    try {
      void etapesApi.read(context.project.path).then((etapes) => {
        if (sequence !== loadSequence) return;
        mappingValidated = etapes.mappingValide ?? null;
        paintScanStatus();
      }, () => undefined);
      void pendingProposals(context.project.path).then((pending) => {
        if (sequence !== loadSequence) return;
        proposals = pending;
        const host = root.querySelector<HTMLElement>('[data-proposals]');
        if (host) host.outerHTML = proposalBanner(proposals);
      }, () => undefined);
      const graph = await knowledgeApi.graph(projectId);
      if (sequence !== loadSequence) return;
      data = { graph, okf: cached?.okf ?? null };
      void okfApi.read(projectId).then((okf) => {
        if (sequence !== loadSequence || !data) return;
        data = { ...data, okf };
        viewCache.set(projectId, data);
        if (active === 'graph') paintContent();
        else root.querySelectorAll<HTMLElement>('[data-okf-links]').forEach((cell) => { cell.innerHTML = linksMarkup(okf, cell.dataset.okfLinks || ''); });
        if (indexChronology) notifyChronology();
      }, () => undefined);
      viewCache.set(projectId, data);
      render();
      openRequestedMapping();
    } catch (error) {
      if (sequence !== loadSequence) return;
      showError(error);
    }
  };

  const resumeScan = async () => {
    if (!context.project || scanJob) return;
    const projectId = context.project.name;
    const { job } = await knowledgeApi.scanJob('', projectId).catch(() => ({ job: null }));
    if (job && job.state === 'running' && context.project?.name === projectId) await followScan(job);
  };

  const save = async (operations: KnowledgeUpdateOperation[]) => {
    if (!context.project) return;
    viewCache.delete(context.project.name);
    await knowledgeApi.update(context.project.name, operations);
    await load();
  };

  const renamePiece = async (piecePath: string, name: string) => {
    if (!context.project) return;
    viewCache.delete(context.project.name);
    await knowledgeApi.rename(context.project.name, piecePath, name);
    await load();
  };

  const deleteNode = async (nodeId: string): Promise<boolean> => {
    const node = data?.graph.nodes.find((candidate) => candidate.id === nodeId);
    if (!node) return false;
    return deleteEntity(root, node, nodeVariants(node, data?.graph.mappings || []), save);
  };

  const openRequestedMapping = () => {
    if (!mappingRequested || !data || mappingRequested !== context.project?.path || root.querySelector('.pmd-modal')) return;
    mappingRequested = null;
    openMapping();
  };

  const openMapping = () => {
    if (!data) return;
    const mappingData = data;
    const layer = modal(root, mappingView(mappingData, mappingValidated));
    bindAliasEditors(layer);
    const operationsFromRow = (row: HTMLFormElement): KnowledgeUpdateOperation[] => {
      const node = mappingData.graph.nodes.find((candidate) => candidate.id === row.dataset.nodeId);
      if (!node) return [];
      const form = new FormData(row);
      const label = String(form.get('label') || '').trim();
      const masked = String(form.get('masked') || '').trim();
      const aliases = parseAliases(form.get('aliases'));
      if (!label) return [];
      const mappings = mappingData.graph.mappings.filter((mapping) => mapping.nodeId === node.id);
      const operations: KnowledgeUpdateOperation[] = [{ op: 'upsertNode', node: { id: node.id, kind: node.kind, label, aliases, data: node.data } }];
      for (const mapping of mappings) operations.push({ op: 'deleteMapping', mapping: { nodeId: node.id, real: mapping.real } });
      for (const real of [...new Set([label, ...aliases])]) operations.push({ op: 'upsertMapping', mapping: { nodeId: node.id, real, masked } });
      operations.push(...removedAliasOperations(node.id, [node.label, ...nodeVariants(node, mappingData.graph.mappings)], [label, ...aliases]));
      return operations;
    };
    layer.querySelectorAll<HTMLFormElement>('[data-mapping-row]').forEach((row) => row.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        await save(operationsFromRow(row));
      } catch (error) {
        showError(error);
      }
    }));
    layer.querySelector<HTMLElement>('[data-save-mapping]')?.addEventListener('click', async () => {
      const operations = Array.from(layer.querySelectorAll<HTMLFormElement>('[data-mapping-row]')).flatMap(operationsFromRow);
      if (!operations.length) {
        layer.remove();
        return;
      }
      try {
        await save(operations);
        layer.remove();
      } catch (error) {
        showError(error);
      }
    });
    layer.querySelector<HTMLElement>('[data-validate-mapping]')?.addEventListener('click', async () => {
      if (!context.project || !await askConfirm(root, 'Valider le mapping de pseudonymisation ?', 'Valider')) return;
      try {
        const operations = Array.from(layer.querySelectorAll<HTMLFormElement>('[data-mapping-row]')).flatMap(operationsFromRow);
        if (operations.length) await save(operations);
        mappingValidated = (await etapesApi.validateMapping(context.project.path)).mappingValide ?? null;
        layer.remove();
        paintScanStatus();
      } catch (error) {
        showError(error);
      }
    });
    layer.querySelectorAll<HTMLElement>('[data-edit-node]').forEach((entry) => entry.addEventListener('click', () => {
      const node = mappingData.graph.nodes.find((candidate) => candidate.id === entry.dataset.editNode);
      layer.remove();
      if (node) api.openFileInEditor(`piecemaker://identity/open/${encodeURIComponent(node.label)}`);
    }));
    layer.querySelectorAll<HTMLElement>('[data-row-menu]').forEach((trigger) => trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const menu = trigger.parentElement?.querySelector<HTMLElement>('.pmd-profile-menu');
      layer.querySelectorAll<HTMLElement>('.pmd-profile-menu[data-open=true]').forEach((entry) => { if (entry !== menu) entry.dataset.open = 'false'; });
      if (!menu) return;
      const body = layer.querySelector<HTMLElement>('.pmd-mapping-body');
      const room = body ? body.getBoundingClientRect().bottom - trigger.getBoundingClientRect().bottom : Number.POSITIVE_INFINITY;
      menu.dataset.drop = room < 110 ? 'up' : 'down';
      menu.dataset.open = menu.dataset.open === 'true' ? 'false' : 'true';
    }));
    layer.querySelectorAll<HTMLElement>('[data-delete-node]').forEach((entry) => entry.addEventListener('click', async () => {
      const nodeId = entry.dataset.deleteNode;
      if (!nodeId) return;
      try {
        if (!await deleteNode(nodeId)) return;
        layer.remove();
        openMapping();
      } catch (error) {
        showError(error);
      }
    }));
    layer.addEventListener('click', () => layer.querySelectorAll<HTMLElement>('.pmd-profile-menu[data-open=true]').forEach((menu) => { menu.dataset.open = 'false'; }));
    layer.querySelector<HTMLElement>('[data-action=add-node]')?.addEventListener('click', () => {
      layer.remove();
      nodeEditor(root, mappingData, null, save);
    });
    layer.querySelector<HTMLElement>('[data-action=institutional-terms]')?.addEventListener('click', () => {
      layer.remove();
      institutionalTermsEditor(root, async () => {
        await load();
        openMapping();
      });
    });
  };

  const closeOpenMenus = (except?: HTMLElement | null) => {
    root.querySelectorAll<HTMLElement>('.pmd-profile-menu[data-open=true]').forEach((menu) => {
      if (menu !== except) menu.dataset.open = 'false';
    });
  };

  const paintTabs = () => {
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((button) => {
      const selected = button.dataset.tab === active;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
  };

  const paintScanStatus = () => {
    const status = root.querySelector<HTMLElement>('.pmd-scan-status');
    const scanning = scanJob?.state === 'running';
    if (status) status.innerHTML = scanning && scanJob ? scanProgress(scanJob) : '';
    const ready = Boolean(data?.graph.anonymizationComplete) || Boolean(data?.graph.mappings.length);
    window.dispatchEvent(new CustomEvent(ANONYMIZATION_STATE_EVENT, { detail: { tab: 'plugin:piecemaker-dossier', project: context.project?.path || null, anonymized: Boolean(data?.graph.anonymizationComplete), pending: ready && !scanning && !mappingValidated } }));
  };

  const emitFocus = () => {
    window.dispatchEvent(new CustomEvent(PANEL_FOCUS_EVENT, { detail: { tab: 'plugin:piecemaker-dossier', view: active } }));
  };

  const attachIndex = (slot: HTMLElement | null) => {
    const projectPath = context.project?.path || '';
    if (!slot || !projectPath) return;
    if (indexHost && indexProject === projectPath) {
      slot.replaceWith(indexHost);
      return;
    }
    closeIndex();
    const host = document.createElement('div');
    host.className = 'pmd-index-analysis';
    host.dataset.indexAnalysis = '';
    indexHost = host;
    indexProject = projectPath;
    slot.replaceWith(host);
    void mountIndexAnalysis(host, api, (resource) => linksMarkup(data?.okf ?? null, resource), chronology).then((dispose) => {
      if (indexHost === host) disposeIndex = dispose;
      else dispose();
    }).catch((error: unknown) => {
      if (indexHost === host) host.innerHTML = `<div class="pmd-empty">${escapeHtml(error instanceof Error ? error.message : String(error))}</div>`;
    });
  };

  const paintContent = () => {
    emitFocus();
    const content = root.querySelector<HTMLElement>('[data-content]');
    if (!content) return;
    destroyGraph?.();
    destroyGraph = null;
    if (!context.project) content.innerHTML = '<div class="pmd-empty">Sélectionnez un projet CloudCLI.</div>';
    else if (active === 'chronology') {
      content.innerHTML = chronologyView(proposals, indexChronology);
      attachIndex(content.querySelector<HTMLElement>('[data-index-analysis]'));
      return;
    } else if (!data) content.innerHTML = '<div class="pmd-empty">Chargement…</div>';
    else content.innerHTML = active === 'graph' ? graphView(data.okf ?? null, showPremises) : generalView(data, tiersCollapsed, scanJob, bodaccStates);
    const graphHost = content.querySelector<HTMLElement>('[data-okf-graph]');
    const projectPath = context.project?.path || '';
    if (!graphHost || !data?.okf) return;
    const wrap = graphHost.parentElement!;
    let graph: OkfGraph | null = null;
    const closeDetail = () => { okfDetail = null; wrap.querySelector('[data-okf-detail]')?.remove(); graph?.select(null); };
    const showFiche = (id: string) => {
      const okf = data?.okf;
      if (!okf) return;
      const fiche = okf.fiches.find((entry) => entry.id === id);
      if (!fiche) return closeDetail();
      okfDetail = id;
      wrap.querySelector('[data-okf-detail]')?.remove();
      wrap.insertAdjacentHTML('beforeend', ficheCardMarkup(okf, id));
      const card = wrap.querySelector<HTMLElement>('[data-okf-detail]')!;
      graph?.select(id);
      card.focus({ preventScroll: true });
      card.querySelector('[data-detail-close]')?.addEventListener('click', closeDetail);
      card.querySelectorAll<HTMLElement>('[data-open-file]').forEach((button) => button.addEventListener('click', () => api.openFileInEditor(button.dataset.openFile || '')));
      card.querySelectorAll<HTMLElement>('[data-open-fiche]').forEach((button) => button.addEventListener('click', () => showFiche(button.dataset.openFiche || '')));
      card.querySelector('[data-edit-fiche]')?.addEventListener('click', () => {
        if (!data) return;
        if (isParty(fiche)) {
          const node = data.graph.nodes.find((entry) => entry.id === `entity:${fiche.title}`);
          if (node) nodeEditor(root, data, node, save);
          return;
        }
        const node = data.graph.nodes.find((entry) => entry.kind === 'document' && documentResource(entry, projectPath).normalize('NFC') === fiche.resource);
        if (node) documentEditor(root, data, node, projectPath, save, renamePiece);
      });
    };
    wrap.addEventListener('keydown', (event) => { if (event.key === 'Escape' && wrap.querySelector('[data-okf-detail]')) closeDetail(); });
    void mountGraph(graphHost, data.okf, showPremises, (fiche) => showFiche(fiche.id)).then((mounted) => {
      if (!graphHost.isConnected) return mounted.destroy();
      graph = mounted;
      destroyGraph = mounted.destroy;
      if (okfDetail) showFiche(okfDetail);
    }).catch(showError);
  };

  const bindOnce = () => {
    root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('.pmd-modal')) return;
      const nodeMenu = target.closest<HTMLElement>('[data-node-menu]');
      if (nodeMenu) {
        const menu = nodeMenu.parentElement?.querySelector<HTMLElement>('.pmd-profile-menu');
        closeOpenMenus(menu);
        if (menu) menu.dataset.open = menu.dataset.open === 'true' ? 'false' : 'true';
        return;
      }
      closeOpenMenus();
      const tab = target.closest<HTMLElement>('[data-tab]');
      if (tab?.dataset.tab) {
        active = tab.dataset.tab as Tab;
        paintTabs();
        paintContent();
        return;
      }
      const control = target.closest<HTMLElement>('[data-action]');
      const action = control?.dataset.action;
      if (control?.matches('.pmd-okf-legend a')) event.preventDefault();
      if (action === 'okf-premises') {
        const focused = document.activeElement === control;
        showPremises = !showPremises;
        try { localStorage.setItem('pmd-okf-premises', showPremises ? '1' : '0'); } catch { }
        paintContent();
        if (focused) root.querySelector<HTMLButtonElement>('[data-action="okf-premises"]')?.focus({ preventScroll: true });
        return;
      }
      if (action === 'index-chronology') {
        indexChronology = !indexChronology;
        try { localStorage.setItem('pmd-index-chronologie', indexChronology ? '1' : '0'); } catch { /* préférence locale seulement */ }
        paintContent();
        notifyChronology();
        return;
      }
      if (action === 'edit-tree' && context.project) {
        void editClassification(root, context.project.path, () => { void load(); }).catch(showError);
        return;
      }
      if (action === 'company-search') {
        const button = target.closest<HTMLElement>('[data-scan-company]');
        const companyId = button?.dataset.scanCompany || '';
        if (!button || !designatedCompany(companyId)) return;
        void searchCompanyIdentity(companyId, button.dataset.siren || '', button.dataset.siret || '');
        return;
      }
      if (action === 'bodacc-search') {
        const button = target.closest<HTMLElement>('[data-scan-company]');
        const companyId = button?.dataset.scanCompany || '';
        if (!button || !designatedCompany(companyId)) return;
        void searchBodaccCompany(companyId, button.dataset.siren || '', button.dataset.siret || '');
        return;
      }
      if (action === 'company-validate') {
        const button = target.closest<HTMLButtonElement>('[data-scan-company]');
        if (!button) return;
        const companyId = button.dataset.scanCompany || '';
        const company = data?.graph.nodes.find((node) => node.id === companyId);
        const state = bodaccStates.get(companyId);
        const result = state?.companySearchResults?.[Number(button.dataset.companyResult)];
        if (!data || !company || !result || !designatedCompany(companyId)) return;
        button.disabled = true;
        void (async () => {
          try {
            const operations = buildCompanyValidationOperations(result, {
              nodeId: company.id,
              node: company,
              partySide: (typeof company.data.partySide === 'string' ? company.data.partySide : '') as PartySide,
              position: typeof company.data.position === 'string' ? company.data.position : '',
              legalForm: typeof company.data.legalForm === 'string' ? company.data.legalForm : '',
            }, data.graph);
            await save(operations);
            const nextId = data?.graph.mappings.find((mapping) => mapping.real === (result.fields.legalName || result.name))?.nodeId || companyId;
            const nextState = bodaccStates.get(companyId) || { status: 'idle' as const };
            nextState.companySearchStatus = 'idle';
            nextState.companySearchResults = [];
            bodaccStates.delete(companyId);
            bodaccStates.set(nextId, nextState);
            await searchBodaccCompany(nextId, result.fields.siren || result.siren, result.fields.siret);
          } catch (error) {
            const nextState = bodaccStates.get(companyId) || { status: 'idle' as const };
            nextState.companySearchStatus = 'error';
            nextState.companySearchError = error instanceof Error ? error.message : 'Validation impossible.';
            bodaccStates.set(companyId, nextState);
            render();
          }
        })();
        return;
      }
      if (action === 'toggle-tiers') {
        const button = target.closest<HTMLElement>('[data-action="toggle-tiers"]');
        const layout = root.querySelector<HTMLElement>('.pmd-party-layout');
        const column = root.querySelector<HTMLElement>('[data-tiers-column]');
        if (!layout || !column || !button) return;
        const collapsed = column.dataset.collapsed === 'true';
        tiersCollapsed = !collapsed;
        column.dataset.collapsed = String(!collapsed);
        layout.dataset.tiersCollapsed = String(!collapsed);
        button.setAttribute('aria-expanded', String(collapsed));
        return;
      }
      if (action === 'cancel-scan') {
        if (!context.project || !scanJob) return;
        void askConfirm(root, 'Arrêter l’analyse en cours ?', 'Arrêter').then((confirmed) => {
          if (!confirmed || !context.project || !scanJob) return;
          void knowledgeApi.cancelScan(scanJob.id, context.project.name).catch(showError);
        });
        return;
      }
      if (action === 'scan') {
        if (!context.project || scanJob) return;
        void knowledgeApi.scan(context.project.name).then(({ job }) => followScan(job)).catch((error) => {
          scanJob = null;
          render();
          showError(error);
        });
        return;
      }
      if (action === 'add-node') {
        if (data) nodeEditor(root, data, null, save);
        return;
      }
      if (action === 'mapping') {
        openMapping();
        return;
      }
      if (action === 'agents') {
        if (!context.project) return;
        knowledgeApi.ensureAgentInstructions(context.project.name)
          .then(() => api.openFileInEditor('AGENTS.md'))
          .catch(showError);
        return;
      }
      const partyPicker = target.closest<HTMLElement>('[data-party-picker]');
      if (partyPicker && data) {
        const side = partyPicker.dataset.partyPicker;
        if (side !== 'client' && side !== 'adversaire' && side !== 'tiers') return;
        partyTypePicker(root, side, (kind) => {
          if (data) nodeEditor(root, data, null, save, { kind, partySide: side });
        });
        return;
      }
      const removeParty = target.closest<HTMLElement>('[data-remove-party]');
      if (removeParty) {
        const nodeId = removeParty.dataset.removeParty;
        if (!nodeId) return;
        void askConfirm(root, 'Retirer la désignation de partie de ce profil ?', 'Retirer').then((confirmed) => {
          if (!confirmed) return;
          const node = data?.graph.nodes.find((entry) => entry.id === nodeId);
          void save(data && node ? partyRemovalOperations(node, data.graph) : [{ op: 'removePartyDesignation', nodeId }]).catch(showError);
        });
        return;
      }
      const unlink = target.closest<HTMLElement>('[data-unlink-from]');
      if (unlink) {
        const fromNodeId = unlink.dataset.unlinkFrom || '';
        const toNodeId = unlink.dataset.unlinkTo || '';
        const relation = unlink.dataset.unlinkRelation || '';
        if (!fromNodeId || !toNodeId || !relation) return;
        void save([{ op: 'unlink', link: { fromNodeId, toNodeId, relation } }]).catch(showError);
        return;
      }
      const editNode = target.closest<HTMLElement>('[data-edit-node]');
      if (editNode) {
        const node = data?.graph.nodes.find((entry) => entry.id === editNode.dataset.editNode);
        if (node) api.openFileInEditor(`piecemaker://identity/open/${encodeURIComponent(node.label)}`);
        return;
      }
      const deleteTrigger = target.closest<HTMLElement>('[data-delete-node]');
      if (deleteTrigger) {
        const nodeId = deleteTrigger.dataset.deleteNode;
        if (nodeId) void deleteNode(nodeId).catch(showError);
        return;
      }
    });
    root.addEventListener('dragstart', (event) => {
      const card = (event.target as HTMLElement).closest<HTMLElement>('[data-profile-id]');
      if (!card) return;
      draggedNodeId = card.dataset.profileId || '';
      event.dataTransfer?.setData('text/plain', draggedNodeId);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'linkMove';
    });
    root.addEventListener('dragend', () => { draggedNodeId = ''; });
    root.addEventListener('dragover', (event) => {
      const partyDrop = (event.target as HTMLElement).closest<HTMLElement>('[data-party-drop]');
      if (partyDrop) {
        event.preventDefault();
        partyDrop.dataset.dropActive = 'true';
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        return;
      }
      const relationDrop = (event.target as HTMLElement).closest<HTMLElement>('[data-relation-drop]');
      if (relationDrop) {
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'link';
      }
    });
    root.addEventListener('dragleave', (event) => {
      const partyDrop = (event.target as HTMLElement).closest<HTMLElement>('[data-party-drop]');
      if (partyDrop && !partyDrop.contains(event.relatedTarget as Node | null)) delete partyDrop.dataset.dropActive;
    });
    root.addEventListener('drop', (event) => {
      const partyDrop = (event.target as HTMLElement).closest<HTMLElement>('[data-party-drop]');
      if (partyDrop) {
        event.preventDefault();
        delete partyDrop.dataset.dropActive;
        const sourceId = draggedNodeId || event.dataTransfer?.getData('text/plain') || '';
        const side = partyDrop.dataset.partyDrop;
        const node = data?.graph.nodes.find((entry) => entry.id === sourceId);
        if (!node || (side !== 'client' && side !== 'adversaire')) return;
        void (async () => {
          try {
            const change = partyCodeChange(
              node,
              { kind: node.kind, legalForm: typeof node.data.legalForm === 'string' ? node.data.legalForm : '', side, position: typeof node.data.position === 'string' ? node.data.position : '' },
              data?.graph.nodes || [],
              data?.graph.mappings || [],
              data?.graph.reservedCodes,
            );
            const operations: KnowledgeUpdateOperation[] = [...change.operations];
            operations.push({ op: 'upsertNode', node: { id: change.nodeId, kind: node.kind, label: node.label, aliases: node.aliases, data: change.data } });
            for (const real of [node.label, ...node.aliases]) if (change.code) operations.push({ op: 'upsertMapping', mapping: { nodeId: change.nodeId, real, masked: change.code } });
            await save(operations);
          } catch (error) {
            showError(error);
          }
        })();
        return;
      }
      const relationDrop = (event.target as HTMLElement).closest<HTMLElement>('[data-relation-drop]');
      if (!relationDrop) return;
      event.preventDefault();
      const source = draggedNodeId || event.dataTransfer?.getData('text/plain') || '';
      const destination = relationDrop.dataset.relationDrop || '';
      if (!source || !destination || source === destination) return;
      void askPrompt(root, 'Nommez le lien entre ces profils', 'Dirigeant', 'Lier').then((relation) => {
        if (!relation) return;
        void save([{ op: 'link', link: { fromNodeId: source, toNodeId: destination, relation } }]).catch(showError);
      });
    });
  };

  const render = () => {
    root.dataset.theme = context.theme;
    if (!root.querySelector('[data-content]')) {
      root.innerHTML = shell(active, scanJob);
      bindOnce();
    } else {
      paintTabs();
    }
    paintScanStatus();
    paintContent();
  };

  const syncTiersWithWorkspaceWidth = () => {
    tiersCollapsed = compactWorkspace.matches;
    render();
  };
  compactWorkspace.addEventListener('change', syncTiersWithWorkspaceWidth);

  let knownVersion: number | null = null;
  let refreshPending = false;
  let versionCheckRunning = false;
  const refreshWhenChanged = async () => {
    if (versionCheckRunning || document.visibilityState !== 'visible' || !context.project) return;
    versionCheckRunning = true;
    try {
      const { version } = await knowledgeApi.version();
      if (knownVersion !== null && version !== knownVersion) refreshPending = true;
      knownVersion = version;
    } catch {
      return;
    } finally {
      versionCheckRunning = false;
    }
    if (!refreshPending || !context.project || root.querySelector('.pmd-modal')) return;
    refreshPending = false;
    viewCache.delete(context.project.name);
    void load();
  };
  const versionTimer = window.setInterval(() => void refreshWhenChanged(), VERSION_POLL_INTERVAL_MS);
  const showRequestedView = () => {
    const view = takeRequestedView();
    if (!view) return;
    // « index-analysis » (ancien nom de la revue de l'Index) ouvre l'Index : c'est la même vue.
    active = view === 'index-analysis' ? 'chronology' : view;
    render();
  };
  window.addEventListener(VIEW_EVENT, showRequestedView);
  const showRequestedMapping = () => {
    mappingRequested = takeRequestedMapping();
    openRequestedMapping();
  };
  window.addEventListener(MAPPING_EVENT, showRequestedMapping);

  render();
  void load();
  void resumeScan();
  const unsubscribe = api.onContextChange((next) => {
    const changedProject = next.project?.name !== context.project?.name;
    const changedTheme = next.theme !== context.theme;
    context = next;
    if (changedProject) {
      closeIndex();
      data = null;
      proposals = undefined;
      scanJob = null;
      bodaccStates.clear();
      void load();
      void resumeScan();
    } else if (changedTheme) {
      root.dataset.theme = context.theme;
    }
  });
  (container as HTMLElement & { pmdUnsubscribe?: () => void }).pmdUnsubscribe = () => {
    closeIndex();
    destroyGraph?.();
    unsubscribe();
    compactWorkspace.removeEventListener('change', syncTiersWithWorkspaceWidth);
    window.clearInterval(versionTimer);
    window.removeEventListener(VIEW_EVENT, showRequestedView);
    window.removeEventListener(MAPPING_EVENT, showRequestedMapping);
  };
}

export function unmount(container: HTMLElement): void {
  const target = container as HTMLElement & { pmdUnsubscribe?: () => void };
  target.pmdUnsubscribe?.();
  delete target.pmdUnsubscribe;
  container.replaceChildren();
}
