export type OkfRelation = { relation: string; cible: string; citation: string; origine: string };
export type OkfFiche = { id: string; type: string; title: string; description: string; resource: string; date: string; atomes: number; relations: OkfRelation[] };
export type OkfIndex = { types: string[]; typesGraphe: string[]; fiches: OkfFiche[] };
export type OkfError = { fiche: string; erreur: string };
export type OkfView = { index: OkfIndex | null; mode: 'table' | 'graph'; errors: OkfError[] | null };

export const RELATION_LABELS: Record<string, string> = { modifie: 'modifie', 'repond-a': 'répond à', 'se-refere-a': 'se réfère à' };
const INCOMING_LABELS: Record<string, string> = { modifie: 'modifié par', 'repond-a': 'répondu par', 'se-refere-a': 'visé par' };

async function request<T>(path: string): Promise<T> {
  const token = localStorage.getItem('auth-token');
  const response = await fetch(`/api/piecemaker/okf${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Index OKF indisponible (${response.status}).`);
  return body as T;
}

export const okfApi = {
  read: (projectId: string) => request<OkfIndex>(`?projectId=${encodeURIComponent(projectId)}`),
  verify: (projectId: string) => request<{ erreurs: OkfError[] }>(`/verifier?projectId=${encodeURIComponent(projectId)}`),
};

export function ficheLinks(index: OkfIndex | null, resource: string): Array<{ label: string; title: string; citation: string }> {
  const fiche = index?.fiches.find((entry) => entry.resource === resource.normalize('NFC'));
  if (!index || !fiche) return [];
  const titleOf = (id: string) => index.fiches.find((entry) => entry.id === id)?.title || id;
  return [
    ...fiche.relations.map((entry) => ({ label: `${RELATION_LABELS[entry.relation] || entry.relation} →`, title: titleOf(entry.cible), citation: entry.citation })),
    ...index.fiches.flatMap((other) => other.relations
      .filter((entry) => entry.cible === fiche.id)
      .map((entry) => ({ label: `← ${INCOMING_LABELS[entry.relation] || entry.relation}`, title: other.title, citation: entry.citation }))),
  ];
}

export function graphElements(index: OkfIndex): Array<{ data: Record<string, string> }> {
  const fiches = index.fiches.filter((fiche) => index.typesGraphe.includes(fiche.type));
  const ids = new Set(fiches.map((fiche) => fiche.id));
  return [
    ...fiches.map((fiche) => ({ data: { id: fiche.id, label: fiche.title, resource: fiche.resource } })),
    ...fiches.flatMap((fiche) => fiche.relations
      .filter((entry) => ids.has(entry.cible))
      .map((entry) => ({ data: { id: `${fiche.id}|${entry.relation}|${entry.cible}`, source: fiche.id, target: entry.cible, label: RELATION_LABELS[entry.relation] || entry.relation } }))),
  ];
}

export async function mountGraph(container: HTMLElement, index: OkfIndex, onOpen: (resource: string) => void): Promise<() => void> {
  const { default: cytoscape } = await import('cytoscape');
  const style = getComputedStyle(container);
  const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const text = color('--pmd-text', '#1f2328');
  const border = color('--pmd-border', '#d0d7de');
  const graph = cytoscape({
    container,
    elements: graphElements(index),
    layout: { name: 'cose', animate: false, padding: 30, nodeRepulsion: () => 12000, idealEdgeLength: () => 110 },
    style: [
      { selector: 'node', style: { label: 'data(label)', shape: 'round-rectangle', width: 'label', height: 'label', padding: '8px', 'background-color': color('--pmd-soft', '#f6f8fa'), 'border-width': 1, 'border-color': border, color: text, 'font-size': 11, 'text-valign': 'center', 'text-halign': 'center', 'text-wrap': 'wrap', 'text-max-width': '160px' } },
      { selector: 'edge', style: { label: 'data(label)', width: 1.5, 'line-color': border, 'target-arrow-color': border, 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', color: color('--pmd-muted', '#656d76'), 'font-size': 9, 'text-background-color': color('--pmd-surface', '#ffffff'), 'text-background-opacity': 1, 'text-background-padding': '2px' } },
    ],
  });
  graph.on('tap', 'node', (event) => onOpen(String(event.target.data('resource'))));
  return () => graph.destroy();
}
