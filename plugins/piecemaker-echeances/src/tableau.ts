import { confirmDialog, errorMessage, escapeHtml as escape, openModal, toast } from '../../piecemaker-tabular-review/src/client/dom.js';
import { INDEX_MODEL } from '../../piecemaker-tabular-review/src/shared.js';
import { etapes, loadBoard } from './api.js';
import type { Carte, DocumentRedige, Etape, Fiche } from './api.js';
import { alertes } from './attention.js';
import { lancer } from './lancer.js';
import { ouvrirMapping, ouvrirRaisonnement, ouvrirSession, ouvrirVolet } from './navigation.js';

const COLONNES: [Etape, string][] = [
  ['preparation', 'Préparation dossier'],
  ['raisonnement', 'Raisonnements'],
  ['redaction', 'Rédaction'],
  ['finalisation', 'Finalisation'],
  ['attente', 'En attente de tiers'],
  ['clos', 'Clos'],
];
const LIBELLE = Object.fromEntries(COLONNES) as Record<Etape, string>;
const OBJECTIFS = 'Objectif(s) du raisonnement. Exemple : déterminer si le licenciement de Jean Dupont est fondé ; chiffrer les indemnités dues.';
const NOUVEAU_TYPE = '__nouveau';
const CACHE = 'pme-tableau';

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;
const sansStatut = (documents: DocumentRedige[] = []) => documents.map(({ type, nom, chemin, valide }) => ({ type, nom, chemin, ...(valide ? { valide } : {}) }));

const icone = (chemins: string) => `<svg class="pme-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${chemins}</svg>`;
const ICONE_RAISONNEMENT = icone('<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>');
const ICONE_DOCUMENT = icone('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>');
const boutonRaisonnement = (version = '') => `<button type="button" class="ptr-button pme-glass" data-open-reasoning${version ? ` data-version="${escape(version)}"` : ''}>${ICONE_RAISONNEMENT}Ouvrir le programme Catala</button>`;
const lienRaisonnement = boutonRaisonnement();

const tacheHtml = (carte: Carte) => {
  const tache = carte.tache;
  if (!tache) return '';
  const statut = tache.statut === 'en-cours' ? 'En cours' : tache.statut === 'question' ? 'Question' : 'En file';
  return `<p class="pme-task"><span class="pme-pill pme-pill--run">${statut}</span>${escape(tache.titre)}${tache.sessionId ? ' <button type="button" class="pme-link" data-session="' + escape(tache.sessionId) + '">Voir</button>' : ''}</p>`;
};

const menuHtml = (carte: Carte) => {
  const items = carte.exclu ? [] : [
    ...COLONNES.filter(([etape]) => etape !== carte.etape).map(([etape, libelle]) => `<button type="button" class="ptr-menu-item" data-move="${etape}">Déplacer vers ${escape(libelle)}</button>`),
    '<button type="button" class="ptr-menu-item" data-exclude>Non juridique : retirer du tableau</button>',
  ];
  if (!items.length) return '';
  return `<details class="ptr-menu pme-move"><summary class="ptr-icon-button" aria-label="Actions de la carte" title="Déplacer">⋯</summary><div class="ptr-menu-list">${items.join('')}</div></details>`;
};

const vide = (texte: string) => `<p class="pme-muted">${texte}</p>`;
const bouton = (attributs: string, libelle: string, primaire = false) => `<button type="button" class="ptr-button${primaire ? ' ptr-button-primary' : ''}" ${attributs}>${libelle}</button>`;
const ouvrirDocument = (document: DocumentRedige, index: number, version = '') => `<button type="button" class="ptr-button pme-glass" data-open-doc="${index}"${version ? ` data-version="${escape(version)}"` : ''} title="Ouvrir ${escape(document.nom)}">${ICONE_DOCUMENT}${escape(document.nom)}</button>`;
const rediges = (carte: Carte) => (carte.documents ?? []).map((document, index) => [document, index] as const).filter(([document]) => document.statut === 'en cours' || document.statut === 'validé');
const basculerValide = ([document, index]: readonly [DocumentRedige, number]) => `<button type="button" class="pme-link" data-toggle-valide="${index}">${document.statut === 'validé' ? `Remettre ${escape(document.nom)} en cours` : `Marquer ${escape(document.nom)} validé`}</button>`;
const nomsDocuments = (carte: Carte) => {
  const liste = rediges(carte);
  return liste.length ? `<p class="pme-card-doc">${ICONE_DOCUMENT}${liste.map(([document]) => `${escape(document.nom)} (${document.statut === 'validé' ? 'validé' : 'en cours de rédaction'})`).join(', ')}</p>` : vide('Aucun document rédigé.');
};
const compte = (carte: Carte) => [carte.raisonnement?.erreurs ? plural(carte.raisonnement.erreurs, 'erreur') : '', carte.raisonnement?.manques ? plural(carte.raisonnement.manques, 'manque') : ''].filter(Boolean).join(' · ');

