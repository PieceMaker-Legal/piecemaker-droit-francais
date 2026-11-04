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
const sansStatut = (documents: DocumentRedige[] = []) => documents.map(({ type, nom, chemin }) => ({ type, nom, chemin }));

const lienRaisonnement = '<button type="button" class="pme-link" data-open-reasoning>Ouvrir le raisonnement</button>';

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

const bulle = (fait: boolean) => `<span class="pme-bulle${fait ? ' is-done' : ''}" aria-label="${fait ? 'Fait' : 'À faire'}">${fait ? '✓' : ''}</span>`;
const preparationHtml = (carte: Carte) => {
  const lignes = carte.preparation ?? [];
  const ligne = (nom: string) => lignes.find((entree) => entree.nom === nom);
  const ok = (nom: string) => ligne(nom)?.ok ?? false;
  const etape = (libelle: string, fait: boolean, onglet: string, lancement: string, valider = '') => `<li>${valider || bulle(fait)}${fait ? `<button type="button" class="pme-link pme-prep-title" data-volet="${onglet}">${libelle}</button>` : `<strong>${libelle}</strong>`}${fait || valider || !lignes.length ? '' : `<span class="pme-spacer"></span><button type="button" class="pme-link" data-launch="${lancement}">Lancer</button>`}</li>`;
  const pieces = ok('conversion') && ok('anonymisation');
  const valider = ok('anonymisation') && !ok('mapping') ? '<button type="button" class="ptr-button ptr-button-primary pme-prep-button" data-mapping>Valider le mapping</button>' : '';
  return `<ul class="pme-prep">${etape('Anonymisation', pieces && ok('mapping'), 'plugin:piecemaker-dossier', 'conversion', valider)}${etape('Index', ok('index'), 'plugin:piecemaker-tabular-review', 'index')}</ul>`;
};

const alertesHtml = (carte: Carte, ouvertes: Set<string>) => {
  const reasoning = carte.raisonnement!;
  if (!reasoning.verifie) return '<p class="pme-muted">Pas encore vérifié.</p>';
  if (!reasoning.alertes.length) return '<p class="pme-ok">✓ Aucun manque ni erreur</p>';
  const resume = [reasoning.erreurs ? plural(reasoning.erreurs, 'erreur') : '', reasoning.manques ? plural(reasoning.manques, 'manque') : ''].filter(Boolean).join(' · ');
  return `<details class="pme-alertes" data-alertes${ouvertes.has(carte.id) ? ' open' : ''}><summary class="${reasoning.erreurs ? 'pme-erreur' : 'pme-manque'}">${resume}</summary><ul>${reasoning.alertes.map((alerte) => `<li class="pme-${alerte.kind}">${escape(alerte.texte)}</li>`).join('')}</ul></details>`;
};

const documentsHtml = (carte: Carte, edition: boolean) => {
  const documents = carte.documents ?? [];
  if (!documents.length) return edition ? '<p class="pme-muted">Aucun document choisi.</p>' : '';
  return `<ul class="pme-docs">${documents.map((document, index) => `<li>
      <div class="pme-doc-head"><strong>${escape(document.nom)}</strong><span class="pme-pill${document.statut === 'en cours' ? ' pme-pill--run' : ''}">${escape(document.statut ?? '')}</span></div>
      <div class="pme-doc-foot"><span class="pme-muted">${escape(document.type)}</span>
        ${document.statut === 'en cours' ? `<button type="button" class="pme-link" data-open-doc="${index}">Ouvrir</button>` : ''}
        ${edition ? `<button type="button" class="pme-link" data-launch="redaction" data-doc="${index}">Lancer rédaction</button><button type="button" class="pme-link pme-link--muted" data-remove-doc="${index}" aria-label="Retirer ${escape(document.nom)}">Retirer</button>` : ''}
      </div></li>`).join('')}</ul>`;
};

const actionHtml = (carte: Carte) => {
  const action = carte.action;
  if (!action?.texte) return '<div class="pme-next"><span class="pme-muted">Aucune prochaine action.</span><button type="button" class="pme-link" data-edit-action>Ajouter</button></div>';
  return `<div class="pme-next"><button type="button" class="pme-pill ${action.fait ? 'pme-pill--done' : 'pme-pill--todo'}" data-toggle-action title="Changer le statut">${action.fait ? 'Effectué' : 'À faire'}</button><span class="pme-next-text">${escape(action.texte)}</span><button type="button" class="pme-link" data-edit-action>Modifier</button></div>`;
};

