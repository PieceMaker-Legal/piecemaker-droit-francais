import mermaid from 'mermaid';

import { knowledgeApi } from './api.js';
import { documentEditor, modal, nodeEditor } from './editors.js';
import { PLUGIN_STYLES } from './styles.js';
import { chronologyView, escapeHtml, generalView, graphView, mappingView, mermaidSource, shell } from './views.js';
import type { AgentsViewerState, Tab, ViewData } from './views.js';
import type { KnowledgeUpdateOperation } from './types.js';

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

  const renderGraph = async () => {
    if (!data || active !== 'graph') return;
    const target = root.querySelector<HTMLElement>('[data-mermaid]');
    if (!target) return;
    try {
      const dark = context.theme === 'dark';
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        layout: 'elk',
        look: 'classic',
        theme: 'base',
        themeVariables: {
          background: dark ? '#18181b' : '#ffffff',
          primaryTextColor: dark ? '#fafafa' : '#18181b',
          lineColor: dark ? '#71717a' : '#a1a1aa',
          clusterBkg: dark ? '#18181b' : '#fafafa',
          clusterBorder: dark ? '#3f3f46' : '#e4e4e7',
          fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
        },
        flowchart: { htmlLabels: false, curve: 'basis', nodeSpacing: 42, rankSpacing: 72, useMaxWidth: false },
      });
      const rendered = await mermaid.render(`pmd-graph-${Date.now()}`, mermaidSource(data.graph));
      target.innerHTML = rendered.svg;
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
    root.querySelectorAll<HTMLElement>('[data-action=mapping]').forEach((button) => button.addEventListener('click', () => {
      if (!data) return;
      const layer = modal(root, mappingView(data));
      layer.querySelectorAll<HTMLElement>('[data-edit-node]').forEach((entry) => entry.addEventListener('click', () => {
        const node = data?.graph.nodes.find((candidate) => candidate.id === entry.dataset.editNode);
        layer.remove();
        if (data && node) nodeEditor(root, data, node, save);
      }));
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
    root.querySelectorAll<HTMLElement>('[data-edit-document]').forEach((button) => button.addEventListener('click', () => {
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
    void renderGraph();
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
  const target = container as HTMLElement & { pmdUnsubscribe?: () => void };
  target.pmdUnsubscribe?.();
  delete target.pmdUnsubscribe;
  container.replaceChildren();
}
