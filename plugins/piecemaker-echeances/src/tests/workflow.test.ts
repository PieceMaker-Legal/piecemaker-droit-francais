import { webcrypto } from 'node:crypto';
import { TextEncoder } from 'node:util';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { loadModels } from '../../../piecemaker-tabular-review/src/client/host.js';
import { etapes, loadBoard } from '../api.js';
import type { Carte } from '../api.js';
import { unmount } from '../client.js';
import { createTableau } from '../tableau.js';

vi.mock('../api.js', () => ({
  etapes: { tableau: vi.fn(), dossier: vi.fn(), raisonnement: vi.fn(), volet: vi.fn(), taches: vi.fn(), piece: vi.fn(), reprise: vi.fn(), ajouterTache: vi.fn() },
  loadBoardPage: vi.fn(() => new Promise(() => {})), loadAll: vi.fn(), loadBoard: vi.fn().mockResolvedValue({ rev: '' }), verifySuivi: vi.fn(),
}));

vi.mock('../../../piecemaker-tabular-review/src/client/host.js', () => ({ loadModels: vi.fn().mockResolvedValue({ options: [{ value: 'modele-exemple', label: 'Modèle exemple' }], cheapest: 'modele-exemple' }) }));

const raisonnement = { nom: 'analyse', titre: 'Analyse exemple', verifie: true, erreurs: 0, manques: 0, alertes: [] };
const carte = (extra: Partial<Carte> = {}): Carte => ({ id: 'exemple', projectPath: '/exemple', dossier: 'Dossier exemple', session: 'exemple-session', etape: 'raisonnement', ...extra });
const click = (selector: string) => {
  const element = document.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  element!.click();
};
const flush = async () => { for (let index = 0; index < 10; index++) await Promise.resolve(); };
let root: HTMLElement;

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('TextEncoder', TextEncoder);
  vi.mocked(loadModels).mockResolvedValue({ options: [{ value: 'modele-exemple', label: 'Modèle exemple' }], cheapest: 'modele-exemple' });
  localStorage.clear();
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  vi.mocked(etapes.dossier).mockResolvedValue({});
  vi.mocked(etapes.raisonnement).mockResolvedValue({});
  vi.mocked(etapes.volet).mockResolvedValue({});
  vi.mocked(etapes.taches).mockResolvedValue([]);
});
afterEach(() => { unmount(root); vi.clearAllMocks(); vi.unstubAllGlobals(); });

async function tableau(c: Carte) {
  vi.mocked(etapes.tableau).mockResolvedValue({ cartes: [c] });
  const view = createTableau(root, () => '/exemple');
  root.append(view.element, view.drawer);
  await view.refresh();
  view.ouvrirDossier(c.projectPath, c.raisonnement?.nom ?? null);
  return view;
}

it('met l’action de la colonne sur la carte et détaille parties, acte et objectifs dans le panneau', async () => {
  vi.mocked(loadBoard).mockResolvedValue({ rev: '1', docs: { 'projects/cabinet/matters/exemple': { status: 'open', origin: 'page', nextStep: { text: 'Relancer' }, parties: [{ name: 'Jean Dupont', role: 'Demandeur' }, { name: 'Société Exemple SAS', role: 'Défendeur' }] } } });
  await tableau(carte({ matter: 'exemple', raisonnement: { ...raisonnement, qualification: 'contentieux', acte: 'Conclusions en défense', objectifs: ['Écarter la demande de Jean Dupont', 'Obtenir des frais irrépétibles'] } }));
  await flush();
  const card = root.querySelector('.pme-card')!;
  expect(card.querySelector('.pme-nature--contentieux')?.textContent).toBe('Contentieux');
  expect(card.textContent).toContain('Conclusions en défense');
  expect(card.querySelector('.pme-card-actions [data-validate="redaction"]')?.textContent).toBe('Valider le raisonnement');
  expect(card.querySelector('[data-open-reasoning]')).toBeNull();
  const panneau = root.querySelector('.pme-drawer')!;
  expect(panneau.querySelector('[data-title]')?.textContent).toBe('Conclusions en défense');
  expect(panneau.textContent).toContain('Société Exemple SAS');
  expect(panneau.querySelectorAll('.pme-objectifs li')).toHaveLength(2);
  expect(panneau.querySelector('.pme-section h4')?.textContent).toBe('Raisonnements');
  expect(panneau.querySelector('[data-open-reasoning]')).not.toBeNull();
  expect(panneau.querySelector('[data-validate="redaction"]')).not.toBeNull();
  vi.mocked(loadBoard).mockResolvedValue({ rev: '' });
});

