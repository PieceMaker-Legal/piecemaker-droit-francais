import * as VisNetwork from 'vis-network/standalone';
import { DataSet } from 'vis-data/esnext';

import { knowledgeApi } from './api.js';
import { documentEditor, modal, nodeEditor, partyTypePicker } from './editors.js';
import { PLUGIN_STYLES } from './styles.js';
import { chronologyView, escapeHtml, generalView, graphView, mappingView, networkGraphData, shell } from './views.js';
import type { AgentsViewerState, Tab, ViewData } from './views.js';
import { EXCLUSIONS_NODE_ID } from './types.js';
import type { KnowledgeUpdateOperation } from './types.js';

type NetworkNode = {
  id: string;
  label: string;
  group: string;
  level: number;
  title: string;
  shape?: string;
  margin?: number;
  borderWidth?: number;
};

type NetworkEdge = {
  id: string;
  from: string;
  to: string;
  label: string;
  arrows?: { to: { enabled: boolean; scaleFactor: number } };
};

type NetworkInstance = {
  once(event: string, callback: () => void): void;
  on(event: string, callback: (parameters: { nodes: Array<string | number> }) => void): void;
  fit(options?: unknown): void;
  redraw(): void;
  destroy(): void;
};

const Network = (VisNetwork as unknown as { Network: new (...args: unknown[]) => NetworkInstance }).Network;

type PluginContext = {
  theme: 'dark' | 'light';
  project: { name: string; path: string } | null;
  session: { id: string; title: string } | null;
};