const historiqueHtml = (carte: Carte) => carte.historique?.length
  ? `<p class="pme-muted pme-small">Versions précédentes : ${carte.historique.map((step) => escape(step.nom)).join(', ')}</p>` : '';

const corpsHtml = (carte: Carte, ouvertes: Set<string>) => {
  if (carte.exclu) return '<div class="pme-actions"><span class="pme-muted">Non juridique</span><button type="button" class="ptr-button" data-include>Réintégrer</button></div>';
  if (carte.aDemarrer) return '<p class="pme-muted">À démarrer : aucun raisonnement.</p><div class="pme-actions"><button type="button" class="ptr-button ptr-button-primary" data-launch="raisonnement">Démarrer le raisonnement</button></div>';
  if (carte.etape === 'preparation') return `${preparationHtml(carte)}${carte.raisonnement ? '' : '<div class="pme-actions"><button type="button" class="ptr-button" data-launch="raisonnement">Démarrer le raisonnement</button></div>'}`;
  if (!carte.raisonnement) return '<button type="button" class="ptr-button" data-launch="raisonnement">Démarrer le raisonnement</button>';
  const issues = carte.raisonnement.erreurs + carte.raisonnement.manques;
  switch (carte.etape) {
    case 'raisonnement':
      return `${alertesHtml(carte, ouvertes)}<div class="pme-actions">${lienRaisonnement}<span class="pme-spacer"></span>${issues ? '<button type="button" class="ptr-button" data-launch="lever">Lever manques et erreurs</button>' : ''}<button type="button" class="ptr-button ptr-button-primary" data-validate="redaction">Valider le raisonnement</button></div>`;
    case 'redaction':
      return `${documentsHtml(carte, true)}<div class="pme-actions">${lienRaisonnement}<span class="pme-spacer"></span><button type="button" class="ptr-button" data-add-doc>+ Document</button><button type="button" class="ptr-button ptr-button-primary" data-validate="finalisation">Valider</button></div>`;
    case 'finalisation':
      return `${actionHtml(carte)}${documentsHtml(carte, false)}<div class="pme-actions">${lienRaisonnement}<button type="button" class="ptr-button ptr-button-primary" data-finish>Valider la finalisation</button></div>`;
    case 'attente':
      return `${actionHtml(carte)}${historiqueHtml(carte)}<div class="pme-actions">${lienRaisonnement}<span class="pme-spacer"></span><button type="button" class="ptr-button" data-finish>Valider la suite</button><button type="button" class="ptr-button ptr-button-primary" data-integrate>Intégrer une pièce</button></div>`;
    default:
      return `${documentsHtml(carte, false)}${historiqueHtml(carte)}<div class="pme-actions">${lienRaisonnement}</div>`;
  }
};

const etapeHtml = (libelle: string, fait: boolean, contenu: string, etat = '') => `<li class="pme-step${etat ? ` is-${etat}` : ''}">${bulle(fait)}<div class="pme-step-body"><strong>${escape(libelle)}${etat === 'current' ? '<span class="pme-pill pme-pill--run">En cours</span>' : ''}</strong>${contenu}</div></li>`;
const ouvrirVersion = (nom: string) => `<button type="button" class="pme-link" data-open-reasoning data-version="${escape(nom)}">Ouvrir le raisonnement</button>`;
const documentsVersion = (nom: string, documents: DocumentRedige[]) => documents.length
  ? `<ul class="pme-docs">${documents.map((document, index) => `<li><div class="pme-doc-head"><strong>${escape(document.nom)}</strong></div><div class="pme-doc-foot"><span class="pme-muted">${escape(document.type)}</span>${document.chemin ? `<button type="button" class="pme-link" data-open-doc="${index}" data-version="${escape(nom)}">Ouvrir</button>` : ''}</div></li>`).join('')}</ul>` : '';

const versionHtml = (nom: string, documents: DocumentRedige[]) => COLONNES.slice(0, 5).map(([etape, libelle]) => etapeHtml(libelle, true,
  etape === 'preparation' ? '' : `${etape === 'redaction' ? documentsVersion(nom, documents) : ''}<div class="pme-actions">${ouvrirVersion(nom)}</div>`)).join('');

