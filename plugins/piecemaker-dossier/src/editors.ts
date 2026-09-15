import { entityKinds, escapeHtml, labels, textValue, dateFor } from './views.js';
import type { ViewData } from './views.js';
import type { KnowledgeNode, KnowledgeUpdateOperation, NodeKind } from './types.js';

export function modal(root: HTMLElement, body: string): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'pmd-modal';
  layer.innerHTML = `<div class="pmd-dialog">${body}</div>`;
  root.appendChild(layer);
  layer.addEventListener('click', (event) => { if (event.target === layer) layer.remove(); });
  layer.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => layer.remove()));
  return layer;
}

const kindOptions = (selected: NodeKind): string => entityKinds.map((kind) => `<option value="${kind}" ${kind === selected ? 'selected' : ''}>${escapeHtml(labels[kind])}</option>`).join('');

export function nodeEditor(root: HTMLElement, data: ViewData, node: KnowledgeNode | null, save: (operations: KnowledgeUpdateOperation[]) => Promise<void>): void {
  const id = node?.id || `manual:${crypto.randomUUID()}`;
  const mappings = node ? data.graph.mappings.filter((entry) => entry.nodeId === node.id) : [];
  const relations = node ? data.graph.links.filter((entry) => entry.fromNodeId === node.id || entry.toNodeId === node.id) : [];
  const layer = modal(root, `
    <div class="pmd-toolbar"><h2 class="pmd-title">${node ? 'Modifier l’élément' : 'Ajouter un élément'}</h2><span class="pmd-spacer"></span><button class="pmd-icon-button" data-close>×</button></div>
    <form class="pmd-form" data-node-form>
      <label>Type<select class="pmd-select" name="kind">${kindOptions(node?.kind || 'person')}</select></label>
      <label>Libellé<input class="pmd-input" name="label" value="${escapeHtml(node?.label || '')}" required></label>
      <label>Variantes, une par ligne<textarea class="pmd-textarea" name="aliases">${escapeHtml(node?.aliases.join('\n') || '')}</textarea></label>
      <label>Code anonymisé<input class="pmd-input" name="masked" value="${escapeHtml(mappings[0]?.masked || '')}"></label>
      <label>Statut procédural<select class="pmd-select" name="partySide"><option value="">Aucun</option><option value="client" ${!node || node.data.partySide === 'client' ? 'selected' : ''}>Partie cliente</option><option value="adversaire" ${node?.data.partySide === 'adversaire' ? 'selected' : ''}>Partie adverse</option></select></label>
      <label>Forme sociale<input class="pmd-input" name="legalForm" value="${escapeHtml(textValue(node?.data.legalForm))}"></label>
      <label>Nouvelle relation<select class="pmd-select" name="target"><option value="">Aucune</option>${data.graph.nodes.filter((entry) => entry.id !== id && entry.kind !== 'document').map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>`).join('')}</select></label>
      <label>Type de relation<input class="pmd-input" name="relation" placeholder="dirige, iban, adresse…"></label>
      ${relations.length ? `<div><div class="pmd-group">Relations actuelles</div><div class="pmd-badges">${relations.map((relation, index) => `<button type="button" class="pmd-badge pmd-icon-button" data-unlink="${index}">${escapeHtml(relation.relation)} ×</button>`).join('')}</div></div>` : ''}
      <div class="pmd-form-actions"><button type="button" class="pmd-button" data-close>Annuler</button><button class="pmd-button pmd-button-primary">Enregistrer</button></div>
    </form>`);
  const removals = new Set<number>();
  layer.querySelectorAll<HTMLElement>('[data-unlink]').forEach((button) => button.addEventListener('click', () => {
    removals.add(Number(button.dataset.unlink));
    button.style.display = 'none';
  }));
  layer.querySelector<HTMLFormElement>('[data-node-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const label = textValue(form.get('label')).trim();
    const aliases = textValue(form.get('aliases')).split('\n').map((entry) => entry.trim()).filter(Boolean);
    const masked = textValue(form.get('masked')).trim();
    const partySide = textValue(form.get('partySide'));
    const legalForm = textValue(form.get('legalForm')).trim();
    const operations: KnowledgeUpdateOperation[] = [{ op: 'upsertNode', node: { id, kind: textValue(form.get('kind')) as NodeKind, label, aliases, data: { ...(node?.data || {}), partySide: partySide || null, legalForm: legalForm || null }, origin: 'manual' } }];
    for (const mapping of mappings) operations.push({ op: 'deleteMapping', mapping: { nodeId: id, real: mapping.real } });
    for (const real of [label, ...aliases]) if (masked) operations.push({ op: 'upsertMapping', mapping: { nodeId: id, real, masked, origin: 'manual' } });
    for (const index of removals) {
      const relation = relations[index];
      operations.push({ op: 'unlink', link: { fromNodeId: relation.fromNodeId, toNodeId: relation.toNodeId, relation: relation.relation } });
    }
    const target = textValue(form.get('target'));
    const relation = textValue(form.get('relation')).trim();
    if (target && relation) operations.push({ op: 'link', link: { fromNodeId: id, toNodeId: target, relation, origin: 'manual' } });
    await save(operations);
    layer.remove();
  });
}

export function documentEditor(root: HTMLElement, data: ViewData, node: KnowledgeNode, save: (operations: KnowledgeUpdateOperation[]) => Promise<void>): void {
  const mentionLinks = data.graph.links.filter((link) => link.relation === 'mentions' && (link.fromNodeId === node.id || link.toNodeId === node.id));
  const linked = new Set(mentionLinks.map((link) => link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId));
  const entities = data.graph.nodes.filter((entry) => entry.kind === 'person' || entry.kind === 'company');
  const layer = modal(root, `
    <div class="pmd-toolbar"><h2 class="pmd-title">Modifier le document</h2><span class="pmd-spacer"></span><button class="pmd-icon-button" data-close>×</button></div>
    <form class="pmd-form" data-document-form>
      <label>Nom<input class="pmd-input" name="label" value="${escapeHtml(node.label)}" required></label>
      <label>Type<input class="pmd-input" name="nature" value="${escapeHtml(textValue(node.data.nature))}"></label>
      <label>Date<input class="pmd-input" type="date" name="date" value="${escapeHtml(dateFor(node))}"></label>
      <label>Localisation<input class="pmd-input" name="localisation" value="${escapeHtml(textValue(node.data.localisation))}"></label>
      <div><div class="pmd-group">Personnes liées</div><div class="pmd-checks">${entities.map((entry) => `<label class="pmd-check"><input type="checkbox" name="entity" value="${escapeHtml(entry.id)}" ${linked.has(entry.id) ? 'checked' : ''}>${escapeHtml(entry.label)}</label>`).join('')}</div></div>
      <div class="pmd-form-actions"><button type="button" class="pmd-button" data-close>Annuler</button><button class="pmd-button pmd-button-primary">Enregistrer</button></div>
    </form>`);
  layer.querySelector<HTMLFormElement>('[data-document-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const operations: KnowledgeUpdateOperation[] = [{
      op: 'upsertNode',
      node: { id: node.id, kind: 'document', label: textValue(form.get('label')).trim(), aliases: node.aliases, data: { ...node.data, nature: textValue(form.get('nature')).trim() || null, doc_date_iso: textValue(form.get('date')) || null, localisation: textValue(form.get('localisation')).trim() || null }, origin: 'manual' },
    }];
    for (const link of mentionLinks) operations.push({ op: 'unlink', link: { fromNodeId: link.fromNodeId, toNodeId: link.toNodeId, relation: link.relation } });
    for (const target of form.getAll('entity').map(textValue).filter(Boolean)) operations.push({ op: 'link', link: { fromNodeId: node.id, toNodeId: target, relation: 'mentions', origin: 'manual' } });
    await save(operations);
    layer.remove();
  });
}
