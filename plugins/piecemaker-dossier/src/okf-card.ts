import { iconSvg } from './document-types.js';
import { chatAttributes } from './chat-pick.js';
import { entityEvidence, isEntity, isParty, linkedEntities, relationLabel } from './okf.js';
import type { OkfFiche, OkfIndex } from './okf.js';

const escapeText = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
const SIDES: Record<string, string> = { client: 'Client', adversaire: 'Adverse', adverse: 'Adverse', tiers: 'Tiers' };
const sideOf = (party: OkfFiche) => party.side === 'adversaire' ? 'adverse' : party.side || 'tiers';
const ficheFile = (fiche: OkfFiche) => `.piecemaker/okf${fiche.id}`;
const iconOf = (fiche: OkfFiche) => isParty(fiche) ? 'users' : isEntity(fiche) ? 'diamond' : fiche.icon || 'file';
const kindOf = (fiche: OkfFiche) => isEntity(fiche) ? 'Concept' : isParty(fiche) ? 'Partie' : 'Document';
const shortTitle = (fiche: OkfFiche) => fiche.title.replace(/\.(?:pdf|docx?|xlsx?|png|jpe?g|txt|md)$/i, '');

function pill(index: OkfIndex, fiche: OkfFiche, prefix = ''): string {
  const icon = iconOf(fiche);
  const side = isParty(fiche) ? ` data-side="${sideOf(fiche)}"` : '';
  return `<button type="button" class="pmd-fact-pill"${side} data-open-fiche="${escapeText(fiche.id)}">${iconSvg(icon)}${prefix ? `<span class="pmd-fact-pill-prefix">${escapeText(prefix)}</span>` : ''}${escapeText(shortTitle(fiche))}</button>`;
}