type Colonne = { etat: string; principal: string; secondaires: string[] };

const preparation = (carte: Carte): Colonne => {
  const lignes = carte.preparation ?? [];
  const ok = (nom: string) => lignes.some((ligne) => ligne.nom === nom && ligne.ok);
  const pieces = ok('conversion') && ok('anonymisation');
  const principal = !lignes.length ? ''
    : !pieces ? bouton('data-launch="conversion"', 'Lancer l’anonymisation', true)
      : !ok('mapping') ? bouton('data-mapping', 'Valider le mapping', true)
        : !ok('index') ? bouton('data-launch="index"', 'Lancer l’index', true) : '';
  return {
    etat: vide(`Anonymisation ${pieces && ok('mapping') ? 'faite' : 'à faire'} · Index ${ok('index') ? 'fait' : 'à faire'}`),
    principal,
    secondaires: [bouton('data-volet="plugin:piecemaker-dossier"', 'Ouvrir les pièces'), ok('index') ? bouton('data-volet="plugin:piecemaker-tabular-review"', 'Ouvrir l’index') : '', carte.raisonnement ? '' : bouton('data-launch="raisonnement"', 'Démarrer le raisonnement')],
  };
};

const raisonnement = (carte: Carte): Colonne => {
  const reasoning = carte.raisonnement!;
  const issues = compte(carte);
  if (!reasoning.verifie) return { etat: vide('Pas encore vérifié.'), principal: bouton('data-launch="lever"', 'Vérifier le raisonnement', true), secondaires: [lienRaisonnement] };
  return {
    etat: issues ? `<p class="${reasoning.erreurs ? 'pme-erreur' : 'pme-manque'}">${issues}</p>` : '<p class="pme-ok">✓ Vérifié, sans manque ni erreur</p>',
    principal: issues ? bouton('data-launch="lever"', 'Lever manques et erreurs', true) : bouton('data-validate="redaction"', 'Valider le raisonnement', true),
    secondaires: [lienRaisonnement, issues && !reasoning.erreurs ? bouton('data-validate="redaction"', 'Valider malgré tout') : ''],
  };
};

const redaction = (carte: Carte): Colonne => {
  const faits = rediges(carte);
  const aFaire = (carte.documents ?? []).map((document, index) => [document, index] as const).filter(([document]) => document.statut !== 'en cours' && document.statut !== 'validé');
  const lancerDocument = ([document, index]: readonly [DocumentRedige, number], primaire: boolean) => bouton(`data-launch="redaction" data-doc="${index}"`, primaire ? 'Lancer la rédaction' : `Rédiger ${escape(document.nom)}`, primaire);
  return {
    etat: faits.length ? nomsDocuments(carte) : vide('Rédaction non commencée.'),
    principal: faits.length ? bouton('data-validate="finalisation"', 'Valider la rédaction', true) : aFaire.length ? lancerDocument(aFaire[0], true) : bouton('data-add-doc', 'Lancer la rédaction', true),
    secondaires: [...faits.map(([document, index]) => ouvrirDocument(document, index)), ...faits.map(basculerValide), lienRaisonnement, ...aFaire.slice(faits.length ? 0 : 1).map((entree) => lancerDocument(entree, false)),
      ...aFaire.map(([document, index]) => `<button type="button" class="pme-link pme-link--muted" data-remove-doc="${index}">Retirer ${escape(document.nom)}</button>`)],
  };
};

