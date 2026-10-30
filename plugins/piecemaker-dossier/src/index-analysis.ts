import { tabularReviewRpc } from './api.js';
import { modal } from './editors.js';

type AnalysisContext = {
  theme: 'light' | 'dark';
  project: { name: string; path: string } | null;
  session: { id: string; title: string } | null;
};

type AnalysisApi = {
  readonly context: AnalysisContext;
  onContextChange(callback: (context: AnalysisContext) => void): () => void;
  openFileInEditor(filePath: string): void;
};

type AnalysisModule = {
  mount(container: HTMLElement, api: AnalysisApi & { rpc: typeof tabularReviewRpc }, index: { project: string; onBack(): void }): void;
  unmount(container: HTMLElement): void;
};

export async function openIndexAnalysis(root: HTMLElement, api: AnalysisApi, onBack: () => void): Promise<() => void> {
  const project = api.context.project?.path;
  if (!project) return () => {};
  const token = localStorage.getItem('auth-token');
  const response = await fetch('/api/plugins/piecemaker-tabular-review/assets/dist/index.js', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(`Analyse tabulaire indisponible (${response.status}).`);
  const url = URL.createObjectURL(new Blob([await response.text()], { type: 'application/javascript' }));
  let analysis: AnalysisModule;
  try { analysis = await import(url) as AnalysisModule; }
  finally { URL.revokeObjectURL(url); }
  if (api.context.project?.path !== project || !root.isConnected) return () => {};
  const layer = modal(root, '<button type="button" class="pmd-button" data-close-index>Fermer</button><div class="pmd-index-analysis" data-index-analysis></div>');
  const dialog = layer.querySelector('.pmd-dialog')!;
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-label', 'Analyse tabulaire de l’Index');
  const container = layer.querySelector<HTMLElement>('[data-index-analysis]')!;
  const dispose = () => { analysis.unmount(container); layer.remove(); };
  const close = () => { dispose(); onBack(); };
  layer.addEventListener('click', (event) => { if (event.target === layer || (event.target as HTMLElement).closest('[data-close-index]')) close(); });
  layer.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !layer.querySelector('.ptr-overlay,.ptr-drawer-backdrop')) close(); });
  analysis.mount(container, { get context() { return api.context; }, onContextChange: api.onContextChange.bind(api), openFileInEditor: api.openFileInEditor.bind(api), rpc: tabularReviewRpc }, { project, onBack: close });
  return dispose;
}