const etapesHtml = (carte: Carte, ouvertes: Set<string>) => {
  if (carte.exclu) return corpsHtml(carte, ouvertes);
  const courante = COLONNES.findIndex(([etape]) => etape === carte.etape);
  const clos = carte.etape === 'clos';
  const actuelle = COLONNES.map(([etape, libelle], index) => {
    if (index > courante) return etapeHtml(libelle, false, '', 'todo');
    if (index === courante) return etapeHtml(libelle, clos, corpsHtml(carte, ouvertes), clos ? '' : 'current');
    if (etape === 'preparation') return etapeHtml(libelle, true, '');
    const documents = etape === 'redaction' || etape === 'finalisation' ? documentsHtml(carte, false) : '';
    return etapeHtml(libelle, true, `${documents}<div class="pme-actions">${lienRaisonnement}</div>`);
  }).join('');
  const versions = carte.historique ?? [];
  if (!versions.length) return `<ol class="pme-steps">${actuelle}</ol>`;
  return [...versions.map((version, index) => `<section class="pme-version"><h4>Version ${index + 1}</h4><ol class="pme-steps">${versionHtml(version.nom, version.documents)}</ol></section>`),
    `<section class="pme-version"><h4>Version ${versions.length + 1}</h4><ol class="pme-steps">${actuelle}</ol></section>`].join('');
};

