import type { OntologyRelation } from './okf.js';
import { escapeHtml } from './views.js';

export type OntologyChange = { kind: 'ajout' | 'suppression' | 'modification'; name: string; before?: OntologyRelation; after?: OntologyRelation };
export type ChangeDecision = 'acceptee' | 'refusee' | 'modifiee';

const FIELDS: Array<[keyof OntologyRelation, string]> = [['label', 'Libellé'], ['inverse', 'Libellé inverse'], ['description', 'Description'], ['source', 'Source'], ['target', 'Cible']];
const KIND_LABELS: Record<OntologyChange['kind'], string> = { ajout: 'Ajout', suppression: 'Suppression', modification: 'Modification' };
const DECISION_LABELS: Record<ChangeDecision, string> = { acceptee: 'Acceptée', refusee: 'Refusée', modifiee: 'Reprise ci-dessous pour modification' };

const same = (left: OntologyRelation, right: OntologyRelation) => FIELDS.every(([field]) => JSON.stringify(left[field]) === JSON.stringify(right[field]));

export function ontologyChanges(current: OntologyRelation[], proposed: OntologyRelation[]): OntologyChange[] {
  const byName = new Map(current.map((relation) => [relation.name, relation]));
  const kept = new Set(proposed.map((relation) => relation.name));
  return [
    ...proposed.flatMap((after): OntologyChange[] => {
      const before = byName.get(after.name);
      if (!before) return [{ kind: 'ajout', name: after.name, after }];
      return same(before, after) ? [] : [{ kind: 'modification', name: after.name, before, after }];
    }),
    ...current.filter((before) => !kept.has(before.name)).map((before): OntologyChange => ({ kind: 'suppression', name: before.name, before })),
  ];
}

export function applyChange(relations: OntologyRelation[], change: OntologyChange): OntologyRelation[] {
  const others = relations.filter((relation) => relation.name !== change.name);
  if (change.kind === 'suppression') return others;
  const index = relations.findIndex((relation) => relation.name === change.name);
  if (index < 0) return [...relations, change.after!];
  return relations.map((relation, position) => (position === index ? change.after! : relation));
}

function textDiff(before: string, after: string): string {
  if (before === after) return escapeHtml(after);
  return `${before ? `<del>${escapeHtml(before)}</del> ` : ''}${after ? `<ins>${escapeHtml(after)}</ins>` : ''}`;
}

function listDiff(before: string[], after: string[]): string {
  const all = [...before, ...after.filter((entry) => !before.includes(entry))];
  return all.map((entry) => (!after.includes(entry) ? `<del>${escapeHtml(entry)}</del>` : !before.includes(entry) ? `<ins>${escapeHtml(entry)}</ins>` : escapeHtml(entry))).join(', ');
}

function fieldsMarkup(change: OntologyChange): string {
  const empty: OntologyRelation = { name: change.name, label: '', inverse: '', description: '', source: [], target: [] };
  const before = change.before ?? empty;
  const after = change.after ?? empty;
  return FIELDS.filter(([field]) => change.kind !== 'modification' || JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map(([field, label]) => {
      const left = before[field];
      const right = after[field];
      const value = Array.isArray(left) && Array.isArray(right) ? listDiff(left, right) : textDiff(String(left), String(right));
      return value ? `<dt>${label}</dt><dd>${value}</dd>` : '';
    }).join('');
}

export function proposalMarkup(changes: OntologyChange[], decisions: Array<ChangeDecision | undefined>, motif: string): string {
  const items = changes.map((change, index) => {
    const decision = decisions[index];
    const actions = decision
      ? `<span class="pmd-ontology-decision">${DECISION_LABELS[decision]}</span>`
      : `<button type="button" class="pmd-button pmd-button-primary" data-change-accept="${index}">Accepter</button><button type="button" class="pmd-button" data-change-refuse="${index}">Refuser</button>${change.kind === 'suppression' ? '' : `<button type="button" class="pmd-button" data-change-edit="${index}">Modifier</button>`}`;
    return `<div class="pmd-ontology-change" data-change-kind="${change.kind}"${decision ? ` data-decided="${decision}"` : ''}>
      <div class="pmd-ontology-change-head"><span class="pmd-badge">${KIND_LABELS[change.kind]}</span><strong>${escapeHtml(change.name)}</strong><span class="pmd-spacer"></span>${actions}</div>
      <dl class="pmd-ontology-change-fields">${fieldsMarkup(change)}</dl>
    </div>`;
  }).join('');
  return `<div class="pmd-form-section pmd-ontology-proposal">
    <div class="pmd-ontology-change-head"><h3>Modifications proposées par l’assistant</h3><span class="pmd-spacer"></span><button type="button" class="pmd-button" data-proposal-drop>Tout refuser</button></div>
    ${motif ? `<p class="pmd-form-note">${escapeHtml(motif)}</p>` : ''}
    ${items || '<p class="pmd-form-note">La proposition reprend l’ontologie actuelle sans changement.</p>'}
    <p class="pmd-form-note">« Enregistrer » applique les changements acceptés ou modifiés ; ceux restés sans décision sont écartés.</p>
  </div>`;
}
