import { errorMessage, escapeHtml as escape, openModal, toast } from '../../piecemaker-tabular-review/src/client/dom.js';
import type { SuiviDossier } from '../../../shared/piecemaker-suivi.js';
import { etapes, loadBoard, updateBoard } from './api.js';

type DateSuivi = { nom: string; id?: string; calcule?: boolean; label: string; date: string | null; fait: boolean; echeance: boolean; index: number; sources: string[] };
type DateBoard = { id: string; label?: string; date?: string; done?: boolean; kind?: string };

const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 16);

export function createDates(root: HTMLElement, ouvrirFiche: (matter: string) => void, refresh: () => Promise<void>) {
  const element = document.createElement('div');
  element.className = 'pme-dates';
  let dossiers: SuiviDossier[] = [];
  let lignes: DateSuivi[] = [];
  const matterOf = async (dossier: SuiviDossier) => `dossier-${await hash(dossier.fichier === 'suivi.json' ? dossier.projectPath : `${dossier.projectPath}\0${dossier.fichier}`)}`;
  const update = (next: SuiviDossier[]) => {
    dossiers = next;
    lignes = next.flatMap((dossier, index) => [
      ...dossier.snapshot.evenements.map((date) => ({ ...date, echeance: false, fait: true })),
      ...dossier.snapshot.echeances.map((date) => ({ ...date, echeance: true, fait: Boolean(date.fait) })),
    ].map((date) => ({ nom: date.nom, label: date.intitule, date: date.date, fait: date.fait, echeance: date.echeance, calcule: 'fixe' in date && !date.fixe && date.date !== null, index, sources: [...date.preuve.map((preuve) => `${preuve.piece} : ${preuve.citation}`), ...date.selon.map((source) => `${source.source} : ${source.citation}`)] })))
      .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    next.forEach((dossier, index) => {
      let dates: DateBoard[] = [];
      try { dates = JSON.parse(dossier.snapshot.code).matter?.keyDates ?? []; } catch { return; }
      if (!Array.isArray(dates)) return;
      for (const date of dates) if (date?.label && date.id) lignes.push({ nom: date.id, id: date.id, label: date.label, date: date.date ?? null, fait: Boolean(date.done), echeance: true, index, sources: ['Date saisie à la main : à justifier.'] });
    });
    lignes.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    element.innerHTML = lignes.length ? `<ul class="pme-dates-list">${lignes.map((ligne, index) => `<li data-date="${index}"><span class="pme-fiche-date">${escape(ligne.date || 'Date à établir')}</span><span class="pme-date-detail"><strong>${escape(ligne.label)}</strong><span class="pme-muted pme-small">${escape(dossiers[ligne.index].nom)}</span>${ligne.sources.map((source) => `<span class="pme-muted pme-small">${escape(source)}</span>`).join('')}</span><span class="pme-actions pme-date-actions">${ligne.echeance && ligne.date ? `<button type="button" class="pme-pill ${ligne.fait ? 'pme-pill--done' : 'pme-pill--todo'}" data-done>${ligne.fait ? 'Effectué' : 'À faire'}</button>` : ''}<button type="button" class="pme-link" data-dossier>Ouvrir le dossier</button><button type="button" class="pme-link" data-edit-date>Modifier</button></span></li>`).join('')}</ul>` : '<p class="pme-muted">Aucune date dans les suivis.</p>';
  };
  const enregistrer = async (ligne: DateSuivi, patch: Partial<DateBoard>) => {
    const path = `projects/cabinet/matters/${await matterOf(dossiers[ligne.index])}`;
    const id = ligne.id ?? `d-${await hash(ligne.nom)}`;
    const board = await loadBoard('');
    const fiche = board.docs?.[path] as { keyDates?: DateBoard[] } | undefined;
    if (!fiche) throw new Error('Fiche du suivi indisponible. Réessayez.');
    const dates = fiche.keyDates ?? [];
    const existante = dates.find((date) => date.id === id);
    const entree = { ...(existante ?? { id, label: ligne.label, ...(ligne.date ? { date: ligne.date } : {}), done: ligne.fait }), ...patch };
    await updateBoard(path, [...dates.filter((date) => date.id !== id), entree]);
  };
  const modifier = async (ligne: DateSuivi) => {
    let label = ligne.label;
    let date = ligne.date ?? '';
    const answer = await openModal(root, {
      title: 'Modifier la date du suivi',
      body: `<label class="ptr-field"><span class="ptr-label">Intitulé</span><input class="ptr-input" data-label value="${escape(label)}" required></label><label class="ptr-field"><span class="ptr-label">Date</span><input class="ptr-input" type="date" data-date-value value="${escape(date)}" ${ligne.calcule ? 'disabled' : 'required'}></label><p class="pme-muted">${ligne.calcule ? 'Date calculée : modifiez l’événement ou le délai dans le suivi du dossier.' : 'Les preuves et sources restent conservées. Le suivi revérifie la date enregistrée.'}</p>`,
      actions: [{ label: 'Annuler', value: 'cancel' }, ...(ligne.calcule ? [{ label: 'Ouvrir le suivi source', value: 'source' }] : []), { label: 'Enregistrer', value: 'save', kind: 'primary' }],
      onMount: (dialog) => dialog.addEventListener('input', () => {
        label = dialog.querySelector<HTMLInputElement>('[data-label]')!.value.trim();
        date = dialog.querySelector<HTMLInputElement>('[data-date-value]')!.value;
      }),
    });
    if (answer === 'source') {
      const dossier = dossiers[ligne.index];
      await etapes.volet(dossier.projectPath, 'files', `${dossier.projectPath}/.piecemaker/${dossier.fichier}`);
      return false;
    }
    if (answer !== 'save') return false;
    if (!label || !date) throw new Error('Indiquez l’intitulé et la date.');
    await enregistrer(ligne, { label, date });
    return true;
  };
  element.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    const ligne = lignes[Number(button?.closest<HTMLElement>('[data-date]')?.dataset.date)];
    if (!button || !ligne || button.disabled) return;
    button.disabled = true;
    const run = async () => {
      if ('dossier' in button.dataset) ouvrirFiche(await matterOf(dossiers[ligne.index]));
      else if ('done' in button.dataset) { await enregistrer(ligne, { done: !ligne.fait }); await refresh(); }
      else if (await modifier(ligne)) await refresh();
    };
    void run().catch((error: unknown) => toast(root, errorMessage(error), 'error')).finally(() => { button.disabled = false; });
  });
  return { element, update };
}
