import { knowledgeApi } from './api.js';
import { documentEditor, institutionalTermsEditor, modal, nodeEditor, partyTypePicker } from './editors.js';
import { PLUGIN_STYLES } from './styles.js';
import { chronologyView, escapeHtml, generalView, mappingView, shell } from './views.js';
import type { Tab, ViewData } from './views.js';
import type { KnowledgeUpdateOperation } from './types.js';

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
  let scanning = false;
  let draggedNodeId = '';

  const showError = (error: unknown) => {
    const target = root.querySelector<HTMLElement>('[data-error]');
    if (target) target.innerHTML = `<div class="pmd-error">${escapeHtml(error instanceof Error ? error.message : error)}</div>`;
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
    root.querySelectorAll<HTMLElement>('[data-action=refresh]').forEach((button) => button.addEventListener('click', () => void load()));
    root.querySelector<HTMLElement>('[data-action=scan]')?.addEventListener('click', async () => {
      if (!context.project || scanning) return;
      scanning = true;
      render();
      try {
        await knowledgeApi.scan(context.project.name);
        scanning = false;
        await load();
      } catch (error) {
        scanning = false;
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
    root.querySelectorAll<HTMLElement>('[data-action=mapping]').forEach((button) => button.addEventListener('click', openMapping));
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
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'link';
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
    root.innerHTML = shell(active, data?.graph.mappings.length || 0, scanning);
    const content = root.querySelector<HTMLElement>('[data-content]');
    if (!context.project) {
      if (content) content.innerHTML = '<div class="pmd-empty">Sélectionnez un projet CloudCLI.</div>';
    } else if (!data) {
      if (content) content.innerHTML = '<div class="pmd-empty">Chargement…</div>';
    } else if (content) {
      content.innerHTML = active === 'general' ? generalView(data) : chronologyView(data);
    }
    bind();
  };

  render();
  void load();
  const unsubscribe = api.onContextChange((next) => {
    const changedProject = next.project?.name !== context.project?.name;
    context = next;
    if (changedProject) {
      data = null;
      void load();
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
