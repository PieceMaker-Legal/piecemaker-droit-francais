import { BODACC_FAMILIES, knowledgeApi } from './api.js';
import { buildCompanyValidationOperations } from './company-search.js';
import { documentEditor, institutionalTermsEditor, modal, nodeEditor, partyTypePicker } from './editors.js';
import { partyCodeChange } from './party-codes.js';
import { PLUGIN_STYLES } from './styles.js';
import { chronologyView, escapeHtml, generalView, mappingView, scanPercentLabel, scanStatusMarkup, scanView, shell } from './views.js';
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

const KNOWLEDGE_SCAN_EVENT = 'piecemaker:knowledge-scan-job';
const SCAN_POLL_INTERVAL_MS = 1000;
const viewCache = new Map<string, ViewData>();

export function mount(container: HTMLElement, api: PluginApi): void {
  const style = document.createElement('style');
  style.textContent = PLUGIN_STYLES;
  const root = document.createElement('div');
  root.className = 'pmd-root';
  root.style.position = 'relative';
  container.replaceChildren(style, root);
  let context = api.context;
  let active: Tab = 'general';
  let data: ViewData | null = null;
  let loadSequence = 0;
  let scanJob: ScanJob | null = null;
  const bodaccStates = new Map<string, BodaccScanState>();
  let draggedNodeId = '';
  let tiersCollapsed = false;

  const showError = (error: unknown) => {
    const target = root.querySelector<HTMLElement>('[data-error]');
    if (target) target.innerHTML = `<div class="pmd-error">${escapeHtml(error instanceof Error ? error.message : error)}</div>`;
  };

  const defaultBodaccFamilies = BODACC_FAMILIES.map((family) => family.code);
  const bodaccPreferenceKey = (companyId: string): string => `piecemaker-dossier:bodacc-families:${encodeURIComponent(context.project?.name || '')}:${encodeURIComponent(companyId)}`;
  const bodaccFamiliesFor = (companyId: string): string[] => {
    const existing = bodaccStates.get(companyId);
    if (Array.isArray(existing?.families)) return existing.families;
    let families = defaultBodaccFamilies;
    try {
      const stored = JSON.parse(localStorage.getItem(bodaccPreferenceKey(companyId)) || 'null') as unknown;
      if (Array.isArray(stored)) families = stored.filter((family): family is string => typeof family === 'string' && defaultBodaccFamilies.includes(family));
    } catch {
      families = defaultBodaccFamilies;
    }
    const state = existing || { status: 'idle' as const };
    state.families = families;
    bodaccStates.set(companyId, state);
    return families;
  };
  const rememberBodaccFamilies = (companyId: string, families: string[]) => {
    const state = bodaccStates.get(companyId) || { status: 'idle' as const };
    state.families = families;
    bodaccStates.set(companyId, state);
    try {
      localStorage.setItem(bodaccPreferenceKey(companyId), JSON.stringify(families));
    } catch {
      return;
    }
  };

  const searchBodaccCompany = async (companyId: string, siren: string, siret: string, renderAtStart = true, renderAtEnd = true) => {
    const state = bodaccStates.get(companyId) || { status: 'idle' as const };
    const families = bodaccFamiliesFor(companyId);
    state.families = families;
    state.open = true;
    if (!siren && !siret) {
      state.status = 'error';
      state.error = 'Aucun SIREN ou SIRET n’est renseigné pour cette personne morale.';
      bodaccStates.set(companyId, state);
      if (renderAtStart || renderAtEnd) render();
      return;
    }
    state.status = 'loading';
    state.error = '';
    bodaccStates.set(companyId, state);
    if (renderAtStart) render();
    try {
      state.result = await knowledgeApi.searchBodacc(siren, siret, families);
      state.status = 'loaded';
    } catch (error) {
      state.status = 'error';
      state.error = error instanceof Error ? error.message : 'Recherche BODACC impossible.';
    }
    bodaccStates.set(companyId, state);
    if (renderAtEnd && context.project) render();
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
    const state = bodaccStates.get(companyId) || { status: 'idle' as const };
    state.open = true;
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
    } else {
      data = null;
      render();
    }
    try {
      const graph = await knowledgeApi.graph(projectId);
      if (sequence !== loadSequence) return;
      data = { graph };
      viewCache.set(projectId, data);
      render();
    } catch (error) {
      if (sequence !== loadSequence) return;
      if (!cached) {
        data = null;
        render();
      }
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

  const openMapping = () => {
    if (!data) return;
    const mappingData = data;
    const layer = modal(root, mappingView(mappingData));
    layer.querySelectorAll<HTMLFormElement>('[data-mapping-row]').forEach((row) => row.addEventListener('submit', async (event) => {
      event.preventDefault();
      const node = mappingData.graph.nodes.find((candidate) => candidate.id === row.dataset.nodeId);
      if (!node) return;
      const form = new FormData(row);
      const label = String(form.get('label') || '').trim();
      const masked = String(form.get('masked') || '').trim();
      const aliases = String(form.get('aliases') || '').split(',').map((alias) => alias.trim()).filter(Boolean);
      if (!label) return;
      const mappings = mappingData.graph.mappings.filter((mapping) => mapping.nodeId === node.id);
      const operations: KnowledgeUpdateOperation[] = [{ op: 'upsertNode', node: { id: node.id, kind: node.kind, label, aliases, data: node.data, origin: 'manual' } }];
      for (const mapping of mappings) operations.push({ op: 'deleteMapping', mapping: { nodeId: node.id, real: mapping.real } });
      for (const real of [...new Set([label, ...aliases])]) operations.push({ op: 'upsertMapping', mapping: { nodeId: node.id, real, masked, origin: 'manual' } });
      try {
        await save(operations);
      } catch (error) {
        showError(error);
      }
    }));
    layer.querySelectorAll<HTMLElement>('[data-edit-node]').forEach((entry) => entry.addEventListener('click', () => {
      const node = mappingData.graph.nodes.find((candidate) => candidate.id === entry.dataset.editNode);
      layer.remove();
      if (node) nodeEditor(root, mappingData, node, save, {}, openMapping);
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
      if (!nodeId || !window.confirm('Supprimer cet élément et ses relations ?')) return;
      layer.remove();
      try {
        await save([{ op: 'deleteNode', nodeId }]);
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
    root.querySelectorAll<HTMLElement>('.pmd-profile-menu[data-open=true], .pmd-bodacc-family-menu[data-open=true]').forEach((menu) => {
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
    if (!status) return;
    const mappingCount = data?.graph.mappings.length || 0;
    const scanning = Boolean(scanJob && scanJob.state === 'running');
    status.dataset.ready = String(mappingCount > 0);
    status.dataset.scanning = String(scanning);
    status.innerHTML = scanStatusMarkup(mappingCount, scanJob);
  };

  const paintContent = () => {
    const content = root.querySelector<HTMLElement>('[data-content]');
    if (!content) return;
    if (!context.project) content.innerHTML = '<div class="pmd-empty">Sélectionnez un projet CloudCLI.</div>';
    else if (!data) content.innerHTML = '<div class="pmd-empty">Chargement…</div>';
    else content.innerHTML = active === 'general' ? generalView(data, tiersCollapsed) : active === 'chronology' ? chronologyView(data) : scanView(data, bodaccStates);
  };

  const bindOnce = () => {
    root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('.pmd-modal')) return;
      const familyMenu = target.closest<HTMLElement>('[data-bodacc-family-menu]');
      if (familyMenu) return;
      const familyTrigger = target.closest<HTMLElement>('[data-action="company-family-menu"]');
      if (familyTrigger) {
        const menu = familyTrigger.parentElement?.querySelector<HTMLElement>('[data-bodacc-family-menu]');
        closeOpenMenus(menu);
        if (!menu) return;
        const open = menu.dataset.open === 'true';
        menu.dataset.open = String(!open);
        familyTrigger.setAttribute('aria-expanded', String(!open));
        return;
      }
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
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      if (action === 'company-search') {
        const button = target.closest<HTMLElement>('[data-scan-company]');
        const companyId = button?.dataset.scanCompany || '';
        const company = data?.graph.nodes.find((node) => node.id === companyId);
        if (!company || !button) return;
        const identified = Boolean(company.data.registrePublic && typeof company.data.registrePublic === 'object');
        if (identified) void searchBodaccCompany(companyId, button.dataset.siren || '', button.dataset.siret || '');
        else void searchCompanyIdentity(companyId, button.dataset.siren || '', button.dataset.siret || '');
        return;
      }
      if (action === 'company-validate') {
        const button = target.closest<HTMLButtonElement>('[data-scan-company]');
        if (!button) return;
        const companyId = button.dataset.scanCompany || '';
        const company = data?.graph.nodes.find((node) => node.id === companyId);
        const state = bodaccStates.get(companyId);
        const result = state?.companySearchResults?.[Number(button.dataset.companyResult)];
        if (!data || !company || !result) return;
        button.disabled = true;
        void (async () => {
          try {
            await save(buildCompanyValidationOperations(result, {
              nodeId: company.id,
              node: company,
              partySide: (typeof company.data.partySide === 'string' ? company.data.partySide : '') as PartySide,
              position: typeof company.data.position === 'string' ? company.data.position : '',
              legalForm: typeof company.data.legalForm === 'string' ? company.data.legalForm : '',
            }, data.graph));
            const nextState = bodaccStates.get(companyId) || { status: 'idle' as const };
            nextState.companySearchStatus = 'idle';
            nextState.companySearchResults = [];
            bodaccStates.set(companyId, nextState);
            await searchBodaccCompany(companyId, result.fields.siren || result.siren, result.fields.siret);
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
      if (action === 'scan-all-companies') {
        const companies = Array.from(root.querySelectorAll<HTMLElement>('.pmd-scan-company[data-scan-company]'));
        const searches = companies.map((company) => searchBodaccCompany(company.dataset.scanCompany || '', company.dataset.siren || '', company.dataset.siret || '', false, false));
        render();
        void Promise.all(searches).then(() => render());
        return;
      }
      if (action === 'refresh') {
        if (context.project) viewCache.delete(context.project.name);
        void load();
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
        if (!context.project || !scanJob || !window.confirm('Arrêter l’analyse en cours ?')) return;
        void knowledgeApi.cancelScan(scanJob.id, context.project.name).catch(showError);
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
        api.openFileInEditor('AGENTS.md');
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
        if (!nodeId || !window.confirm('Retirer la désignation de partie de ce profil ?')) return;
        void save([{ op: 'removePartyDesignation', nodeId }]).catch(showError);
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
        if (data && node) nodeEditor(root, data, node, save);
        return;
      }
      const deleteNode = target.closest<HTMLElement>('[data-delete-node]');
      if (deleteNode) {
        if (!deleteNode.dataset.deleteNode || !window.confirm('Supprimer cet élément et ses relations ?')) return;
        void save([{ op: 'deleteNode', nodeId: deleteNode.dataset.deleteNode }]).catch(showError);
        return;
      }
      const editDocument = target.closest<HTMLElement>('[data-edit-document]');
      if (editDocument) {
        const node = data?.graph.nodes.find((entry) => entry.id === editDocument.dataset.editDocument);
        if (data && node) documentEditor(root, data, node, context.project?.path || '', save);
        return;
      }
      const openDocument = target.closest<HTMLElement>('[data-open-document]');
      if (openDocument) {
        const node = data?.graph.nodes.find((entry) => entry.id === openDocument.dataset.openDocument);
        if (data && node) documentEditor(root, data, node, context.project?.path || '', save);
      }
    });
    root.addEventListener('change', (event) => {
      const checkbox = (event.target as HTMLElement).closest<HTMLInputElement>('[data-bodacc-family]');
      if (!checkbox) return;
      const companyId = checkbox.dataset.scanCompany || '';
      if (!companyId) return;
      const families = Array.from(root.querySelectorAll<HTMLInputElement>('[data-bodacc-family]')).filter((entry) => entry.dataset.scanCompany === companyId && entry.checked).map((entry) => entry.dataset.bodaccFamily || '').filter(Boolean);
      rememberBodaccFamilies(companyId, families);
    });
    root.addEventListener('toggle', (event) => {
      const details = event.target as HTMLElement;
      const companyId = details.dataset?.bodaccDetails;
      if (!companyId) return;
      const state = bodaccStates.get(companyId) || { status: 'idle' as const };
      state.open = (details as HTMLDetailsElement).open;
      bodaccStates.set(companyId, state);
    }, true);
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
            );
            const operations: KnowledgeUpdateOperation[] = [...change.operations];
            operations.push({ op: 'upsertNode', node: { id: change.nodeId, kind: node.kind, label: node.label, aliases: node.aliases, data: change.data, origin: 'manual' } });
            for (const real of [node.label, ...node.aliases]) if (change.code) operations.push({ op: 'upsertMapping', mapping: { nodeId: change.nodeId, real, masked: change.code, origin: 'manual' } });
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
      const relation = window.prompt('Nommez le lien entre ces profils :', 'Dirigeant')?.trim();
      if (!relation) return;
      void save([{ op: 'link', link: { fromNodeId: source, toNodeId: destination, relation, origin: 'manual' } }]).catch(showError);
    });
  };

  const render = () => {
    root.dataset.theme = context.theme;
    if (!root.querySelector('[data-content]')) {
      root.innerHTML = shell(active, data?.graph.mappings.length || 0, scanJob);
      bindOnce();
    } else {
      paintTabs();
      paintScanStatus();
    }
    paintContent();
  };

  render();
  void load();
  void resumeScan();
  const unsubscribe = api.onContextChange((next) => {
    const changedProject = next.project?.name !== context.project?.name;
    const changedTheme = next.theme !== context.theme;
    context = next;
    if (changedProject) {
      data = null;
      scanJob = null;
      bodaccStates.clear();
      void load();
      void resumeScan();
    } else if (changedTheme) {
      root.dataset.theme = context.theme;
    }
  });
  (container as HTMLElement & { pmdUnsubscribe?: () => void }).pmdUnsubscribe = unsubscribe;
}

export function unmount(container: HTMLElement): void {
  const target = container as HTMLElement & { pmdUnsubscribe?: () => void };
  target.pmdUnsubscribe?.();
  delete target.pmdUnsubscribe;
  container.replaceChildren();
}