const attente = (carte: Carte): Colonne => {
  const action = carte.action;
  return {
    etat: action?.texte ? `<p class="pme-next"><span class="pme-pill ${action.fait ? 'pme-pill--done' : 'pme-pill--todo'}">${action.fait ? 'Effectué' : 'À faire'}</span><span class="pme-next-text">${escape(action.texte)}</span></p>` : vide('Attente non précisée.'),
    principal: bouton('data-integrate', '+ Document du tiers', true),
    secondaires: [bouton('data-edit-action', action?.texte ? 'Modifier l’attente' : 'Préciser l’attente'), action?.texte ? bouton('data-toggle-action', action.fait ? 'Marquer à faire' : 'Marquer effectué') : '', bouton('data-finish', 'Clore'), ...rediges(carte).map(([document, index]) => ouvrirDocument(document, index)), lienRaisonnement],
  };
};

const colonne = (carte: Carte): Colonne => {
  if (carte.exclu) return { etat: vide('Non juridique.'), principal: bouton('data-include', 'Réintégrer'), secondaires: [] };
  if (carte.etape === 'preparation') return preparation(carte);
  if (carte.aDemarrer || !carte.raisonnement) return { etat: vide('Raisonnement à démarrer.'), principal: bouton('data-launch="raisonnement"', 'Démarrer le raisonnement', true), secondaires: [] };
  const documents = rediges(carte).map(([document, index]) => ouvrirDocument(document, index));
  switch (carte.etape) {
    case 'raisonnement': return raisonnement(carte);
    case 'redaction': return redaction(carte);
    case 'finalisation': return { etat: nomsDocuments(carte), principal: bouton('data-finish', 'Valider la finalisation', true), secondaires: [...documents, lienRaisonnement] };
    case 'attente': return attente(carte);
    default: return { etat: nomsDocuments(carte), principal: '', secondaires: [...documents, lienRaisonnement] };
  }
};

const alertesHtml = (carte: Carte) => {
  const reasoning = carte.raisonnement;
  if (carte.etape !== 'raisonnement' || !reasoning?.verifie || !reasoning.alertes.length) return '';
  return `<ul class="pme-alertes">${reasoning.alertes.map((alerte) => `<li class="pme-${alerte.kind}">${escape(alerte.texte)}</li>`).join('')}</ul>`;
};

const actionsHtml = (carte: Carte) => {
  const { etat, principal, secondaires } = colonne(carte);
  const autres = secondaires.filter(Boolean).join('');
  return `<section class="pme-section"><h4>${escape(LIBELLE[carte.etape])}</h4>${carte.tache ? tacheHtml(carte) : ''}${etat}${alertesHtml(carte)}${autres || principal ? `<div class="pme-actions">${autres}<span class="pme-spacer"></span>${carte.tache ? '' : principal}</div>` : ''}</section>`;
};

const versionsHtml = (carte: Carte) => carte.historique?.length
  ? `<section class="pme-section"><h4>Versions précédentes</h4><ol class="pme-versions">${carte.historique.map((version, index) => `<li><span class="pme-muted">Version ${index + 1}</span><div class="pme-actions">${boutonRaisonnement(version.nom)}${version.documents.map((document, position) => document.chemin ? ouvrirDocument(document, position, version.nom) : '').join('')}</div></li>`).join('')}</ol></section>` : '';

const MATTERS = 'projects/cabinet/matters/';
const CHAMPS: ['client' | 'practiceArea' | 'responsible' | 'openedOn', string][] = [['client', 'Client'], ['practiceArea', 'Domaine'], ['responsible', 'Responsable'], ['openedOn', 'Ouvert le']];
const jour = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR') : date;

const NATURES: Record<string, [string, string]> = { contentieux: ['Contentieux', 'contentieux'], drafting: ['Contrat', 'contrat'], consultation: ['Consultation', 'consultation'] };
const natureHtml = (carte?: Carte) => {
  const nature = NATURES[carte?.raisonnement?.qualification ?? ''];
  return nature ? `<span class="pme-nature pme-nature--${nature[1]}">${nature[0]}</span>` : '';
};
const resumeHtml = (carte?: Carte, fiche?: Fiche) => {
  const reasoning = carte?.raisonnement;
  const parties = (fiche?.parties ?? []).filter((partie) => partie.name).map((partie) => `<li><strong>${escape(partie.name)}</strong>${partie.role ? `<span class="pme-muted">${escape(partie.role)}</span>` : ''}</li>`).join('');
  const objectifs = (reasoning?.objectifs ?? []).map((objectif) => `<li>${escape(objectif)}</li>`).join('');
  return `<section class="pme-section"><h4>Parties</h4>${parties ? `<ul class="pme-parties">${parties}</ul>` : vide('Non renseignées.')}</section>
    ${reasoning?.acte ? '' : `<section class="pme-section"><h4>Document à produire</h4>${vide('Non indiqué.')}</section>`}
    <section class="pme-section"><h4>Objectifs</h4>${objectifs ? `<ol class="pme-objectifs">${objectifs}</ol>` : vide('Aucun objectif.')}</section>`;
};