it('ne propose de valider que ce qui existe', async () => {
  const card = () => root.querySelector('.pme-card')!;
  await tableau(carte({ raisonnement: { ...raisonnement, verifie: false } }));
  expect(root.querySelector('[data-validate]')).toBeNull();
  expect(card().querySelector('[data-launch="lever"]')?.textContent).toBe('Vérifier le raisonnement');
  unmount(root);
  root.innerHTML = '';
  await tableau(carte({ raisonnement: { ...raisonnement, manques: 1, alertes: [{ kind: 'manque', texte: 'Source manquante' }] } }));
  expect(card().querySelector('[data-launch="lever"]')?.textContent).toBe('Lever manques et erreurs');
  expect(root.querySelector('.pme-drawer [data-validate="redaction"]')?.textContent).toBe('Valider malgré tout');
  expect(root.querySelector('.pme-drawer')?.textContent).toContain('Source manquante');
  unmount(root);
  root.innerHTML = '';
  await tableau(carte({ etape: 'redaction', raisonnement }));
  expect(card().textContent).toContain('Rédaction non commencée');
  expect(card().querySelector('[data-add-doc]')?.textContent).toBe('Lancer la rédaction');
  expect(root.querySelector('[data-validate]')).toBeNull();
  unmount(root);
  root.innerHTML = '';
  await tableau(carte({ etape: 'redaction', raisonnement, documents: [{ type: 'Conclusions', nom: 'Conclusions exemple', chemin: 'Projets/exemple.docx', statut: 'en cours' }] }));
  expect(card().textContent).toContain('Conclusions exemple');
  expect(card().querySelector('[data-validate="finalisation"]')?.textContent).toBe('Valider la rédaction');
  expect(root.querySelector('.pme-drawer [data-open-doc="0"]')?.textContent).toContain('Conclusions exemple');
  expect(root.querySelector('[data-add-doc]')).toBeNull();
  expect(card().textContent).toContain('Conclusions exemple (en cours de rédaction)');
  click('.pme-drawer [data-toggle-valide="0"]');
  await vi.waitFor(() => expect(etapes.raisonnement).toHaveBeenCalledWith(expect.objectContaining({ documents: [{ type: 'Conclusions', nom: 'Conclusions exemple', chemin: 'Projets/exemple.docx', valide: true }] })));
  unmount(root);
  root.innerHTML = '';
  await tableau(carte({ etape: 'redaction', raisonnement, documents: [{ type: 'Conclusions', nom: 'Conclusions exemple', chemin: 'Projets/exemple.docx', valide: true, statut: 'validé' }] }));
  expect(card().textContent).toContain('Conclusions exemple (validé)');
  expect(root.querySelector('.pme-drawer [data-toggle-valide="0"]')?.textContent).toBe('Remettre Conclusions exemple en cours');
});