const MATTERS = 'projects/cabinet/matters/';
const CHAMPS: ['client' | 'practiceArea' | 'responsible' | 'openedOn', string][] = [['client', 'Client'], ['practiceArea', 'Domaine'], ['responsible', 'Responsable'], ['openedOn', 'Ouvert le']];
const jour = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`).toLocaleDateString('fr-FR') : date;

const NATURES: Record<string, [string, string]> = { contentieux: ['Contentieux', 'contentieux'], drafting: ['Contrat', 'contrat'], consultation: ['Consultation', 'consultation'] };
const natureHtml = (carte?: Carte) => {
  const nature = NATURES[carte?.raisonnement?.qualification ?? ''];
  return nature ? `<span class="pme-nature pme-nature--${nature[1]}">${nature[0]}</span>` : '';
};
const vide = (texte: string) => `<p class="pme-muted">${texte}</p>`;

const resumeHtml = (carte?: Carte, fiche?: Fiche) => {
  const reasoning = carte?.raisonnement;
  const parties = (fiche?.parties ?? []).filter((partie) => partie.name).map((partie) => `<li><strong>${escape(partie.name)}</strong>${partie.role ? `<span class="pme-muted">${escape(partie.role)}</span>` : ''}</li>`).join('');
  const objectifs = (reasoning?.objectifs ?? []).map((objectif) => `<li>${escape(objectif)}</li>`).join('');
  return `<section class="pme-section"><h4>Parties</h4>${parties ? `<ul class="pme-parties">${parties}</ul>` : vide('Non renseignées.')}</section>
    <section class="pme-section"><h4>Document à produire</h4>${reasoning?.acte ? `<p>${escape(reasoning.acte)}</p>` : vide('Non indiqué.')}</section>
    <section class="pme-section"><h4>Objectifs</h4>${objectifs ? `<ol class="pme-objectifs">${objectifs}</ol>` : vide('Aucun objectif.')}</section>`;
};

const ficheHtml = (fiche?: Fiche) => {
  if (!fiche) return '';
  const champs = CHAMPS.filter(([cle]) => fiche[cle]).map(([cle, libelle]) => `<dt>${libelle}</dt><dd>${escape(cle === 'openedOn' ? jour(fiche[cle]!) : fiche[cle])}</dd>`).join('');
  const suite = fiche.nextStep?.text ? `<p>${escape(fiche.nextStep.text)}${[fiche.nextStep.due ? jour(fiche.nextStep.due) : '', fiche.nextStep.owner ?? ''].filter(Boolean).map((detail) => ` <span class="pme-muted">${escape(detail)}</span>`).join('')}</p>` : '';
  const dates = (fiche.keyDates ?? []).filter((date) => date.date).sort((a, b) => a.date!.localeCompare(b.date!)).map((date) => `<li class="${date.done ? 'is-done' : ''}"${date.quote ? ` title="${escape(date.quote)}"` : ''}><span class="pme-fiche-date">${escape(jour(date.date!))}</span><span>${date.done ? '✓ ' : ''}${escape(date.label)}${date.source ? `<span class="pme-muted pme-small">${escape(date.source)}</span>` : ''}</span></li>`).join('');
  return `<section class="pme-section pme-fiche"><h4>Fiche du dossier</h4>${fiche.summary ? `<p>${escape(fiche.summary)}</p>` : ''}${champs ? `<dl>${champs}</dl>` : ''}${suite ? `<h5>Prochaine action</h5>${suite}` : ''}${dates ? `<h5>Dates clés</h5><ul class="pme-fiche-dates">${dates}</ul>` : ''}</section>`;
};

const etatHtml = (carte: Carte) => {
  const reasoning = carte.raisonnement;
  if (carte.exclu) return vide('Non juridique');
  if (carte.aDemarrer || !reasoning) return vide('Aucun raisonnement');
  if (!reasoning.erreurs && !reasoning.manques) return '';
  return `<p class="${reasoning.erreurs ? 'pme-erreur' : 'pme-manque'}">${[reasoning.erreurs ? plural(reasoning.erreurs, 'erreur') : '', reasoning.manques ? plural(reasoning.manques, 'manque') : ''].filter(Boolean).join(' · ')}</p>`;
};

const carteHtml = (carte: Carte, index: number, fiche?: Fiche) => {
  const liste = carte.exclu ? [] : alertes(fiche);
  const ton = liste.some((alerte) => alerte.ton === 'danger') ? ' is-flagged is-danger' : liste.length ? ' is-flagged' : '';
  const reasoning = carte.raisonnement;
  const nature = natureHtml(carte);
  const autres = (reasoning?.objectifs?.length ?? 0) - 1;
  return `<article class="pme-card${carte.exclu ? ' is-excluded' : ''}${ton}" data-card="${index}">
    <header class="pme-card-head"><div class="pme-card-title"><strong>${escape(carte.dossier)}</strong></div>${menuHtml(carte)}</header>
    ${nature || reasoning?.acte ? `<div class="pme-card-meta">${nature}${reasoning?.acte ? `<span>${escape(reasoning.acte)}</span>` : ''}</div>` : ''}
    ${reasoning ? `<p class="pme-card-goal">${escape(reasoning.titre)}${autres > 0 ? ` <span class="pme-muted">+${autres}</span>` : ''}</p>` : ''}
    ${liste.length ? `<p class="pme-attention pme-attention--${liste[0].ton}">${escape(liste[0].texte)}</p>` : ''}${tacheHtml(carte)}${etatHtml(carte)}
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
  const ouvertes = new Set<string>();
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
    drawer.querySelector('[data-eyebrow]')!.textContent = carte?.dossier ?? '';
    drawer.querySelector('[data-title]')!.textContent = carte ? carte.raisonnement?.acte ?? carte.raisonnement?.titre ?? carte.dossier : 'Dossier';
    drawer.querySelector('[data-tags]')!.innerHTML = natureHtml(carte);
    etapesZone.dataset.card = String(index);
    const fiche = ouverte.matter ? fiches.docs[`${MATTERS}${ouverte.matter}`] : undefined;
    etapesZone.innerHTML = `${carte ? tacheHtml(carte) : ''}${resumeHtml(carte, fiche)}${carte ? `<section class="pme-section"><h4>Étapes</h4>${etapesHtml(carte, ouvertes)}</section>` : ''}${ficheHtml(fiche)}`;
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
      title: 'Ajouter un document',
      body: `<label class="ptr-field"><span class="ptr-label">Type de document</span><select class="ptr-select" data-type>${types.map((type) => `<option value="${escape(type.nom)}">${escape(type.nom)}</option>`).join('')}<option value="${NOUVEAU_TYPE}"${types.length ? '' : ' selected'}>Nouveau type…</option></select></label>
        <div class="pme-new-type" data-new-type${types.length ? ' hidden' : ''}>
          <label class="ptr-field"><span class="ptr-label">Nom du nouveau type</span><input class="ptr-input" data-type-name placeholder="Exemple : Conclusions d’appel"></label>
          <label class="ptr-field"><span class="ptr-label">Modèle ou document exemple (facultatif)</span><input type="file" data-type-model></label>
        </div>
        <label class="ptr-field"><span class="ptr-label">Nom du document</span><input class="ptr-input" data-name placeholder="Exemple : Conclusions récapitulatives Société Exemple SAS"></label>`,
      actions: [{ label: 'Annuler', value: 'cancel' }, { label: 'Ajouter', value: 'add', kind: 'primary' }],
      onMount: (dialog) => {
        const select = dialog.querySelector<HTMLSelectElement>('[data-type]')!;
        select.addEventListener('change', () => { dialog.querySelector<HTMLElement>('[data-new-type]')!.hidden = select.value !== NOUVEAU_TYPE; });
        dialog.querySelector('[data-modal-action="add"]')?.addEventListener('click', () => { values = read(dialog); });
      },
    });
    if (answer !== 'add' || !values) return;
    const { type, typeName, file, nom } = values;
    if (!nom || (type === NOUVEAU_TYPE && !typeName)) { toast(root, 'Indiquez le type et le nom du document.', 'error'); return; }
    await run(async () => {
      let nomType = type;
      if (type === NOUVEAU_TYPE) {
        const modele = file ? (await etapes.modele(file)).chemin : undefined;
        await etapes.ajouterType({ nom: typeName, ...(modele ? { modele } : {}) });
        nomType = typeName;
      }
      await etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement!.nom, documents: [...sansStatut(carte.documents), { type: nomType, nom, chemin: '' }] });
    });
  };
  const modifierAction = async (carte: Carte) => {
    let texte = carte.action?.texte ?? '';
    const answer = await openModal(root, {
      title: 'Prochaine action',
      body: `<label class="ptr-field"><span class="ptr-label">Action</span><textarea class="ptr-textarea" rows="3" data-action placeholder="Exemple : relancer l’avocat adverse avant le 15 du mois">${escape(texte)}</textarea></label><p class="pme-muted pme-small">Les dates se règlent dans le suivi du dossier (vue Échéances).</p>`,
      actions: [{ label: 'Annuler', value: 'cancel' }, { label: 'Enregistrer', value: 'save', kind: 'primary' }],
      onMount: (dialog) => dialog.querySelector('[data-action]')!.addEventListener('input', (event) => { texte = (event.target as HTMLTextAreaElement).value; }),
    });
    if (answer === 'save') await run(() => etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement!.nom, action: { texte: texte.trim() } }));
  };

  const integrerPiece = async (carte: Carte) => {
    const choix = await lancer(root, {
      titre: 'Intégrer une pièce',
      bouton: 'Intégrer',
      avant: '<label class="ptr-field"><span class="ptr-label">Nouvelle pièce</span><input type="file" data-piece></label><p class="pme-muted pme-small">La carte revient en Raisonnements. Le raisonnement actuel et ses documents sont conservés ; une nouvelle version est créée.</p>',
      consignes: 'Consignes pour l’IA (facultatif)',
      auto: 'Relancer l’IA automatiquement sur la nouvelle pièce',
    });
    const file = choix?.dialog.querySelector<HTMLInputElement>('[data-piece]')?.files?.[0];
    if (!choix) return;
    if (!file) { toast(root, 'Choisissez la pièce à intégrer.', 'error'); return; }
    const { dialog: _dialog, ...reste } = choix;
    await run(async () => {
      const { chemin } = await etapes.piece(carte.projectPath, file);
      const { raisonnement } = await etapes.reprise(carte.projectPath, carte.raisonnement!.nom);
      await etapes.ajouterTache({ type: 'reprise', projectPath: carte.projectPath, raisonnement, piece: chemin, ...reste });
    }, 'Pièce intégrée : nouvelle version du raisonnement créée.');
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

  const ecouter = (type: string, listener: (event: Event) => void, capture = false) => [element, drawer].forEach((zone) => zone.addEventListener(type, listener, capture));
  ecouter('toggle', (event) => {
    const details = event.target as HTMLElement;
    if (!details.matches('[data-alertes]')) return;
    const id = cartes[Number(details.closest<HTMLElement>('[data-card]')?.dataset.card)]?.id ?? '';
    if ((details as HTMLDetailsElement).open) ouvertes.add(id); else ouvertes.delete(id);
  }, true);

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
      void confirmDialog(root, titre, `${sujet(carte)}<p>La carte passe en ${escape(LIBELLE[etape])}.</p>`, 'Valider').then((ok) => { if (ok) void run(() => etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement!.nom, etape })); });
    } else if ('addDoc' in data) void ajouterDocument(carte);
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
