import { escapeHtml, openModal } from '../../piecemaker-tabular-review/src/client/dom.js';
import { loadModels } from '../../piecemaker-tabular-review/src/client/host.js';
import type { ModelOption } from '../../piecemaker-tabular-review/src/client/host.js';
import { PROVIDERS } from '../../piecemaker-tabular-review/src/client/launch.js';
import { selectMenu } from '../../piecemaker-tabular-review/src/client/select-menu.js';
import { DEFAULT_PROVIDER, matchModel } from '../../piecemaker-tabular-review/src/shared.js';
import type { Provider } from '../../piecemaker-tabular-review/src/shared.js';

export type Lancement = { provider: Provider; model: string; instructions: string; auto: boolean; dialog: HTMLElement };

type Options = {
  titre: string;
  bouton?: string;
  consignes?: string;
  placeholder?: string;
  auto?: string;
  modele?: Partial<Record<Provider, string>>;
  avant?: string;
};

export async function lancer(root: HTMLElement, options: Options): Promise<Lancement | null> {
  let provider: Provider = DEFAULT_PROVIDER;
  let model = '';
  let models: { options: ModelOption[]; cheapest: string } = { options: [], cheapest: '' };
  let dialog: HTMLElement | null = null;

  const paintMenus = () => {
    const menus = dialog?.querySelector<HTMLElement>('[data-menus]');
    if (!menus) return;
    const options = models.options.map((option) => ({ ...option, label: option.value === models.cheapest ? `${option.label} (économique)` : option.label }));
    menus.innerHTML = `${selectMenu('IA', 'provider', provider, PROVIDERS)}${selectMenu('Modèle', 'model', model, options.length ? options : [{ value: '', label: 'Chargement…' }], !options.length)}`;
  };
  const loadProvider = async () => {
    const requested = provider;
    models = { options: [], cheapest: '' };
    model = '';
    paintMenus();
    const loaded = await loadModels(requested).catch(() => ({ options: [] as ModelOption[], cheapest: '' }));
    if (requested !== provider) return;
    models = loaded;
    model = matchModel(loaded.options, options.modele?.[provider], loaded.cheapest);
    paintMenus();
  };

  const answer = await openModal(root, {
    title: options.titre,
    body: `${options.avant ?? ''}
      <div class="ptr-field"><span class="ptr-label">Modèle</span><div class="pme-menus" data-menus></div></div>
      <label class="ptr-field"><span class="ptr-label">${escapeHtml(options.consignes ?? 'Consignes (facultatif)')}</span><textarea class="ptr-textarea" rows="4" data-instructions placeholder="${escapeHtml(options.placeholder ?? '')}"></textarea></label>
      <label class="ptr-check"><input type="checkbox" data-auto checked>${escapeHtml(options.auto ?? 'Lancer automatiquement, à son tour dans la file')}</label>`,
    actions: [{ label: 'Annuler', value: 'cancel' }, { label: options.bouton ?? 'Lancer', value: 'launch', kind: 'primary' }],
    onMount: (element) => {
      dialog = element;
      element.addEventListener('click', (event) => {
        const option = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-choice-option]');
        if (!option || option.disabled) return;
        if (option.dataset.choiceOption === 'provider') {
          provider = option.dataset.value as Provider;
          void loadProvider();
        } else {
          model = option.dataset.value ?? '';
          paintMenus();
        }
      });
      void loadProvider();
    },
  });
  if (answer !== 'launch' || !dialog) return null;
  const element: HTMLElement = dialog;
  return {
    provider,
    model,
    instructions: element.querySelector<HTMLTextAreaElement>('[data-instructions]')!.value.trim(),
    auto: element.querySelector<HTMLInputElement>('[data-auto]')!.checked,
    dialog: element,
  };
}