const ficheHtml = (fiche?: Fiche) => {
  if (!fiche) return '';
  const champs = CHAMPS.filter(([cle]) => fiche[cle]).map(([cle, libelle]) => `<dt>${libelle}</dt><dd>${escape(cle === 'openedOn' ? jour(fiche[cle]!) : fiche[cle])}</dd>`).join('');
  const suite = fiche.nextStep?.text ? `<p>${escape(fiche.nextStep.text)}${[fiche.nextStep.due ? jour(fiche.nextStep.due) : '', fiche.nextStep.owner ?? ''].filter(Boolean).map((detail) => ` <span class="pme-muted">${escape(detail)}</span>`).join('')}</p>` : '';
  const dates = (fiche.keyDates ?? []).filter((date) => date.date).sort((a, b) => a.date!.localeCompare(b.date!)).map((date) => `<li class="${date.done ? 'is-done' : ''}"${date.quote ? ` title="${escape(date.quote)}"` : ''}><span class="pme-fiche-date">${escape(jour(date.date!))}</span><span>${date.done ? '✓ ' : ''}${escape(date.label)}${date.source ? `<span class="pme-muted pme-small">${escape(date.source)}</span>` : ''}</span></li>`).join('');
  return `<section class="pme-section pme-fiche"><h4>Fiche du dossier</h4>${fiche.summary ? `<p>${escape(fiche.summary)}</p>` : ''}${champs ? `<dl>${champs}</dl>` : ''}${suite ? `<h5>Prochaine action</h5>${suite}` : ''}${dates ? `<h5>Dates clés</h5><ul class="pme-fiche-dates">${dates}</ul>` : ''}</section>`;
};

const carteHtml = (carte: Carte, index: number, fiche?: Fiche) => {
  const liste = carte.exclu ? [] : alertes(fiche);
  const ton = liste.some((alerte) => alerte.ton === 'danger') ? ' is-flagged is-danger' : liste.length ? ' is-flagged' : '';
  const reasoning = carte.raisonnement;
  const nature = natureHtml(carte);
  const autres = (reasoning?.objectifs?.length ?? 0) - 1;
  const { etat, principal } = colonne(carte);
  return `<article class="pme-card${carte.exclu ? ' is-excluded' : ''}${ton}" data-card="${index}">
    <header class="pme-card-head"><div class="pme-card-title"><strong>${escape(carte.dossier)}</strong></div>${menuHtml(carte)}</header>
    ${nature || reasoning?.acte ? `<div class="pme-card-meta">${nature}${reasoning?.acte ? `<span>${escape(reasoning.acte)}</span>` : ''}</div>` : ''}
    ${reasoning ? `<p class="pme-card-goal">${escape(reasoning.titre)}${autres > 0 ? ` <span class="pme-muted">+${autres}</span>` : ''}</p>` : ''}
    ${liste.length ? `<p class="pme-attention pme-attention--${liste[0].ton}">${escape(liste[0].texte)}</p>` : ''}${tacheHtml(carte)}${etat}${principal && !carte.tache ? `<div class="pme-card-actions">${principal}</div>` : ''}
  </article>`;
};