type PluginApi = {
  readonly context: PluginContext;
  onContextChange(callback: (context: PluginContext) => void): () => void;
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
  let network: NetworkInstance | null = null;
  let agentsViewer: AgentsViewerState = { open: false, loading: false, content: '', exists: false, error: '' };

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

  const renderGraph = () => {
    if (!data || active !== 'graph') return;
    const target = root.querySelector<HTMLElement>('[data-network]');
    if (!target) return;
    try {
      const dark = context.theme === 'dark';
      const graph = networkGraphData(data.graph);
      const nodes = new DataSet<NetworkNode>(graph.nodes.map((node) => ({ ...node, shape: 'box', margin: 12, borderWidth: node.level === 1 ? 3 : 1.5 })));
      const edges = new DataSet<NetworkEdge>(graph.edges.map((edge) => ({ ...edge, arrows: { to: { enabled: true, scaleFactor: .55 } } })));
      const options = {
        autoResize: true,
        layout: {
          hierarchical: {
            enabled: true,
            direction: 'LR',
            sortMethod: 'directed',
            levelSeparation: 250,
            nodeSpacing: 135,
            treeSpacing: 180,
            blockShifting: true,
            edgeMinimization: true,
            parentCentralization: true,
          },
        },
        physics: false,
        nodes: {
          font: { face: 'Inter, ui-sans-serif, system-ui, sans-serif', size: 13, color: dark ? '#fafafa' : '#18181b' },
          widthConstraint: { maximum: 220 },
          shadow: { enabled: true, color: '#00000024', size: 8, x: 0, y: 3 },
          chosen: { node: true, label: true },
        },
        edges: {
          color: { color: dark ? '#71717a' : '#a1a1aa', highlight: dark ? '#60a5fa' : '#2563eb', hover: dark ? '#60a5fa' : '#2563eb', inherit: false },
          font: { face: 'Inter, ui-sans-serif, system-ui, sans-serif', size: 10, color: dark ? '#d4d4d8' : '#52525b', strokeWidth: 4, strokeColor: dark ? '#18181b' : '#ffffff', align: 'middle' },
          smooth: { enabled: true, type: 'cubicBezier', forceDirection: 'horizontal', roundness: .45 },
          width: 1.3,
          selectionWidth: 2,
        },
        groups: {
          document: { color: { background: dark ? '#172554' : '#eff6ff', border: '#60a5fa', highlight: { background: '#dbeafe', border: '#2563eb' } }, font: { color: dark ? '#dbeafe' : '#1e3a8a' } },
          client: { color: { background: dark ? '#14532d' : '#dcfce7', border: '#22c55e', highlight: { background: '#bbf7d0', border: '#16a34a' } }, font: { color: dark ? '#dcfce7' : '#14532d' } },
          adverse: { color: { background: dark ? '#7f1d1d' : '#fee2e2', border: '#ef4444', highlight: { background: '#fecaca', border: '#dc2626' } }, font: { color: dark ? '#fee2e2' : '#7f1d1d' } },
          person: { color: { background: dark ? '#4c1d95' : '#f5f3ff', border: '#a78bfa' }, font: { color: dark ? '#ede9fe' : '#4c1d95' } },
          company: { color: { background: dark ? '#1e3a8a' : '#eff6ff', border: dark ? '#60a5fa' : '#2563eb', highlight: { background: dark ? '#1d4ed8' : '#dbeafe', border: dark ? '#93c5fd' : '#1d4ed8' } }, font: { color: dark ? '#dbeafe' : '#1e3a8a' } },
          financial: { color: { background: dark ? '#164e63' : '#ecfeff', border: '#06b6d4' }, font: { color: dark ? '#cffafe' : '#164e63' } },
          detail: { color: { background: dark ? '#27272a' : '#f4f4f5', border: '#a1a1aa' }, font: { color: dark ? '#e4e4e7' : '#27272a' } },
        },
        interaction: { hover: true, hoverConnectedEdges: true, multiselect: true, keyboard: { enabled: true, bindToWindow: false }, tooltipDelay: 250 },
      };
      network = new Network(target, { nodes, edges }, options);
      (container as HTMLElement & { pmdNetwork?: NetworkInstance }).pmdNetwork = network;
      network.once('afterDrawing', () => network?.fit({ animation: { duration: 350, easingFunction: 'easeInOutQuad' } }));
      target.closest<HTMLElement>('[data-network-frame]')?.addEventListener('fullscreenchange', () => {
        window.setTimeout(() => {
          network?.redraw();
          network?.fit({ animation: { duration: 250, easingFunction: 'easeInOutQuad' } });
        });
      });
      network.on('doubleClick', (parameters: { nodes: Array<string | number> }) => {
        const id = parameters.nodes[0];
        if (typeof id !== 'string' || !data) return;
        const node = data.graph.nodes.find((entry) => entry.id === id);
        if (!node) return;
        if (node.kind === 'document') documentEditor(root, data, node, save);
        else nodeEditor(root, data, node, save);
      });
    } catch (error) {
      target.innerHTML = `<div class="pmd-error">${escapeHtml(error instanceof Error ? error.message : error)}</div>`;
    }
  };

  const bind = () => {
    root.querySelectorAll<HTMLElement>('[data-tab]').forEach((button) => button.addEventListener('click', () => {
      active = button.dataset.tab as Tab;
      render();
    }));
    root.querySelectorAll<HTMLElement>('[data-action=refresh]').forEach((button) => button.addEventListener('click', () => void load()));
    root.querySelector<HTMLElement>('[data-action=fit-network]')?.addEventListener('click', () => network?.fit({ animation: { duration: 350, easingFunction: 'easeInOutQuad' } }));
    root.querySelector<HTMLElement>('[data-action=fullscreen-network]')?.addEventListener('click', async () => {
      const frame = root.querySelector<HTMLElement>('[data-network-frame]');
      if (!frame) return;
      if (document.fullscreenElement === frame) await document.exitFullscreen();
      else await frame.requestFullscreen();
    });
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
      if (side !== 'client' && side !== 'adversaire') return;
      partyTypePicker(root, side, (kind) => {
        if (data) nodeEditor(root, data, null, save, { kind, partySide: side });
      });
    }));
    root.querySelectorAll<HTMLElement>('[data-action=mapping]').forEach((button) => button.addEventListener('click', () => {
      if (!data) return;
      const layer = modal(root, mappingView(data));
      layer.querySelectorAll<HTMLElement>('[data-edit-node]').forEach((entry) => entry.addEventListener('click', () => {
        const node = data?.graph.nodes.find((candidate) => candidate.id === entry.dataset.editNode);
        layer.remove();
        if (data && node) nodeEditor(root, data, node, save);
      }));
      layer.querySelector<HTMLElement>('[data-action=add-node]')?.addEventListener('click', () => {
        layer.remove();
        if (data) nodeEditor(root, data, null, save);
      });
      layer.querySelectorAll<HTMLElement>('[data-remove-exclusion]').forEach((entry) => entry.addEventListener('click', async () => {
        const removed = entry.dataset.removeExclusion || '';
        const exclusions = (data?.mapping.exclusions || data?.graph.exclusions || []).filter((value) => value !== removed);
        layer.remove();
        try {
          await save([{ op: 'upsertNode', node: { id: EXCLUSIONS_NODE_ID, kind: 'other', label: 'Exclusions GLiNER', data: { systemRole: 'gliner-exclusions', values: exclusions }, origin: 'manual' } }]);
        } catch (error) {
          showError(error);
        }
      }));
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
        if (data && node) documentEditor(root, data, node, save);
      };
      card.addEventListener('click', open);
    });
    root.querySelectorAll<HTMLElement>('[data-edit-document]').forEach((button) => button.addEventListener('click', (event) => {
      event.stopPropagation();
      const node = data?.graph.nodes.find((entry) => entry.id === button.dataset.editDocument);
      if (data && node) documentEditor(root, data, node, save);
    }));
    root.querySelector<HTMLElement>('[data-action=agents]')?.addEventListener('click', async () => {
      if (!context.project) return;
      agentsViewer = { open: true, loading: true, content: '', exists: false, error: '' };
      render();
      try {
        const document = await knowledgeApi.agents(context.project.name);
        agentsViewer = { open: true, loading: false, content: document.content, exists: document.exists, error: '' };
        render();
      } catch (error) {
        agentsViewer = { open: true, loading: false, content: '', exists: false, error: error instanceof Error ? error.message : String(error) };
        render();
      }
    });
    root.querySelector<HTMLElement>('[data-action=close-agents]')?.addEventListener('click', () => {
      agentsViewer = { ...agentsViewer, open: false };
      render();
    });
  };

  const render = () => {
    network?.destroy();
    network = null;
    root.dataset.theme = context.theme;
    root.innerHTML = shell(active, data?.graph.mappings.length || 0, scanning, agentsViewer);
    const content = root.querySelector<HTMLElement>('[data-content]');
    if (!context.project) {
      if (content) content.innerHTML = '<div class="pmd-empty">Sélectionnez un projet CloudCLI.</div>';
    } else if (!data) {
      if (content) content.innerHTML = '<div class="pmd-empty">Chargement…</div>';
    } else if (content) {
      content.innerHTML = active === 'general' ? generalView(data) : active === 'chronology' ? chronologyView(data) : graphView();
    }
    bind();
    renderGraph();
  };

  render();
  void load();
  const unsubscribe = api.onContextChange((next) => {
    const changedProject = next.project?.name !== context.project?.name;
    context = next;
    if (changedProject) {
      data = null;
      agentsViewer = { open: false, loading: false, content: '', exists: false, error: '' };
      void load();
    } else {
      render();
    }
  });
  (container as HTMLElement & { pmdUnsubscribe?: () => void }).pmdUnsubscribe = unsubscribe;
}

export function unmount(container: HTMLElement): void {
  const target = container as HTMLElement & { pmdUnsubscribe?: () => void; pmdNetwork?: NetworkInstance };
  target.pmdUnsubscribe?.();
  target.pmdNetwork?.destroy();
  delete target.pmdUnsubscribe;
  delete target.pmdNetwork;
  container.replaceChildren();
}