it('déplace une carte à démarrer sans YAML après confirmation et permet son exclusion', async () => {
  await tableau(carte({ aDemarrer: true }));
  expect(document.querySelectorAll('[data-move]')).toHaveLength(5);
  click('[data-move="redaction"]');
  expect(etapes.dossier).not.toHaveBeenCalled();
  click('[data-modal-action="cancel"]');
  await flush();
  expect(etapes.dossier).not.toHaveBeenCalled();
  click('[data-move="redaction"]');
  click('[data-modal-action="confirm"]');
  await flush();
  expect(etapes.dossier).toHaveBeenCalledWith({ projectPath: '/exemple', etape: 'redaction' });
  click('[data-exclude]');
  click('[data-modal-action="confirm"]');
  await flush();
  expect(etapes.dossier).toHaveBeenCalledWith({ projectPath: '/exemple', nonJuridique: true });
  click('[data-move="clos"]');
  expect(root.querySelector('[role="dialog"]')?.textContent).toContain('Plus d’étape ni d’attente : clore');
  click('[data-modal-action="clos"]');
  await flush();
  expect(etapes.dossier).toHaveBeenLastCalledWith({ projectPath: '/exemple', etape: 'clos' });
});

it('ouvre le mapping et l’index en Préparation même avec un raisonnement', async () => {
  await tableau(carte({ etape: 'preparation', raisonnement, preparation: [
    { nom: 'conversion', texte: '', ok: true }, { nom: 'anonymisation', texte: '', ok: true },
    { nom: 'mapping', texte: '', ok: false }, { nom: 'index', texte: '', ok: true },
  ] }));
  click('[data-mapping]');
  await flush();
  expect(etapes.volet).toHaveBeenCalledWith('/exemple', 'plugin:piecemaker-dossier');
  click('[data-volet="plugin:piecemaker-tabular-review"]');
  await flush();
  expect(etapes.volet).toHaveBeenCalledWith('/exemple', 'plugin:piecemaker-tabular-review');
});

it('ouvre le premier document et garde une décision explicite pour clore une action restante', async () => {
  await tableau(carte({ etape: 'finalisation', raisonnement, action: { texte: 'Attendre une réponse', fait: false }, documents: [{ type: 'Courrier', nom: 'Projet exemple', chemin: 'Projets/exemple.docx', statut: 'en cours' }] }));
  click('[data-open-doc="0"]');
  await flush();
  expect(etapes.volet).toHaveBeenCalledWith('/exemple', 'files', '/exemple/Projets/exemple.docx');
  click('[data-finish]');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Une prochaine action reste à faire');
  expect(etapes.raisonnement).not.toHaveBeenCalled();
  click('[data-modal-action="attente"]');
  await flush();
  expect(etapes.raisonnement).toHaveBeenCalledWith({ projectPath: '/exemple', raisonnement: 'analyse', etape: 'attente' });
});

it('modifie et valide une action sans clôturer le dossier automatiquement', async () => {
  await tableau(carte({ etape: 'attente', raisonnement, action: { texte: 'Relancer', fait: false } }));
  click('[data-edit-action]');
  const champ = document.querySelector<HTMLTextAreaElement>('[data-action]')!;
  champ.value = 'Envoyer le courrier';
  champ.dispatchEvent(new Event('input', { bubbles: true }));
  click('[data-modal-action="save"]');
  await flush();
  expect(etapes.raisonnement).toHaveBeenLastCalledWith({ projectPath: '/exemple', raisonnement: 'analyse', action: { texte: 'Envoyer le courrier' } });
  vi.mocked(etapes.raisonnement).mockClear();
  click('[data-toggle-action]');
  expect(etapes.raisonnement).not.toHaveBeenCalled();
  click('[data-modal-action="confirm"]');
  await flush();
  expect(etapes.raisonnement).toHaveBeenCalledExactlyOnceWith({ projectPath: '/exemple', raisonnement: 'analyse', action: { fait: true } });
});

