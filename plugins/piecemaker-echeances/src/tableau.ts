import { confirmDialog, errorMessage, escapeHtml as escape, openModal, toast } from '../../piecemaker-tabular-review/src/client/dom.js';
import { INDEX_MODEL } from '../../piecemaker-tabular-review/src/shared.js';
import { etapes } from './api.js';
import type { Carte, DocumentRedige, Etape } from './api.js';
import { lancer } from './lancer.js';
import { ouvrirRaisonnement, ouvrirSession, ouvrirVolet } from './navigation.js';

const COLONNES: [Etape, string][] = [
  ['preparation', 'Préparation dossier'],
  ['raisonnement', 'Raisonnements'],
  ['redaction', 'Rédaction'],
  ['finalisation', 'Finalisation'],
  ['attente', 'En attente de tiers'],
  ['clos', 'Clos'],
];
const LIBELLE = Object.fromEntries(COLONNES) as Record<Etape, string>;
const LIGNES: Record<string, string> = { anonymisation: 'Anonymisation', mapping: 'Mapping', index: 'Index', conversion: 'Conversion', lecture: 'Vérification' };
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
  const items = carte.exclu || carte.aDemarrer ? []
    : carte.raisonnement ? COLONNES.filter(([etape]) => etape !== carte.etape).map(([etape, libelle]) => `<button type="button" class="ptr-menu-item" data-move="${etape}">Déplacer vers ${escape(libelle)}</button>`)
      : ['<button type="button" class="ptr-menu-item" data-move="raisonnement">Déplacer vers Raisonnements</button>', '<button type="button" class="ptr-menu-item" data-exclude>Non juridique : retirer du tableau</button>'];
  if (!items.length) return '';
  return `<details class="ptr-menu pme-move"><summary class="ptr-icon-button" aria-label="Actions de la carte" title="Déplacer">⋯</summary><div class="ptr-menu-list">${items.join('')}</div></details>`;
};

const preparationHtml = (carte: Carte) => {
  const lignes = carte.preparation ?? [];
  const ok = (nom: string) => lignes.find((ligne) => ligne.nom === nom)?.ok ?? false;
  const aValider = ok('anonymisation') && !ok('mapping');
  return `<ul class="pme-checks">${lignes.map((ligne) => `<li class="${ligne.ok ? 'is-ok' : 'is-ko'}" title="${escape(ligne.texte)}">${ligne.ok ? '✓' : '•'} ${escape(LIGNES[ligne.nom] ?? ligne.nom)}${ligne.ok ? '' : ` <span class="pme-muted">${escape(ligne.texte.split('\n')[0])}</span>`}</li>`).join('')}</ul>
    <div class="pme-actions">
      <button type="button" class="ptr-button pme-badged" data-mapping>${aValider ? '<span class="pme-badge">À valider</span>' : ''}Mapping</button>
      <button type="button" class="ptr-button" data-launch="index">Index</button>
    </div>`;
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
  if (!carte.raisonnement) return preparationHtml(carte);
  const issues = carte.raisonnement.erreurs + carte.raisonnement.manques;
  switch (carte.etape) {
    case 'raisonnement':
      return `${alertesHtml(carte, ouvertes)}<div class="pme-actions">${lienRaisonnement}<span class="pme-spacer"></span>${issues ? '<button type="button" class="ptr-button" data-launch="lever">Lever manques et erreurs</button>' : ''}<button type="button" class="ptr-button ptr-button-primary" data-validate="redaction">Valider le raisonnement</button></div>`;
    case 'redaction':
      return `${documentsHtml(carte, true)}<div class="pme-actions">${lienRaisonnement}<span class="pme-spacer"></span><button type="button" class="ptr-button" data-add-doc>+ Document</button><button type="button" class="ptr-button ptr-button-primary" data-validate="finalisation">Valider</button></div>`;
    case 'finalisation':
      return `${actionHtml(carte)}${documentsHtml(carte, false)}<div class="pme-actions">${lienRaisonnement}</div>`;
    case 'attente':
      return `${actionHtml(carte)}${historiqueHtml(carte)}<div class="pme-actions">${lienRaisonnement}<span class="pme-spacer"></span><button type="button" class="ptr-button ptr-button-primary" data-integrate>Intégrer une pièce</button></div>`;
    default:
      return `${documentsHtml(carte, false)}${historiqueHtml(carte)}<div class="pme-actions">${lienRaisonnement}</div>`;
  }
};

const carteHtml = (carte: Carte, index: number, ouvertes: Set<string>) => `<article class="pme-card${carte.exclu ? ' is-excluded' : ''}" data-card="${index}">
    <header class="pme-card-head"><div class="pme-card-title"><strong>${escape(carte.dossier)}</strong>${carte.raisonnement ? `<span class="pme-muted">${escape(carte.raisonnement.titre)}</span>` : ''}</div>${menuHtml(carte)}</header>
    ${tacheHtml(carte)}${corpsHtml(carte, ouvertes)}
  </article>`;

