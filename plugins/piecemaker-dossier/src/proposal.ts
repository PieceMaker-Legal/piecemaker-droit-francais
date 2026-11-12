import { escapeHtml } from './views.js';

export type ChangeDecision = 'acceptee' | 'refusee' | 'modifiee';
export type Change<T> = { kind: 'ajout' | 'suppression' | 'modification'; name: string; before?: T; after?: T };
export type ProposalShape<T> = { key: (item: T) => string; fields: Array<[keyof T, string]>; empty: (name: string) => T; unchanged: string };

const KIND_LABELS: Record<Change<unknown>['kind'], string> = { ajout: 'Ajout', suppression: 'Suppression', modification: 'Modification' };
const DECISION_LABELS: Record<ChangeDecision, string> = { acceptee: 'Acceptée', refusee: 'Refusée', modifiee: 'Reprise ci-dessous pour modification' };

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function keyedChanges<T>(shape: ProposalShape<T>, current: T[], proposed: T[]): Array<Change<T>> {
  const byName = new Map(current.map((item) => [shape.key(item), item]));
  const kept = new Set(proposed.map(shape.key));
  return [
    ...proposed.flatMap((after): Array<Change<T>> => {
      const name = shape.key(after);
      const before = byName.get(name);
      if (!before) return [{ kind: 'ajout', name, after }];
      return shape.fields.every(([field]) => equal(before[field], after[field])) ? [] : [{ kind: 'modification', name, before, after }];
    }),
    ...current.filter((before) => !kept.has(shape.key(before))).map((before): Change<T> => ({ kind: 'suppression', name: shape.key(before), before })),
  ];
}

export function applyKeyedChange<T>(shape: ProposalShape<T>, items: T[], change: Change<T>): T[] {
  if (change.kind === 'suppression') return items.filter((item) => shape.key(item) !== change.name);
  const index = items.findIndex((item) => shape.key(item) === change.name);
  if (index < 0) return [...items, change.after!];
  return items.map((item, position) => (position === index ? change.after! : item));
}

function textDiff(before: string, after: string): string {
  if (before === after) return escapeHtml(after);
  return `${before ? `<del>${escapeHtml(before)}</del> ` : ''}${after ? `<ins>${escapeHtml(after)}</ins>` : ''}`;
}

function listDiff(before: string[], after: string[]): string {
  const all = [...before, ...after.filter((entry) => !before.includes(entry))];
  return all.map((entry) => (!after.includes(entry) ? `<del>${escapeHtml(entry)}</del>` : !before.includes(entry) ? `<ins>${escapeHtml(entry)}</ins>` : escapeHtml(entry))).join(', ');
}

function fieldsMarkup<T>(shape: ProposalShape<T>, change: Change<T>): string {
  const before = change.before ?? shape.empty(change.name);
  const after = change.after ?? shape.empty(change.name);
  return shape.fields.filter(([field]) => change.kind !== 'modification' || !equal(before[field], after[field]))
    .map(([field, label]) => {
      const left = before[field];
      const right = after[field];
      const value = Array.isArray(left) && Array.isArray(right) ? listDiff(left.map(String), right.map(String)) : textDiff(String(left ?? ''), String(right ?? ''));
      return value ? `<dt>${label}</dt><dd>${value}</dd>` : '';
    }).join('');
}

export function changesMarkup<T>(shape: ProposalShape<T>, changes: Array<Change<T>>, decisions: Array<ChangeDecision | undefined>, motif: string): string {
  const items = changes.map((change, index) => {
    const decision = decisions[index];
    const actions = decision
      ? `<span class="pmd-ontology-decision">${DECISION_LABELS[decision]}</span>`
      : `<button type="button" class="pmd-button pmd-button-primary" data-change-accept="${index}">Accepter</button><button type="button" class="pmd-button" data-change-refuse="${index}">Refuser</button>${change.kind === 'suppression' ? '' : `<button type="button" class="pmd-button" data-change-edit="${index}">Modifier</button>`}`;
    return `<div class="pmd-ontology-change" data-change-kind="${change.kind}"${decision ? ` data-decided="${decision}"` : ''}>
      <div class="pmd-ontology-change-head"><span class="pmd-badge">${KIND_LABELS[change.kind]}</span><strong>${escapeHtml(change.name)}</strong><span class="pmd-spacer"></span>${actions}</div>
      <dl class="pmd-ontology-change-fields">${fieldsMarkup(shape, change)}</dl>
    </div>`;
  }).join('');
  return `<div class="pmd-form-section pmd-ontology-proposal">
    <div class="pmd-ontology-change-head"><h3>Modifications proposées par l’assistant</h3><span class="pmd-spacer"></span><button type="button" class="pmd-button" data-proposal-drop>Tout refuser</button></div>
    ${motif ? `<p class="pmd-form-note">${escapeHtml(motif)}</p>` : ''}
    ${items || `<p class="pmd-form-note">${shape.unchanged}</p>`}
    <p class="pmd-form-note">« Enregistrer » applique les changements acceptés ou modifiés ; ceux restés sans décision sont écartés.</p>
  </div>`;
}

export function decisionOf(target: HTMLElement): { index: number; decision: ChangeDecision } | null {
  const choice = target.closest<HTMLElement>('[data-change-accept],[data-change-refuse],[data-change-edit]');
  if (!choice) return null;
  const { changeAccept, changeRefuse, changeEdit } = choice.dataset;
  return { index: Number(changeAccept ?? changeRefuse ?? changeEdit), decision: changeAccept !== undefined ? 'acceptee' : changeRefuse !== undefined ? 'refusee' : 'modifiee' };
}