const text = (value: string, kind = '') => `<span class="pmd-fact-pill pmd-fact-pill-static"${kind ? ` data-kind="${kind}"` : ''}>${escapeText(value)}</span>`;
const row = (label: string, content: string) => content ? `<dt>${label}</dt><dd>${content}</dd>` : '';
const section = (title: string, body: string) => body ? `<section class="pmd-fact-section"><h3>${title}</h3>${body}</section>` : '';
const ACTORS: Record<string, string> = { 'piecemaker/agent': 'l’agent', 'piecemaker/avocat': 'l’avocat', 'piecemaker/gliner': 'le scan GLiNER', 'piecemaker/tabular-review': 'la revue tabulaire' };
const when = (at?: string) => at && !Number.isNaN(Date.parse(at)) ? new Date(at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '';
const signature = (verb: string, by?: string, at?: string) => by || when(at) ? `${verb}${by ? ` par ${escapeText(ACTORS[by] || by)}` : ''}${when(at) ? ` le ${when(at)}` : ''}` : '';
const fileButton = (resource: string) => resource ? `<button type="button" class="pmd-fact-file" data-open-file="${escapeText(resource)}" title="Ouvrir dans le volet Fichier">${escapeText(resource)}</button>` : '';
const quote = (citation: string) => citation ? `<small class="pmd-fact-quote">« ${escapeText(citation)} »</small>` : '';

function sourceRow(index: OkfIndex, fiche: OkfFiche, label: string, citation: string, link?: { origin: string; at?: string }): string {
  const file = isEntity(fiche) || isParty(fiche) ? ficheFile(fiche) : fiche.resource;
  const icon = iconOf(fiche);
  const signed = link ? signature('Lien posé', link.origin, link.at) : '';
  return `<div class="pmd-fact-source"${chatAttributes(fiche.title, kindOf(fiche), citation ? `Citation : « ${citation} »` : '', { fichier: file })}>${iconSvg(icon)}<span class="pmd-fact-source-copy">${label ? `<span class="pmd-fact-source-label">${escapeText(label)}</span>` : ''}<button type="button" class="pmd-fact-source-title" data-open-fiche="${escapeText(fiche.id)}">${escapeText(fiche.title)}</button>${fileButton(fiche.resource)}${quote(citation)}${signed ? `<small class="pmd-fact-signature">${signed}</small>` : ''}</span></div>`;
}

const byId = (index: OkfIndex, id: string) => index.fiches.find((fiche) => fiche.id === id);
const incoming = (index: OkfIndex, fiche: OkfFiche) => index.fiches.flatMap((other) => other.relations
  .filter((entry) => entry.target === fiche.id)
  .map((entry) => ({ other, entry })));

function linksRow(index: OkfIndex, fiche: OkfFiche): string {
  return [
    ...fiche.relations.filter((entry) => !entry.value).map((entry) => byId(index, entry.target) ? pill(index, byId(index, entry.target)!, relationLabel(index, entry.relation)) : ''),
    ...incoming(index, fiche).filter(({ entry }) => !entry.value).map(({ other, entry }) => pill(index, other, relationLabel(index, entry.relation, true))),
  ].join('');
}

function entityBody(index: OkfIndex, entity: OkfFiche) {
  const sources = entityEvidence(index, entity.id);
  const values = [...new Set(sources.map((entry) => entry.value.trim()).filter(Boolean))];
  const diverge = new Set(values.map((value) => value.toLowerCase())).size > 1;
  const warnings = [
    diverge ? `<span class="pmd-fact-warning">⚠ Les sources divergent</span><p class="pmd-fact-text">${sources.filter((entry) => entry.value).map((entry) => `${escapeText(entry.piece)} : ${escapeText(entry.value)}`).join(' ; ')}.</p>` : '',
    sources.length ? '' : '<span class="pmd-fact-warning">⚠ Aucune pièce</span><p class="pmd-fact-text">Aucune pièce ne fonde cette fiche.</p>',
  ].join('');
  return {
    kind: 'Concept',
    meta: entity.lof || entity.type,
    actions: '',
    props: row('Type', text(entity.lof || entity.type))
      + row('Valeurs', values.map((value) => text(value, diverge ? 'warning' : 'value')).join(''))
      + row('Liens', linksRow(index, entity))
      + row('Pièces', text(String(new Set(sources.map((entry) => entry.resource)).size))),
    sections: section('Description', entity.description && entity.description !== entity.title ? `<p class="pmd-fact-text">${escapeText(entity.description)}</p>` : '')
      + section('Alertes', warnings)
      + section('Pièces sources', sources.map((entry) => {
        const piece = index.fiches.find((fiche) => fiche.resource === entry.resource);
        return piece ? sourceRow(index, piece, [entry.label, entry.value].filter(Boolean).join(' : '), entry.citation, entry) : '';
      }).join('')),
  };
}

function documentBody(index: OkfIndex, fiche: OkfFiche) {
  const cited = index.fiches.flatMap((other) => other.relations.filter((entry) => entry.piece === fiche.id).map((entry) => ({ other, entry })));
  return {
    kind: 'Document',
    meta: [fiche.type, fiche.date].filter(Boolean).join(' · '),
    actions: '<button type="button" class="pmd-button piecemaker-button piecemaker-button--black piecemaker-button--sm" data-edit-fiche>Corriger la pièce</button>',
    props: row('Fichier', fileButton(fiche.resource))
      + row('Type de pièce', fiche.nature ? `<span class="pmd-fact-pill pmd-fact-pill-static">${iconSvg(fiche.icon || 'file')}${escapeText(fiche.nature)}</span>` : text('À renseigner', 'muted'))
      + row('Date', fiche.date ? text(fiche.date) : '')
      + row('Concepts', [...new Set(cited.map(({ other }) => other))].map((other) => pill(index, other)).join(''))
      + row('Liens', linksRow(index, fiche)),
    sections: section('Description', fiche.description && fiche.description !== fiche.nature ? `<p class="pmd-fact-text">${escapeText(fiche.description)}</p>` : '')
      + section('Citations', fiche.relations.filter((entry) => entry.citation).map((entry) => {
        const target = byId(index, entry.target);
        return target ? sourceRow(index, target, `${relationLabel(index, entry.relation)}${entry.value ? ` : ${entry.value}` : ''}`, entry.citation, entry) : '';
      }).join('') + cited.map(({ other, entry }) => {
        const target = byId(index, entry.target);
        return sourceRow(index, other, entry.value ? `${entry.relation} : ${entry.value}` : `${entry.relation} → ${target?.title || entry.target}`, entry.citation, entry);
      }).join('')),
  };
}

function partyBody(index: OkfIndex, party: OkfFiche) {
  const linked = linkedEntities(index, party.id);
  const mentions = incoming(index, party).filter(({ other }) => !isEntity(other));
  return {
    kind: 'Partie',
    meta: ['Partie', party.description].filter(Boolean).join(' · '),
    actions: '<button type="button" class="pmd-button piecemaker-button piecemaker-button--black piecemaker-button--sm" data-edit-fiche>Modifier la partie</button>',
    props: row('Côté', text(SIDES[party.side || 'tiers'] || party.side || 'Tiers', sideOf(party)))
      + row('Concepts', linked.map((entity) => pill(index, entity)).join(''))
      + row('Liens', linksRow(index, party))
      + row('Pièces', text(String(mentions.length))),
    sections: section('Pièces liées', mentions.map(({ other, entry }) => sourceRow(index, other, '', entry.citation, entry)).join('')),
  };
}

export function ficheCardMarkup(index: OkfIndex, ficheId: string): string {
  const fiche = byId(index, ficheId);
  if (!fiche) return '';
  const body = isEntity(fiche) ? entityBody(index, fiche) : isParty(fiche) ? partyBody(index, fiche) : documentBody(index, fiche);
  const file = isEntity(fiche) || isParty(fiche) ? ficheFile(fiche) : fiche.resource;
  return `<aside class="pmd-okf-detail" tabindex="-1" data-okf-detail="${escapeText(fiche.id)}" aria-label="${escapeText(fiche.title)}"${chatAttributes(fiche.title, body.kind, `Fiche OKF : ${ficheFile(fiche)}`, { fichier: file })}>
    <header class="pmd-fact-head"><h2 class="pmd-fact-title">${escapeText(fiche.title)}</h2><button type="button" class="pmd-icon-button" data-detail-close aria-label="Fermer" title="Fermer (Échap)">×</button></header>
    ${quote(fiche.titleCitation || '')}
    ${body.meta ? `<p class="pmd-fact-meta">${escapeText(body.meta)}</p>` : ''}
    ${signature('Créée', fiche.generated?.by, fiche.generated?.at) ? `<p class="pmd-fact-meta pmd-fact-signature">${signature('Créée', fiche.generated?.by, fiche.generated?.at)}</p>` : ''}
    <div class="pmd-fact-actions">${body.actions}</div>
    <dl class="pmd-fact-props">${body.props}</dl>
    ${body.sections}
  </aside>`;
}
