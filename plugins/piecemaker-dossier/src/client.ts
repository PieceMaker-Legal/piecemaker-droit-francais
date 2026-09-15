import mermaid from 'mermaid';

import { knowledgeApi } from './api.js';
import { documentEditor, modal, nodeEditor } from './editors.js';
import { PLUGIN_STYLES } from './styles.js';
import { chronologyView, escapeHtml, generalView, graphView, mermaidSource, shell } from './views.js';
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
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: context.theme === 'dark' ? 'dark' : 'default', flowchart: { htmlLabels: false, curve: 'basis' } });
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
    root.querySelector<HTMLElement>('[data-action=scan]')?.addEventListener('click', async (event) => {
      if (!context.project) return;
      const button = event.currentTarget as HTMLButtonElement;
      button.disabled = true;
      button.textContent = 'Analyse en cours…';
      try {
        await knowledgeApi.scan(context.project.name);
        await load();
      } catch (error) {
        showError(error);
      } finally {
        button.disabled = false;
        button.textContent = 'Analyser';
      }
    });
    root.querySelector<HTMLElement>('[data-action=add-node]')?.addEventListener('click', () => {
      if (data) nodeEditor(root, data, null, save);
    });
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
      try {
        const document = await knowledgeApi.agents(context.project.name);
        modal(root, `<div class="pmd-toolbar"><h2 class="pmd-title">Agents.md</h2><span class="pmd-spacer"></span><button class="pmd-icon-button" data-close>×</button></div><pre class="pmd-code">${escapeHtml(document.exists ? document.content : 'Aucun fichier AGENTS.md dans ce projet.')}</pre>`);
      } catch (error) {
        showError(error);
      }
    });
  };

  const render = () => {
    root.dataset.theme = context.theme;
    root.innerHTML = shell(active);
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