export function createTableau(root: HTMLElement, currentProject: () => string | null) {
  const element = document.createElement('div');
  element.className = 'pme-view';
  element.innerHTML = '<div class="pme-board" data-board></div>';
  const board = element.querySelector<HTMLElement>('[data-board]')!;
  let afficherExclus = false;
  const ouvertes = new Set<string>();
  let cartes: Carte[] = [];
  let signature = '';

  const paint = () => {
    const exclus = cartes.some((carte) => carte.exclu);
    const visibles = cartes.filter((carte) => afficherExclus === Boolean(carte.exclu) || carte.etape !== 'preparation');
    const colonnes = COLONNES.map(([etape, libelle]) => [etape, libelle, visibles.filter((carte) => carte.etape === etape)] as const).filter(([etape, , liste]) => liste.length || (etape === 'preparation' && exclus));
    const caseExclus = `<label class="ptr-check" title="Afficher les exclus"><input type="checkbox" data-excluded${afficherExclus ? ' checked' : ''} aria-label="Afficher les exclus"></label>`;
    board.innerHTML = colonnes.length
      ? colonnes.map(([etape, libelle, liste]) => `<section class="pme-col"><h3>${escape(libelle)} <span class="pme-muted">${liste.length}</span>${etape === 'preparation' && exclus ? caseExclus : ''}</h3>${liste.map((carte) => carteHtml(carte, cartes.indexOf(carte), ouvertes)).join('')}</section>`).join('')
      : '<p class="pme-muted pme-empty">Aucun dossier.</p>';
  };
  const refresh = async (frais = false) => {
    if (!frais && board.querySelector('details.ptr-menu[open]')) return;
    const data = await etapes.tableau(frais);
    const next = JSON.stringify(data.cartes);
    if (next === signature) return;
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

  const deplacer = async (carte: Carte, etape: Etape) => {
    if (!(await confirmDialog(root, `Déplacer vers « ${LIBELLE[etape]} » ?`, sujet(carte), 'Déplacer'))) return;
    await run(() => carte.raisonnement
      ? etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement.nom, etape })
      : etapes.dossier({ projectPath: carte.projectPath, preparationForcee: true }));
  };

  board.addEventListener('toggle', (event) => {
    const details = event.target as HTMLElement;
    if (!details.matches('[data-alertes]')) return;
    const id = cartes[Number(details.closest<HTMLElement>('[data-card]')?.dataset.card)]?.id ?? '';
    if ((details as HTMLDetailsElement).open) ouvertes.add(id); else ouvertes.delete(id);
  }, true);

  board.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLElement>('button');
    const carte = cartes[Number(target.closest<HTMLElement>('[data-card]')?.dataset.card)];
    if (!button || !carte) return;
    button.closest('details.ptr-menu')?.removeAttribute('open');
    const data = button.dataset;
    const current = currentProject();
    const failed = (error: unknown) => toast(root, errorMessage(error), 'error');
    if (data.session) ouvrirSession(data.session);
    else if ('openReasoning' in data) void ouvrirRaisonnement(carte, current).catch(failed);
    else if (data.openDoc) void ouvrirRaisonnement(carte, current, carte.documents?.[Number(data.openDoc)]?.chemin).catch(failed);
    else if (data.move) void deplacer(carte, data.move as Etape);
    else if ('exclude' in data) void confirmDialog(root, 'Retirer ce dossier du tableau ?', `${sujet(carte)}<p>Le dossier est marqué non juridique. Cochez « Afficher les exclus » pour le retrouver.</p>`, 'Retirer').then((ok) => { if (ok) void run(() => etapes.dossier({ projectPath: carte.projectPath, nonJuridique: true })); });
    else if ('include' in data) void run(() => etapes.dossier({ projectPath: carte.projectPath, nonJuridique: false }));
    else if ('mapping' in data) {
      const anonymise = carte.preparation?.find((ligne) => ligne.nom === 'anonymisation')?.ok;
      if (anonymise) void ouvrirVolet(carte, current, 'plugin:piecemaker-dossier').catch(failed);
      else void ajouterTache(carte, 'conversion');
    } else if (data.launch) void ajouterTache(carte, data.launch, data.doc === undefined ? {} : { document: Number(data.doc) });
    else if (data.validate) {
      const etape = data.validate as Etape;
      const titre = etape === 'redaction' ? 'Valider le raisonnement ?' : 'Valider la rédaction ?';
      void confirmDialog(root, titre, `${sujet(carte)}<p>La carte passe en ${escape(LIBELLE[etape])}.</p>`, 'Valider').then((ok) => { if (ok) void run(() => etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement!.nom, etape })); });
    } else if ('addDoc' in data) void ajouterDocument(carte);
    else if (data.removeDoc) {
      const documents = sansStatut(carte.documents);
      const [retire] = documents.splice(Number(data.removeDoc), 1);
      void confirmDialog(root, 'Retirer ce document de la carte ?', `<p>${escape(retire?.nom)}</p><p class="pme-muted">Le fichier n’est pas supprimé.</p>`, 'Retirer', true).then((ok) => { if (ok) void run(() => etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement!.nom, documents })); });
    } else if ('toggleAction' in data) void run(() => etapes.raisonnement({ projectPath: carte.projectPath, raisonnement: carte.raisonnement!.nom, action: { fait: !carte.action?.fait } }));
    else if ('editAction' in data) void modifierAction(carte);
    else if ('integrate' in data) void integrerPiece(carte);
  });

  board.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.matches('[data-excluded]')) return;
    afficherExclus = input.checked;
    paint();
  });
  try { cartes = JSON.parse(localStorage.getItem(CACHE) ?? '[]') as Carte[]; } catch { cartes = []; }
  if (cartes.length) paint();

  return { element, refresh };
}