export function createTableau(root: HTMLElement, currentProject: () => string | null) {
  const element = document.createElement('div');
  element.className = 'pme-view';
  element.innerHTML = '<div class="pme-board" data-board></div>';
  const board = element.querySelector<HTMLElement>('[data-board]')!;
  const drawer = document.createElement('aside');
  drawer.className = 'pme-drawer';
  drawer.setAttribute('aria-label', 'Dossier');
  drawer.innerHTML = '<header class="pme-drawer-head"><div class="pme-drawer-titles"><span class="pme-drawer-eyebrow" data-eyebrow></span><span class="pme-drawer-title" data-title></span><span class="pme-drawer-tags" data-tags></span></div><button type="button" class="ptr-button ptr-icon-button" data-close aria-label="Fermer">✕</button></header><div class="pme-drawer-body" data-steps></div>';
  const etapesZone = drawer.querySelector<HTMLElement>('[data-steps]')!;
  let afficherExclus = false;
  let ouverte: { carte: string | null; matter: string | null } | null = null;
  let fiches: { rev: string; docs: Record<string, Fiche> } = { rev: '', docs: {} };
  let cartes: Carte[] = [];
  let signature = '';

  const paint = () => {
    const exclus = cartes.some((carte) => carte.exclu);
    const visibles = cartes.filter((carte) => afficherExclus === Boolean(carte.exclu) || carte.etape !== 'preparation');
    const colonnes = COLONNES.map(([etape, libelle]) => [etape, libelle, visibles.filter((carte) => carte.etape === etape)] as const).filter(([etape, , liste]) => liste.length || (etape === 'preparation' && exclus));
    const caseExclus = `<label class="ptr-check" title="Afficher les exclus"><input type="checkbox" data-excluded${afficherExclus ? ' checked' : ''} aria-label="Afficher les exclus"></label>`;
    board.innerHTML = colonnes.length
      ? colonnes.map(([etape, libelle, liste]) => `<section class="pme-col"><h3>${escape(libelle)} <span class="pme-muted">${liste.length}</span>${etape === 'preparation' && exclus ? caseExclus : ''}</h3>${liste.map((carte) => carteHtml(carte, cartes.indexOf(carte), carte.matter ? fiches.docs[`${MATTERS}${carte.matter}`] : undefined)).join('')}</section>`).join('')
      : '<p class="pme-muted pme-empty">Aucun dossier.</p>';
    peindrePanneau();
  };
  const peindrePanneau = () => {
    drawer.classList.toggle('is-open', Boolean(ouverte));
    if (!ouverte) return;
    const index = cartes.findIndex((carte) => carte.id === ouverte!.carte);
    const carte = cartes[index];
    const acte = carte?.raisonnement?.acte;
    drawer.querySelector('[data-eyebrow]')!.textContent = acte ? carte.dossier : '';
    drawer.querySelector('[data-title]')!.textContent = acte ?? carte?.dossier ?? 'Dossier';
    drawer.querySelector('[data-tags]')!.innerHTML = natureHtml(carte);
    etapesZone.dataset.card = String(index);
    const fiche = ouverte.matter ? fiches.docs[`${MATTERS}${ouverte.matter}`] : undefined;
    etapesZone.innerHTML = `${carte ? actionsHtml(carte) : ''}${resumeHtml(carte, fiche)}${carte ? versionsHtml(carte) : ''}${ficheHtml(fiche)}`;
    etapesZone.hidden = !carte && !fiche;
  };
  const chargerFiches = async () => {
    const data = await loadBoard(fiches.rev);
    if (!data.docs) return false;
    fiches = { rev: data.rev, docs: data.docs as Record<string, Fiche> };
    peindrePanneau();
    return true;
  };
  const ouvrir = (carte: Carte | null) => { ouverte = carte ? { carte: carte.id, matter: carte.matter ?? null } : null; peindrePanneau(); void chargerFiches().catch(() => undefined); };
  const refresh = async (frais = false) => {
    if (!frais && (element.querySelector('details.ptr-menu[open]') || drawer.querySelector('details.ptr-menu[open]'))) return;
    const [data, nouvellesFiches] = await Promise.all([etapes.tableau(frais), chargerFiches().catch(() => false)]);
    const next = JSON.stringify(data.cartes);
    if (next === signature) { if (nouvellesFiches) paint(); return; }
    signature = next;
    cartes = data.cartes;
    try { localStorage.setItem(CACHE, next); } catch {}
    paint();
  };
  const reload = () => refresh(true).catch((error: unknown) => toast(root, errorMessage(error), 'error'));
  const run = (work: () => Promise<unknown>, message?: string) => work().then(() => { if (message) toast(root, message); return reload(); }, (error: unknown) => toast(root, errorMessage(error), 'error'));
  const sujet = (carte: Carte) => `<p>${escape(carte.dossier)}${carte.raisonnement ? ` — ${escape(carte.raisonnement.titre)}` : ''}</p>`;

  const ajouterTache = async (carte: Carte, type: string, extra: { document?: number } = {}) => {
    const titres: Record<string, string> = { index: 'Lancer l’index du dossier', conversion: 'Lancer le mapping (conversion et anonymisation)', raisonnement: 'Démarrer le raisonnement', lever: 'Lever manques et erreurs', redaction: 'Lancer la rédaction' };
    const choix = await lancer(root, {
      titre: titres[type] ?? 'Lancer',
      ...(type === 'raisonnement' ? { consignes: 'Objectif(s) du raisonnement', placeholder: OBJECTIFS } : {}),
      ...(type === 'index' ? { modele: INDEX_MODEL, consignes: 'Consignes (facultatif). L’IA vous demandera de valider l’arborescence et les questions à ajouter en colonnes.' } : {}),
    });
    if (!choix) return;
    const { dialog: _dialog, ...reste } = choix;
    await run(() => etapes.ajouterTache({ type, projectPath: carte.projectPath, ...(carte.raisonnement ? { raisonnement: carte.raisonnement.nom } : {}), ...extra, ...reste }), choix.auto ? 'Tâche ajoutée à la file.' : 'Tâche ajoutée aux tâches manuelles.');
  };

  let values: { type: string; typeName: string; file: File | null; nom: string } | null = null;
  const read = (dialog: HTMLElement) => ({
    type: dialog.querySelector<HTMLSelectElement>('[data-type]')!.value,
    typeName: dialog.querySelector<HTMLInputElement>('[data-type-name]')!.value.trim(),
    file: dialog.querySelector<HTMLInputElement>('[data-type-model]')!.files?.[0] ?? null,
    nom: dialog.querySelector<HTMLInputElement>('[data-name]')!.value.trim(),
  });


  const ajouterDocument = async (carte: Carte) => {
    values = null;
    const types = await etapes.types(carte.projectPath).catch(() => []);
    const answer = await openModal(root, {
      title: 'Document à rédiger',
      body: `<label class="ptr-field"><span class="ptr-label">Type de document</span><select class="ptr-select" data-type>${types.map((type) => `<option value="${escape(type.nom)}">${escape(type.nom)}</option>`).join('')}<option value="${NOUVEAU_TYPE}"${types.length ? '' : ' selected'}>Nouveau type…</option></select></label>
        <div class="pme-new-type" data-new-type${types.length ? ' hidden' : ''}>
          <label class="ptr-field"><span class="ptr-label">Nom du nouveau type</span><input class="ptr-input" data-type-name placeholder="Exemple : Conclusions d’appel"></label>
          <label class="ptr-field"><span class="ptr-label">Modèle ou document exemple (facultatif)</span><input type="file" data-type-model></label>
        </div>
        <label class="ptr-field"><span class="ptr-label">Nom du document</span><input class="ptr-input" data-name placeholder="Exemple : Conclusions récapitulatives Société Exemple SAS"></label>`,
      actions: [{ label: 'Annuler', value: 'cancel' }, { label: 'Continuer', value: 'add', kind: 'primary' }],
      onMount: (dialog) => {
        const select = dialog.querySelector<HTMLSelectElement>('[data-type]')!;
        select.addEventListener('change', () => { dialog.querySelector<HTMLElement>('[data-new-type]')!.hidden = select.value !== NOUVEAU_TYPE; });
        dialog.querySelector('[data-modal-action="add"]')?.addEventListener('click', () => { values = read(dialog); });
      },
    });
    if (answer !== 'add' || !values) return;
    const { type, typeName, file, nom } = values;
    if (!nom || (type === NOUVEAU_TYPE && !typeName)) { toast(root, 'Indiquez le type et le nom du document.', 'error'); return; }
    let choisi = false;
    await run(async () => {
      let nomType = type;
      if (type === NOUVEAU_TYPE) {
        const modele = file ? (await etapes.modele(file)).chemin : undefined;
        await etapes.ajouterType({ nom: typeName, ...(modele ? { modele } : {}) });
        nomType = typeName;
      }
      await etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement!.nom, documents: [...sansStatut(carte.documents), { type: nomType, nom, chemin: '' }] });
      choisi = true;
    });
    if (choisi) await ajouterTache(carte, 'redaction', { document: carte.documents?.length ?? 0 });
  };
  const modifierAction = async (carte: Carte) => {
    let texte = carte.action?.texte ?? '';
    const answer = await openModal(root, {
      title: 'Ce que l’on attend',
      body: `<label class="ptr-field"><span class="ptr-label">Attente</span><textarea class="ptr-textarea" rows="3" data-action placeholder="Exemple : relancer l’avocat adverse avant le 15 du mois">${escape(texte)}</textarea></label><p class="pme-muted pme-small">Les dates se règlent dans le suivi du dossier (vue Échéances).</p>`,
      actions: [{ label: 'Annuler', value: 'cancel' }, { label: 'Enregistrer', value: 'save', kind: 'primary' }],
      onMount: (dialog) => dialog.querySelector('[data-action]')!.addEventListener('input', (event) => { texte = (event.target as HTMLTextAreaElement).value; }),
    });
    if (answer === 'save') await run(() => etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement!.nom, action: { texte: texte.trim() } }));
  };

  const integrerPiece = async (carte: Carte) => {
    const choix = await lancer(root, {
      titre: 'Document reçu du tiers',
      bouton: 'Reprendre le raisonnement',
      avant: '<label class="ptr-field"><span class="ptr-label">Document du tiers</span><input type="file" data-piece></label><p class="pme-muted pme-small">Le document rejoint les pièces. Une nouvelle version du raisonnement est créée et la carte revient en Raisonnements. La version actuelle et ses documents sont conservés.</p>',
      consignes: 'Consignes pour l’IA (facultatif)',
      auto: 'Relancer l’IA automatiquement sur la nouvelle pièce',
    });
    const file = choix?.dialog.querySelector<HTMLInputElement>('[data-piece]')?.files?.[0];
    if (!choix) return;
    if (!file) { toast(root, 'Choisissez le document reçu du tiers.', 'error'); return; }
    const { dialog: _dialog, ...reste } = choix;
    await run(async () => {
      const { chemin } = await etapes.piece(carte.projectPath, file);
      const { raisonnement } = await etapes.reprise(carte.projectPath, carte.raisonnement!.nom);
      await etapes.ajouterTache({ type: 'reprise', projectPath: carte.projectPath, raisonnement, piece: chemin, ...reste });
    }, 'Document du tiers ajouté : nouvelle version du raisonnement créée.');
  };

  const finaliser = async (carte: Carte) => {
    const reste = Boolean(carte.action?.texte && !carte.action.fait);
    const answer = await openModal(root, {
      title: 'Valider la suite du dossier',
      body: `${sujet(carte)}<p>${reste ? 'Une prochaine action reste à faire. Conservez le dossier en attente ou confirmez sa clôture.' : 'Le dossier attend-il un tiers ou une autre action ? Choisissez Attente. Sinon, confirmez sa clôture.'}</p>`,
      actions: [{ label: 'Annuler', value: 'cancel' }, { label: 'En attente de tiers', value: 'attente' }, { label: 'Plus d’étape ni d’attente : clore', value: 'clos', kind: 'primary' }],
    });
    if (answer === 'attente' || answer === 'clos') await run(() => carte.raisonnement
      ? etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement.nom, etape: answer })
      : etapes.dossier({ projectPath: carte.projectPath, etape: answer }));
  };

  const deplacer = async (carte: Carte, etape: Etape) => {
    if (etape === 'clos') return finaliser(carte);
    if (!(await confirmDialog(root, `Déplacer vers « ${LIBELLE[etape]} » ?`, sujet(carte), 'Déplacer'))) return;
    await run(() => carte.raisonnement
      ? etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement.nom, etape })
      : etapes.dossier({ projectPath: carte.projectPath, etape }));
  };

  const ecouter = (type: string, listener: (event: Event) => void) => [element, drawer].forEach((zone) => zone.addEventListener(type, listener));
  ecouter('keydown', (event) => { if ((event as KeyboardEvent).key === 'Escape' && ouverte) ouvrir(null); });
  ecouter('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLElement>('button');
    if (button?.matches('[data-close]')) { ouvrir(null); return; }
    const carte = cartes[Number(target.closest<HTMLElement>('[data-card]')?.dataset.card)];
    if (!button && carte && target.closest('.pme-card') && !target.closest('summary, details[open] ul, label, input')) { ouvrir(carte); return; }
    if (!button || !carte) return;
    button.closest('details.ptr-menu')?.removeAttribute('open');
    const data = button.dataset;
    const current = currentProject();
    const failed = (error: unknown) => toast(root, errorMessage(error), 'error');
    const version = data.version ? { ...carte, raisonnement: { ...carte.raisonnement!, nom: data.version } } : carte;
    const documents = data.version ? carte.historique?.find((step) => step.nom === data.version)?.documents : carte.documents;
    if (data.session) ouvrirSession(data.session);
    else if ('openReasoning' in data) void ouvrirRaisonnement(version, current).catch(failed);
    else if (data.openDoc) void ouvrirRaisonnement(version, current, documents?.[Number(data.openDoc)]?.chemin).catch(failed);
    else if (data.move) void deplacer(carte, data.move as Etape);
    else if ('exclude' in data) void confirmDialog(root, 'Retirer ce dossier du tableau ?', `${sujet(carte)}<p>Le dossier est marqué non juridique. Cochez « Afficher les exclus » pour le retrouver.</p>`, 'Retirer').then((ok) => { if (ok) void run(() => etapes.dossier({ projectPath: carte.projectPath, nonJuridique: true })); });
    else if ('include' in data) void confirmDialog(root, 'Réintégrer ce dossier ?', sujet(carte), 'Réintégrer').then((ok) => { if (ok) void run(() => etapes.dossier({ projectPath: carte.projectPath, nonJuridique: false })); });
    else if ('mapping' in data) void ouvrirMapping(carte, current).catch(failed);
    else if (data.volet) void ouvrirVolet(carte, current, data.volet).catch(failed);
    else if (data.launch) void ajouterTache(carte, data.launch, data.doc === undefined ? {} : { document: Number(data.doc) });
    else if (data.validate) {
      const etape = data.validate as Etape;
      const titre = etape === 'redaction' ? 'Valider le raisonnement ?' : 'Valider la rédaction ?';
      void confirmDialog(root, titre, `${sujet(carte)}${etape === 'redaction' && compte(carte) ? `<p>Il reste ${compte(carte)}.</p>` : ''}<p>La carte passe en ${escape(LIBELLE[etape])}.</p>`, 'Valider').then((ok) => { if (ok) void run(() => etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement!.nom, etape })); });
    } else if ('addDoc' in data) void ajouterDocument(carte);
    else if (data.toggleValide) {
      const documents = sansStatut(carte.documents);
      const cible = documents[Number(data.toggleValide)];
      if (cible) void run(() => etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement!.nom, documents: documents.map((document) => document === cible ? { ...document, valide: !cible.valide } : document) }));
    }
    else if (data.removeDoc) {
      const documents = sansStatut(carte.documents);
      const [retire] = documents.splice(Number(data.removeDoc), 1);
      void confirmDialog(root, 'Retirer ce document de la carte ?', `<p>${escape(retire?.nom)}</p><p class="pme-muted">Le fichier n’est pas supprimé.</p>`, 'Retirer', true).then((ok) => { if (ok) void run(() => etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement!.nom, documents })); });
    } else if ('toggleAction' in data) void confirmDialog(root, carte.action?.fait ? 'Marquer cette action à faire ?' : 'Valider cette action effectuée ?', sujet(carte), 'Valider').then((ok) => { if (ok) void run(() => etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement!.nom, action: { fait: !carte.action?.fait } })); });
    else if ('editAction' in data) void modifierAction(carte);
    else if ('finish' in data) void finaliser(carte);
    else if ('integrate' in data) void integrerPiece(carte);
  });

  ecouter('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-excluded]')) return;
    afficherExclus = input.checked;
    paint();
  });
  try { cartes = JSON.parse(localStorage.getItem(CACHE) ?? '[]') as Carte[]; } catch { cartes = []; }
  if (cartes.length) paint();

  const ouvrirDossier = (projectPath: string, raisonnement: string | null) => {
    const carte = cartes.find((entry) => entry.projectPath === projectPath && (entry.raisonnement?.nom ?? null) === raisonnement) ?? cartes.find((entry) => entry.projectPath === projectPath);
    if (carte) ouvrir(carte);
  };
  const ouvrirFiche = (matter: string) => {
    const carte = cartes.find((entry) => entry.matter === matter && entry.raisonnement) ?? cartes.find((entry) => entry.matter === matter);
    ouverte = { carte: carte?.id ?? null, matter };
    peindrePanneau();
    void chargerFiches().catch(() => undefined);
  };

  return { element, drawer, refresh, ouvrirDossier, ouvrirFiche, panneauOuvert: () => Boolean(ouverte) };
}
