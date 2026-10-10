import { knowledgeApi } from './api.js';
import type { LocalModelId, LocalModelStatus } from './api.js';
import { escapeHtml } from './views.js';

const LOCAL_MODEL_IDS: LocalModelId[] = ['gliner', 'mineru'];
const LOCAL_MODEL_DETAILS: Record<LocalModelId, { label: string; detail: string }> = {
  gliner: { label: 'GLiNER2-PII', detail: 'Repère les données personnelles pour l’anonymisation · environ 1,2 Go' },
  mineru: { label: 'MinerU', detail: 'Lit les PDF scannés et les images (OCR) · plusieurs Go' },
};
const PROMPTED_KEY = 'piecemaker:local-models-offered';
const INSTALL_POLL_INTERVAL_MS = 1500;

export function missingLocalModels(components: Partial<Record<LocalModelId, LocalModelStatus>>): LocalModelId[] {
  return LOCAL_MODEL_IDS.filter((id) => !components[id]?.installed);
}

function alreadyOffered(): boolean {
  try {
    if (sessionStorage.getItem(PROMPTED_KEY)) return true;
    sessionStorage.setItem(PROMPTED_KEY, '1');
  } catch {
    return false;
  }
  return false;
}

async function installLocalModel(component: LocalModelId, onProgress: (progress: string) => void): Promise<void> {
  let { job } = await knowledgeApi.installLocalModel(component);
  while (job.state === 'running') {
    onProgress(job.progress);
    await new Promise((resolve) => window.setTimeout(resolve, INSTALL_POLL_INTERVAL_MS));
    ({ job } = await knowledgeApi.localModelInstall(job.id));
  }
  if (job.state === 'failed') throw new Error(job.error || 'Installation interrompue.');
}

function offerMarkup(missing: LocalModelId[]): string {
  const items = missing.map((id) => `<div class="pmd-confirm-choice" data-model="${id}"><strong>${escapeHtml(LOCAL_MODEL_DETAILS[id].label)}</strong><small data-model-status>${escapeHtml(LOCAL_MODEL_DETAILS[id].detail)}</small></div>`).join('');
  return `
    <div class="pmd-confirm">
      <h2 class="pmd-title piecemaker-display">Installer les modèles locaux ?</h2>
      <p class="pmd-hint">Ces modèles tournent entièrement sur ce poste. Ils sont absents ; l’anonymisation et la lecture des pièces scannées en ont besoin. Vous pourrez aussi les gérer dans Paramètres › Modèles locaux.</p>
      <div class="pmd-confirm-choices">${items}</div>
      <p class="pmd-hint" data-install-error hidden></p>
      <div class="pmd-form-actions">
        <button type="button" class="pmd-button piecemaker-button piecemaker-button--glass piecemaker-button--sm" data-close>Plus tard</button>
        <button type="button" class="pmd-button pmd-button-primary piecemaker-button piecemaker-button--black piecemaker-button--sm" data-confirm>Installer</button>
      </div>
    </div>`;
}

export async function offerLocalModels(root: HTMLElement): Promise<void> {
  let missing: LocalModelId[];
  try {
    missing = missingLocalModels((await knowledgeApi.localModels()).components);
  } catch {
    return;
  }
  if (!missing.length || alreadyOffered()) return;
  const layer = document.createElement('div');
  layer.className = 'pmd-modal';
  layer.innerHTML = `<div class="pmd-dialog pmd-dialog-compact">${offerMarkup(missing)}</div>`;
  root.appendChild(layer);
  const close = layer.querySelector<HTMLButtonElement>('[data-close]');
  const confirm = layer.querySelector<HTMLButtonElement>('[data-confirm]');
  const errorLine = layer.querySelector<HTMLElement>('[data-install-error]');
  close?.addEventListener('click', () => layer.remove());
  confirm?.addEventListener('click', async () => {
    if (close) close.disabled = true;
    if (confirm) confirm.disabled = true;
    if (errorLine) errorLine.hidden = true;
    for (const id of [...missing]) {
      const status = layer.querySelector<HTMLElement>(`[data-model="${id}"] [data-model-status]`);
      try {
        await installLocalModel(id, (progress) => { if (status) status.textContent = progress; });
        if (status) status.textContent = 'Installé';
        missing = missing.filter((current) => current !== id);
      } catch (error) {
        if (status) status.textContent = 'Échec de l’installation';
        if (errorLine) {
          errorLine.textContent = error instanceof Error ? error.message : String(error);
          errorLine.hidden = false;
        }
      }
    }
    if (!missing.length) {
      layer.remove();
      return;
    }
    if (close) close.disabled = false;
    if (confirm) {
      confirm.disabled = false;
      confirm.textContent = 'Réessayer';
    }
  });
}
