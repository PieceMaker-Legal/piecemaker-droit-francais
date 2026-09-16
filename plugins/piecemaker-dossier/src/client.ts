import { BODACC_FAMILIES, knowledgeApi } from './api.js';
import { buildCompanyValidationOperations } from './company-search.js';
import { documentEditor, institutionalTermsEditor, modal, nodeEditor, partyTypePicker } from './editors.js';
import { partyCodeChange } from './party-codes.js';
import { PLUGIN_STYLES } from './styles.js';
import { chronologyView, escapeHtml, generalView, mappingView, scanPercentLabel, scanView, shell } from './views.js';
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

export function mount(container: HTMLElement, api: PluginApi): void {
  const style = document.createElement('style');
  style.textContent = PLUGIN_STYLES;
  const root = document.createElement('div');
  root.className = 'pmd-root';
  root.style.position = 'relative';
  container.replaceChildren(style, root);
  root.addEventListener('click', () => root.querySelectorAll<HTMLElement>('.pmd-profile-menu[data-open=true], .pmd-bodacc-family-menu[data-open=true]').forEach((menu) => { menu.dataset.open = 'false'; }));
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
    try {
      const [overview, mapping, chronology, graph] = await Promise.all([
        knowledgeApi.overview(projectId),
        knowledgeApi.mapping(projectId),
        knowledgeApi.chronology(projectId),
        knowledgeApi.graph(projectId),
      ]);
      if (sequence !== loadSequence) return;
      data = { overview, mapping, chronology, graph };
      render();
    } catch (error) {
      if (sequence !== loadSequence) return;
      data = null;
      render();
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

  const bind = () => {
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((button) => button.addEventListener('click', () => {
      active = button.dataset.tab as Tab;
      render();
    }));
    root.querySelectorAll<HTMLElement>('[data-bodacc-details]').forEach((details) => details.addEventListener('toggle', () => {
      const companyId = details.dataset.bodaccDetails;
      if (!companyId) return;
      const state = bodaccStates.get(companyId) || { status: 'idle' as const };
      state.open = (details as HTMLDetailsElement).open;
      bodaccStates.set(companyId, state);
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-action=company-search][data-scan-company]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const companyId = button.dataset.scanCompany || '';
      const company = data?.graph.nodes.find((node) => node.id === companyId);
      if (!company) return;
      const identified = Boolean(company.data.registrePublic && typeof company.data.registrePublic === 'object');
      if (identified) void searchBodaccCompany(companyId, button.dataset.siren || '', button.dataset.siret || '');
      else void searchCompanyIdentity(companyId, button.dataset.siren || '', button.dataset.siret || '');
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-action=company-validate][data-scan-company]').forEach((button) => button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const companyId = button.dataset.scanCompany || '';
      const company = data?.graph.nodes.find((node) => node.id === companyId);
      const state = bodaccStates.get(companyId);
      const result = state?.companySearchResults?.[Number(button.dataset.companyResult)];
      if (!data || !company || !result) return;
      button.disabled = true;
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
    }));
    root.querySelectorAll<HTMLButtonElement>('[data-action=company-family-menu]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const menu = button.parentElement?.querySelector<HTMLElement>('[data-bodacc-family-menu]');
      root.querySelectorAll<HTMLElement>('[data-bodacc-family-menu][data-open=true]').forEach((entry) => { if (entry !== menu) entry.dataset.open = 'false'; });
      if (!menu) return;
      const open = menu.dataset.open === 'true';
      menu.dataset.open = String(!open);
      button.setAttribute('aria-expanded', String(!open));
    }));
    root.querySelectorAll<HTMLElement>('[data-bodacc-family-menu]').forEach((menu) => menu.addEventListener('click', (event) => event.stopPropagation()));
    root.querySelectorAll<HTMLInputElement>('[data-bodacc-family]').forEach((checkbox) => checkbox.addEventListener('change', () => {
      const companyId = checkbox.dataset.scanCompany || '';
      if (!companyId) return;
      const families = Array.from(root.querySelectorAll<HTMLInputElement>('[data-bodacc-family]')).filter((entry) => entry.dataset.scanCompany === companyId && entry.checked).map((entry) => entry.dataset.bodaccFamily || '').filter(Boolean);
      rememberBodaccFamilies(companyId, families);
    }));
    root.querySelector<HTMLElement>('[data-action=scan-all-companies]')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      const companies = Array.from(root.querySelectorAll<HTMLElement>('.pmd-scan-company[data-scan-company]'));
      const searches = companies.map((company) => searchBodaccCompany(company.dataset.scanCompany || '', company.dataset.siren || '', company.dataset.siret || '', false, false));
      render();
      await Promise.all(searches);
      render();
    });
    root.querySelectorAll<HTMLElement>('[data-action=refresh]').forEach((button) => button.addEventListener('click', () => void load()));
    root.querySelector<HTMLElement>('[data-action=toggle-tiers]')?.addEventListener('click', (event) => {
      event.stopPropagation();
      const button = event.currentTarget as HTMLElement;
      const layout = root.querySelector<HTMLElement>('.pmd-party-layout');
      const column = root.querySelector<HTMLElement>('[data-tiers-column]');
      if (!layout || !column) return;
      const collapsed = column.dataset.collapsed === 'true';
      tiersCollapsed = !collapsed;
      column.dataset.collapsed = String(!collapsed);
      layout.dataset.tiersCollapsed = String(!collapsed);
      button.setAttribute('aria-expanded', String(collapsed));
    });
    root.querySelector<HTMLElement>('[data-action=cancel-scan]')?.addEventListener('click', async () => {
      if (!context.project || !scanJob || !window.confirm('Arrêter l’analyse en cours ?')) return;
      try {
        await knowledgeApi.cancelScan(scanJob.id, context.project.name);
      } catch (error) {
        showError(error);
      }
    });
    root.querySelector<HTMLElement>('[data-action=scan]')?.addEventListener('click', async () => {
      if (!context.project || scanJob) return;
      try {
        const { job } = await knowledgeApi.scan(context.project.name);
        await followScan(job);
      } catch (error) {
        scanJob = null;
        render();
        showError(error);
      }
    });
    root.querySelector<HTMLElement>('[data-action=add-node]')?.addEventListener('click', () => {
      if (data) nodeEditor(root, data, null, save);
    });
    root.querySelectorAll<HTMLElement>('[data-party-picker]').forEach((button) => button.addEventListener('click', () => {
      if (!data) return;
      const side = button.dataset.partyPicker;
      if (side !== 'client' && side !== 'adversaire' && side !== 'tiers') return;
      partyTypePicker(root, side, (kind) => {
        if (data) nodeEditor(root, data, null, save, { kind, partySide: side });
      });
    }));
    root.querySelectorAll<HTMLElement>('[data-party-drop]').forEach((target) => {
      target.addEventListener('dragover', (event) => {
        event.preventDefault();
        target.dataset.dropActive = 'true';
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      });
      target.addEventListener('dragleave', (event) => {
        if (!target.contains(event.relatedTarget as Node | null)) delete target.dataset.dropActive;
      });
      target.addEventListener('drop', async (event) => {
        event.preventDefault();
        delete target.dataset.dropActive;
        const sourceId = draggedNodeId || event.dataTransfer?.getData('text/plain') || '';
        const side = target.dataset.partyDrop;
        const node = data?.graph.nodes.find((entry) => entry.id === sourceId);
        if (!node || (side !== 'client' && side !== 'adversaire')) return;
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
      });
    });
    root.querySelectorAll<HTMLElement>('[data-action=mapping]').forEach((button) => button.addEventListener('click', openMapping));
    root.querySelectorAll<HTMLButtonElement>('[data-remove-party]').forEach((button) => button.addEventListener('click', async (event) => {
      event.stopPropagation();
      const nodeId = button.dataset.removeParty;
      if (!nodeId || !window.confirm('Retirer la désignation de partie de ce profil ?')) return;
      try {
        await save([{ op: 'removePartyDesignation', nodeId }]);
      } catch (error) {
        showError(error);
      }
    }));
    root.querySelectorAll<HTMLElement>('[data-node-menu]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const menu = button.parentElement?.querySelector<HTMLElement>('.pmd-profile-menu');
      root.querySelectorAll<HTMLElement>('.pmd-profile-menu[data-open=true]').forEach((entry) => { if (entry !== menu) entry.dataset.open = 'false'; });
      if (menu) menu.dataset.open = menu.dataset.open === 'true' ? 'false' : 'true';
    }));
    root.querySelectorAll<HTMLElement>('[data-profile-id]').forEach((card) => {
      card.addEventListener('dragstart', (event) => {
        draggedNodeId = card.dataset.profileId || '';
        event.dataTransfer?.setData('text/plain', draggedNodeId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'linkMove';
      });
      card.addEventListener('dragend', () => { draggedNodeId = ''; });
    });
    root.querySelectorAll<HTMLElement>('[data-relation-drop]').forEach((target) => {
      target.addEventListener('dragover', (event) => { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'link'; });
      target.addEventListener('drop', async (event) => {
        event.preventDefault();
        const source = draggedNodeId || event.dataTransfer?.getData('text/plain') || '';
        const destination = target.dataset.relationDrop || '';
        if (!source || !destination || source === destination) return;
        const relation = window.prompt('Nommez le lien entre ces profils :', 'Dirigeant')?.trim();
        if (!relation) return;
        try {
          await save([{ op: 'link', link: { fromNodeId: source, toNodeId: destination, relation, origin: 'manual' } }]);
        } catch (error) {
          showError(error);
        }
      });
    });
    root.querySelectorAll<HTMLElement>('[data-unlink-from]').forEach((button) => button.addEventListener('click', async () => {
      const fromNodeId = button.dataset.unlinkFrom || '';
      const toNodeId = button.dataset.unlinkTo || '';
      const relation = button.dataset.unlinkRelation || '';
      if (!fromNodeId || !toNodeId || !relation) return;
      try {
        await save([{ op: 'unlink', link: { fromNodeId, toNodeId, relation } }]);
      } catch (error) {
        showError(error);
      }
    }));
    root.querySelectorAll<HTMLElement>('[data-edit-node]').forEach((button) => button.addEventListener('click', () => {
      const node = data?.graph.nodes.find((entry) => entry.id === button.dataset.editNode);
      if (data && node) nodeEditor(root, data, node, save);
    }));
    root.querySelectorAll<HTMLElement>('[data-delete-node]').forEach((button) => button.addEventListener('click', async () => {
      if (!button.dataset.deleteNode || !window.confirm('Supprimer cet élément et ses relations ?')) return;
      try {
        await save([{ op: 'deleteNode', nodeId: button.dataset.deleteNode }]);
      } catch (error) {
        showError(error);
      }
    }));
    root.querySelectorAll<HTMLElement>('[data-open-document]').forEach((card) => {
      const open = () => {
        const node = data?.graph.nodes.find((entry) => entry.id === card.dataset.openDocument);
        if (data && node) documentEditor(root, data, node, context.project?.path || '', save);
      };
      card.addEventListener('click', open);
    });
    root.querySelectorAll<HTMLElement>('[data-edit-document]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const node = data?.graph.nodes.find((entry) => entry.id === button.dataset.editDocument);
      if (data && node) documentEditor(root, data, node, context.project?.path || '', save);
    }));
    root.querySelector<HTMLElement>('[data-action=agents]')?.addEventListener('click', () => api.openFileInEditor('AGENTS.md'));
  };

  const render = () => {
    root.dataset.theme = context.theme;
    root.innerHTML = shell(active, data?.graph.mappings.length || 0, scanJob);
    const content = root.querySelector<HTMLElement>('[data-content]');
    if (!context.project) {
      if (content) content.innerHTML = '<div class="pmd-empty">Sélectionnez un projet CloudCLI.</div>';
    } else if (!data) {
      if (content) content.innerHTML = '<div class="pmd-empty">Chargement…</div>';
    } else if (content) {
      content.innerHTML = active === 'general' ? generalView(data, tiersCollapsed) : active === 'chronology' ? chronologyView(data) : scanView(data, bodaccStates);
    }
    bind();
  };

  render();
  void load();
  void resumeScan();
  const unsubscribe = api.onContextChange((next) => {
    const changedProject = next.project?.name !== context.project?.name;
    context = next;
    if (changedProject) {
      data = null;
      scanJob = null;
      bodaccStates.clear();
      void load();
      void resumeScan();
    } else {
      render();
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
