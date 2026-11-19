import { RUNNABLE_PROVIDERS, type ProviderChoice, type Settings } from '../../../server/modules/piecemaker-orchestrateur/types.js';
import { loadModels, type ModelOption } from '../../piecemaker-tabular-review/src/client/host.js';
import { button, card, el, select, type Actions, type State } from './ui.js';

export function settingsPage(actions: Actions) {
  const page = el('div');
  const preferences = el('section');
  const memory = el('textarea');
  const revision = el('small');
  const files = el('section');
  const routines = el('section');
  let baseRevision = -1;
  let original = '';
  let state: State;
  let signature = '';
  const models = new Map<string, ModelOption[]>();
  const resetMemory = () => {
    original = memory.value = state.memory.text;
    baseRevision = state.memory.revision;
    revision.textContent = 'Révision ' + baseRevision;
  };
  const saveMemory = button('Enregistrer la mémoire', async () => {
    const text = memory.value;
    if (await actions.save('memory', {text, revision: baseRevision}, 'PUT')) {
      if (state.memory.text === text) {
        original = text;
        baseRevision = state.memory.revision;
        revision.textContent = 'Révision ' + baseRevision;
      }
    }
  });
  page.append(preferences, card('Mémoire', el('label', 'Mémoire du projet', memory), revision, saveMemory, button('Relire la mémoire enregistrée', resetMemory)),
    files, routines, button('Recycler l’orchestrateur', () => actions.save('recycle', {})));

  function form(snapshot: State) {
    const s = snapshot.settings;
    const connected = (p: string) => snapshot.providers.some(v => v.provider === p && v.authenticated);
    const providers = [{value: 'auto', label: 'Automatique'}, ...RUNNABLE_PROVIDERS.map(p => ({value: p, label: p, disabled: !connected(p)}))];
    const orch = select(providers, s.orchestratorProvider);
    const defaultProvider = select(providers, s.defaultProvider);
    const instructions = el('textarea');
    instructions.value = s.instructions;
    const folders = el('textarea');
    folders.value = s.folders.join('\n');
    const orchModel = el('select');
    const modelFields = new Map<string, HTMLSelectElement>();
    const limits = new Map<string, HTMLInputElement>();
    function fill(menu: HTMLSelectElement, provider: string, value: string) {
      const effective = provider === 'auto' ? RUNNABLE_PROVIDERS.find(connected) : provider;
      const options = models.get(effective ?? '') ?? [];
      menu.replaceChildren();
      if (menu === orchModel || !s.defaultModels[provider as keyof Settings['defaultModels']]) menu.add(new Option('Modèle du fournisseur', ''));
      for (const option of options) menu.add(new Option(option.label, option.value));
      if (value && !options.some(o => o.value === value)) menu.add(new Option(value, value));
      menu.value = value;
      menu.disabled = !effective || !connected(effective);
      menu.className = 'ptr-select';
    }
    function refreshModels() {
      fill(orchModel, orch.value, orchModel.value);
      for (const [p, menu] of modelFields) fill(menu, p, menu.value);
    }
    fill(orchModel, orch.value, s.orchestratorModel);
    orch.onchange = () => fill(orchModel, orch.value, '');
    const fields = el('form', card('Instructions permanentes', el('label', 'Instructions du projet', instructions)),
      card('Orchestrateur', el('label', 'Fournisseur', orch), el('label', 'Modèle', orchModel)),
      card('Fils', el('label', 'Fournisseur par défaut', defaultProvider)));
    for (const p of RUNNABLE_PROVIDERS) {
      const menu = el('select');
      fill(menu, p, s.defaultModels[p] ?? '');
      modelFields.set(p, menu);
      const limit = el('input');
      limit.type = 'number';
      limit.min = '1';
      limit.required = true;
      limit.disabled = !connected(p);
      limit.value = String(s.concurrency[p]);
      limits.set(p, limit);
      fields.append(card(p + (connected(p) ? '' : ' · Déconnecté'), el('label', 'Modèle par défaut', menu), el('label', 'Fils simultanés', limit)));
      if (connected(p) && !models.has(p)) void loadModels(p).then(result => {
        models.set(p, result.options);
        refreshModels();
      }).catch(error => fields.append(el('p', 'Modèles ' + p + ' · ' + String(error))));
    }
    const submit = el('button', 'Enregistrer les paramètres');
    submit.className = 'ptr-button';
    fields.append(card('Dossiers autorisés', el('label', 'Un chemin par ligne', folders)), submit);
    fields.oninput = () => { fields.dataset.dirty = 'true'; };
    fields.onsubmit = async event => {
      event.preventDefault();
      const patch: Partial<Omit<Settings, 'concurrency'>> & {concurrency?: Partial<Settings['concurrency']>} = {};
      if (instructions.value !== s.instructions) patch.instructions = instructions.value;
      if (orch.value !== s.orchestratorProvider) patch.orchestratorProvider = orch.value as ProviderChoice;
      if (orchModel.value !== s.orchestratorModel) patch.orchestratorModel = orchModel.value;
      if (defaultProvider.value !== s.defaultProvider) patch.defaultProvider = defaultProvider.value as ProviderChoice;
      if (folders.value !== s.folders.join('\n')) patch.folders = folders.value.split('\n').map(f => f.trim()).filter(Boolean);
      for (const p of RUNNABLE_PROVIDERS) {
        const model = modelFields.get(p)!.value;
        const limit = limits.get(p)!.valueAsNumber;
        if (model !== (s.defaultModels[p] ?? '') && model) (patch.defaultModels ??= {})[p] = model;
        if (limit !== s.concurrency[p]) (patch.concurrency ??= {})[p] = limit;
      }
      if (await actions.save('settings', patch, 'PUT')) {
        delete fields.dataset.dirty;
        signature = '';
        update(state);
      }
    };
    preferences.replaceChildren(fields);
  }

  function update(next: State) {
    state = next;
    const key = JSON.stringify([state.settings, state.providers]);
    if (signature !== key && !preferences.querySelector('[data-dirty]')) {
      signature = key;
      form(state);
    }
    if (baseRevision !== state.memory.revision) {
      if (memory.value === original) resetMemory();
      else revision.textContent = 'Révision ' + baseRevision + ' · Une nouvelle révision est disponible.';
    }
    files.replaceChildren(card('Fichiers partagés', ...state.files.map(name => button(name, () => actions.open({kind: 'file', ref: '.piecemaker/orchestrateur/fichiers/' + name}))),
      ...(state.files.length ? [] : ['Aucun fichier partagé.'])));
    routines.replaceChildren(card('Routines', ...state.schedules.map(s => el('p', [s.thread?.title, s.text, s.cron ?? s.at].filter(Boolean).join(' · '))),
      ...(state.schedules.length ? [] : ['Aucune routine.'])));
  }
  return {page, update};
}