it('intègre une pièce avec une tâche manuelle facultative et ouvre les anciennes versions', async () => {
  vi.mocked(etapes.piece).mockResolvedValue({ chemin: 'Pièces/exemple.txt' });
  vi.mocked(etapes.reprise).mockResolvedValue({ raisonnement: 'analyse-v2' });
  vi.mocked(etapes.ajouterTache).mockResolvedValue({} as never);
  const view = await tableau(carte({ etape: 'attente', raisonnement, historique: [{ nom: 'analyse-v0', documents: [{ nom: 'Ancien projet', type: 'Courrier', chemin: 'Projets/ancien.docx' }] }] }));
  view.ouvrirDossier('/exemple', 'analyse');
  click('[data-open-doc="0"][data-version="analyse-v0"]');
  await flush();
  expect(etapes.volet).toHaveBeenCalledWith('/exemple', 'files', '/exemple/Projets/ancien.docx');
  click('[data-integrate]');
  await flush();
  const auto = document.querySelector<HTMLInputElement>('[data-auto]')!;
  expect(auto.checked).toBe(true);
  auto.checked = false;
  const instructions = document.querySelector<HTMLTextAreaElement>('[data-instructions]')!;
  instructions.value = 'Comparer les versions';
  const file = document.querySelector<HTMLInputElement>('[data-piece]')!;
  Object.defineProperty(file, 'files', { value: [new File(['exemple'], 'exemple.txt')] });
  click('[data-modal-action="launch"]');
  await flush();
  expect(etapes.reprise).toHaveBeenCalledWith('/exemple', 'analyse');
  expect(etapes.ajouterTache).toHaveBeenCalledWith({ type: 'reprise', projectPath: '/exemple', raisonnement: 'analyse-v2', piece: 'Pièces/exemple.txt', provider: 'mistral', model: 'modele-exemple', instructions: 'Comparer les versions', auto: false });
});

it('reprend le code couleur des échéances du Matter board sur les cartes', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T12:00:00'));
  vi.mocked(loadBoard).mockResolvedValueOnce({ rev: '1', docs: {
    'projects/cabinet/matters/proche': { status: 'open', origin: 'page', nextStep: { text: 'Relancer' }, keyDates: [{ label: 'Audience exemple', date: '2026-11-06', kind: 'hearing' }] },
    'projects/cabinet/matters/lointaine': { status: 'open', origin: 'page', nextStep: { text: 'Relancer' }, keyDates: [{ label: 'Prescription exemple', date: '2026-12-20', kind: 'limitation' }] },
    'projects/cabinet/matters/calme': { status: 'open', origin: 'page', nextStep: { text: 'Relancer' }, keyDates: [{ label: 'Audience exemple', date: '2027-03-01', kind: 'hearing' }] },
  } });
  vi.mocked(etapes.tableau).mockResolvedValue({ cartes: [carte({ id: 'a', matter: 'proche', raisonnement }), carte({ id: 'b', matter: 'lointaine', raisonnement }), carte({ id: 'c', matter: 'calme', raisonnement })] });
  const view = createTableau(root, () => '/exemple');
  root.append(view.element, view.drawer);
  await view.refresh();
  const [proche, lointaine, calme] = [...root.querySelectorAll('.pme-card')];
  expect(proche.classList.contains('is-danger')).toBe(true);
  expect(proche.textContent).toContain('Audience dans 2 jours');
  expect(lointaine.classList.contains('is-flagged')).toBe(true);
  expect(lointaine.classList.contains('is-danger')).toBe(false);
  expect(calme.classList.contains('is-flagged')).toBe(false);
  vi.useRealTimers();
});

it('indique sur la carte l’état de l’anonymisation et de l’index pendant la préparation', async () => {
  await tableau(carte({ etape: 'preparation', preparation: [{ nom: 'conversion', texte: '', ok: true }, { nom: 'anonymisation', texte: '', ok: true }, { nom: 'mapping', texte: '', ok: true }, { nom: 'index', texte: '', ok: false }] }));
  const card = root.querySelector('.pme-card')!;
  expect(card.textContent).toContain('Anonymisation faite · Index à faire');
  expect(card.textContent).not.toContain('Aucun raisonnement');
  expect(card.querySelector('.pme-card-actions [data-launch="index"]')?.textContent).toBe('Lancer l’index');
});
