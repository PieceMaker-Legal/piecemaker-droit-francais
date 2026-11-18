import { iconSvg } from './document-types.js';
import { chatAttributes } from './chat-pick.js';
import { PARTY_TYPE, PREMISE_TYPE, premiseEstablishers, premiseParties, relationLabel } from './okf.js';
import type { OkfFiche, OkfIndex } from './okf.js';

const escapeText = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] || char);
const SIDES: Record<string, string> = { client: 'Client', adversaire: 'Adverse', adverse: 'Adverse', tiers: 'Tiers' };
const sideOf = (party: OkfFiche) => party.side === 'adversaire' ? 'adverse' : party.side || 'tiers';
const ficheFile = (fiche: OkfFiche) => `.piecemaker/okf${fiche.id}`;
const shortTitle = (fiche: OkfFiche) => fiche.title.replace(/\.(?:pdf|docx?|xlsx?|png|jpe?g|txt|md)$/i, '');

function pill(index: OkfIndex, fiche: OkfFiche, prefix = ''): string {
  const icon = fiche.type === PARTY_TYPE ? 'users' : fiche.type === PREMISE_TYPE ? 'diamond' : fiche.icon || 'file';
  const side = fiche.type === PARTY_TYPE ? ` data-side="${sideOf(fiche)}"` : '';
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

const AUTHORS: Record<string, string> = { human: 'vérifiée par l’avocat', agent: 'réponse de l’agent, à vérifier dans la revue' };

function sourceRow(index: OkfIndex, fiche: OkfFiche, label: string, citation: string, link?: { origin: string; at?: string; author?: string; review?: string }): string {
  const file = fiche.type === PREMISE_TYPE || fiche.type === PARTY_TYPE ? ficheFile(fiche) : fiche.resource;
  const icon = fiche.type === PREMISE_TYPE ? 'diamond' : fiche.type === PARTY_TYPE ? 'users' : fiche.icon || 'file';
  const signed = link?.author ? `Revue « ${escapeText(link.review || '')} » · ${AUTHORS[link.author] || link.author}${link.author === 'human' && when(link.at) ? ` le ${when(link.at)}` : ''}` : link ? signature('Lien posé', link.origin, link.at) : '';
  return `<div class="pmd-fact-source"${chatAttributes(fiche.title, fiche.type === PREMISE_TYPE ? 'Prémisse' : fiche.type === PARTY_TYPE ? 'Partie' : 'Document', citation ? `Citation : « ${citation} »` : '', { fichier: file })}>${iconSvg(icon)}<span class="pmd-fact-source-copy">${label ? `<span class="pmd-fact-source-label">${escapeText(label)}</span>` : ''}<button type="button" class="pmd-fact-source-title" data-open-fiche="${escapeText(fiche.id)}">${escapeText(fiche.title)}</button>${fileButton(fiche.resource)}${quote(citation)}${signed ? `<small class="pmd-fact-signature">${signed}</small>` : ''}</span></div>`;
}

const byId = (index: OkfIndex, id: string) => index.fiches.find((fiche) => fiche.id === id);
const incoming = (index: OkfIndex, fiche: OkfFiche, relation?: string) => index.fiches.flatMap((other) => other.relations
  .filter((entry) => entry.target === fiche.id && (!relation || entry.relation === relation))
  .map((entry) => ({ other, entry })));

function premiseBody(index: OkfIndex, premise: OkfFiche) {
  const sources = premiseEstablishers(index, premise.id);
  const values = [...new Set(sources.map((entry) => entry.value.trim()).filter(Boolean))];
  const diverge = premise.single && new Set(values.map((value) => value.toLowerCase())).size > 1;
  const parties = premiseParties(index, premise.id);
  const warnings = [
    diverge ? `<span class="pmd-fact-warning">⚠ Les sources divergent</span><p class="pmd-fact-text">${sources.filter((entry) => entry.value).map((entry) => `${escapeText(entry.piece)} : ${escapeText(entry.value)}`).join(' ; ')}.</p>` : '',
    sources.length ? '' : '<span class="pmd-fact-warning">⚠ Aucune pièce</span><p class="pmd-fact-text">Aucune pièce n’établit cette prémisse.</p>',
  ].join('');
  return {
    kind: 'Prémisse',
    meta: premise.single ? 'Prémisse · valeur unique' : 'Prémisse',
    actions: '<button type="button" class="pmd-button piecemaker-button piecemaker-button--black piecemaker-button--sm" data-link-review>Lier une revue tabulaire</button><div class="pmd-review-picker" data-review-picker hidden></div>',
    props: row(premise.single ? 'Valeur' : 'Valeurs', values.map((value) => text(value, diverge ? 'warning' : 'value')).join(''))
      + row('Parties', parties.map((party) => pill(index, party)).join(''))
      + row('Pièces', text(String(sources.length))),
    sections: section('Description', premise.description && premise.description !== premise.title ? `<p class="pmd-fact-text">${escapeText(premise.description)}</p>` : '')
      + section('Alertes', warnings)
      + section('Pièces sources', sources.map((entry) => {
        const piece = index.fiches.find((fiche) => fiche.resource === entry.resource);
        return piece ? sourceRow(index, piece, entry.value, entry.citation, entry) : '';
      }).join(''))
      + section('Revues tabulaires liées', (premise.revues || []).map((review) => `<div class="pmd-fact-source">${iconSvg('list')}<span class="pmd-fact-source-copy"><span class="pmd-fact-source-label">${escapeText(review.question || `Colonne ${review.colonne}`)}</span><span class="pmd-fact-source-title">${escapeText(review.titre)}</span><small class="pmd-fact-signature">${review.erreur ? `⚠ ${escapeText(review.erreur)}` : `${review.lignes.length} ligne${review.lignes.length > 1 ? 's' : ''} positive${review.lignes.length > 1 ? 's' : ''}, dont ${review.lignes.filter((line) => line.author === 'human').length} vérifiée${review.lignes.filter((line) => line.author === 'human').length > 1 ? 's' : ''}`}${signature(' · Liée', review.by, review.at)}</small><button type="button" class="pmd-fact-file" data-unlink-review="${escapeText(review.fichier)}" data-review-column="${review.colonne}">Délier</button></span></div>`).join('')),
  };
}

function documentBody(index: OkfIndex, fiche: OkfFiche) {
  const targets = (relation: string) => fiche.relations.filter((entry) => entry.relation === relation).map((entry) => byId(index, entry.target)).filter((entry): entry is OkfFiche => Boolean(entry));
  const links = fiche.relations.filter((entry) => !['states', 'mentions'].includes(entry.relation));
  const back = incoming(index, fiche).filter(({ entry }) => !['states', 'mentions', 'involves'].includes(entry.relation));
  return {
    kind: 'Document',
    meta: [fiche.type, fiche.date].filter(Boolean).join(' · '),
    actions: '<button type="button" class="pmd-button piecemaker-button piecemaker-button--black piecemaker-button--sm" data-edit-fiche>Corriger la pièce</button>',
    props: row('Fichier', fileButton(fiche.resource))
      + row('Type de pièce', fiche.nature ? `<span class="pmd-fact-pill pmd-fact-pill-static">${iconSvg(fiche.icon || 'file')}${escapeText(fiche.nature)}</span>` : text('À renseigner', 'muted'))
      + row('Date', fiche.date ? text(fiche.date) : '')
      + row('Parties', targets('mentions').map((party) => pill(index, party)).join(''))
      + row('Prémisses', targets('states').map((premise) => pill(index, premise)).join(''))
      + row('Liens', [
        ...links.map((entry) => byId(index, entry.target)).map((target, at) => target ? pill(index, target, relationLabel(index, links[at].relation)) : ''),
        ...back.map(({ other, entry }) => pill(index, other, relationLabel(index, entry.relation, true))),
      ].join(''))
      + row('Examen', fiche.examen ? text(`Examinée sans lien par ${ACTORS[fiche.examen.by] || fiche.examen.by}${when(fiche.examen.at) ? ` le ${when(fiche.examen.at)}` : ''} : ${fiche.examen.motif}`) : ''),
    sections: section('Description', fiche.description && fiche.description !== fiche.nature ? `<p class="pmd-fact-text">${escapeText(fiche.description)}</p>` : '')
      + section('Citations', fiche.relations.filter((entry) => entry.citation).map((entry) => {
        const target = byId(index, entry.target);
        return target ? sourceRow(index, target, `${relationLabel(index, entry.relation)}${entry.value ? ` : ${entry.value}` : ''}`, entry.citation, entry) : '';
      }).join('')),
  };
}

function partyBody(index: OkfIndex, party: OkfFiche) {
  const premisesOf = index.fiches.filter((fiche) => fiche.type === PREMISE_TYPE && fiche.relations.some((entry) => entry.relation === 'involves' && entry.target === party.id));
  const mentions = incoming(index, party, 'mentions');
  return {
    kind: 'Partie',
    meta: ['Partie', party.description].filter(Boolean).join(' · '),
    actions: '<button type="button" class="pmd-button piecemaker-button piecemaker-button--black piecemaker-button--sm" data-edit-fiche>Modifier la partie</button>',
    props: row('Côté', text(SIDES[party.side || 'tiers'] || party.side || 'Tiers', sideOf(party)))
      + row('Prémisses', premisesOf.map((premise) => pill(index, premise)).join(''))
      + row('Pièces', text(String(mentions.length))),
    sections: section('Pièces qui la mentionnent', mentions.map(({ other, entry }) => sourceRow(index, other, '', entry.citation, entry)).join('')),
  };
}

export function ficheCardMarkup(index: OkfIndex, ficheId: string): string {
  const fiche = byId(index, ficheId);
  if (!fiche) return '';
  const body = fiche.type === PREMISE_TYPE ? premiseBody(index, fiche) : fiche.type === PARTY_TYPE ? partyBody(index, fiche) : documentBody(index, fiche);
  const file = fiche.type === PREMISE_TYPE || fiche.type === PARTY_TYPE ? ficheFile(fiche) : fiche.resource;
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
