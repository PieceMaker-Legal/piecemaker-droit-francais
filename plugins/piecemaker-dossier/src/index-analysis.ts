import { authenticatedFetch } from '../../../src/shared/authToken.js';
import { tabularReviewRpc } from './api.js';

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

/** Ligne du Case index telle que la revue tabulaire la décrit : la pièce est `piece`, ou à défaut le premier document. */
export type IndexRow = { id: string; piece?: string; documents: Array<{ source: string }> };

type RowColumn = { title: string; cell(row: IndexRow): string };

/** Mode chronologie : l'onglet dit s'il est actif et quelles lignes sont des pièces ; la revue n'affiche alors qu'elles, par date. */
export type IndexChronology = { active(): boolean; isPiece(row: IndexRow): boolean; subscribe(callback: () => void): () => void };

/** Type principal des pièces du dossier (dossier de premier niveau « Pièces » de l'arborescence). */
export const PIECE_TYPE = 'Pièces';

/** Une ligne est une pièce si sa fiche OKF est du type Pièces. Tant que l'index OKF n'est pas lu, toutes les lignes comptent. */
export function isPieceRow(okf: { fiches: Array<{ resource: string; type: string }> } | null | undefined, row: IndexRow): boolean {
  if (!okf) return true;
  return okf.fiches.find((fiche) => fiche.resource === indexRowResource(row))?.type === PIECE_TYPE;
}

type AnalysisModule = {
  mount(container: HTMLElement, api: AnalysisApi & { rpc: typeof tabularReviewRpc }, index: { project: string; draft?: string; rowColumn?: RowColumn; chronology?: IndexChronology }): void;
  unmount(container: HTMLElement): void;
};

/** Chemin de la pièce d'une ligne, relatif au dossier : la clé des fiches OKF. */
export function indexRowResource(row: IndexRow): string {
  return (row.piece || row.documents[0]?.source || '').replace(/\\/g, '/').replace(/^\.\//, '').normalize('NFC');
}

let analysisModule: Promise<AnalysisModule> | null = null;

function loadAnalysis(): Promise<AnalysisModule> {
  analysisModule ??= (async () => {
    const response = await authenticatedFetch('/api/plugins/piecemaker-tabular-review/assets/dist/index.js');
    if (!response.ok) throw new Error(`Case index indisponible : activez le plugin « Analyse Tabulaire » (${response.status}).`);
    const url = URL.createObjectURL(new Blob([await response.text()], { type: 'application/javascript' }));
    try { return await import(url) as AnalysisModule; }
    finally { URL.revokeObjectURL(url); }
  })();
  analysisModule.catch(() => { analysisModule = null; });
  return analysisModule;
}

/** Le Case index, affiché dans l'onglet même : c'est la revue tabulaire du Case index (SQLite), avec une colonne de liens OKF par pièce. */
export async function mountIndexAnalysis(container: HTMLElement, api: AnalysisApi, links: (resource: string) => string, chronology?: IndexChronology): Promise<() => void> {
  const project = api.context.project?.path;
  if (!project) return () => {};
  const analysis = await loadAnalysis();
  if (api.context.project?.path !== project || !container.isConnected) return () => {};
  const rowColumn: RowColumn = { title: 'Liens', cell: (row) => `<div class="pmd-badges" data-okf-links="${escapeAttribute(indexRowResource(row))}">${links(indexRowResource(row))}</div>` };
  analysis.mount(container, { get context() { return api.context; }, onContextChange: api.onContextChange.bind(api), openFileInEditor: api.openFileInEditor.bind(api), rpc: tabularReviewRpc }, { project, rowColumn, ...(chronology ? { chronology } : {}) });
  return () => analysis.unmount(container);
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
