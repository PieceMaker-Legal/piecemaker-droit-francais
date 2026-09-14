const mounts = new WeakMap();
const skillScopes = new Set(['user', 'plugin', 'repo', 'project', 'admin', 'system']);

export function normalizeSkill(provider, skill = {}, project) {
  const scope = skillScopes.has(skill.scope) ? skill.scope : 'user';
  const normalized = {
    provider,
    name: String(skill.name ?? ''),
    description: String(skill.description ?? ''),
    command: String(skill.command ?? ''),
    scope,
    sourcePath: String(skill.sourcePath ?? ''),
  };
  if (typeof skill.pluginName === 'string') normalized.pluginName = skill.pluginName;
  if (typeof skill.pluginId === 'string') normalized.pluginId = skill.pluginId;
  if (scope === 'project' || scope === 'repo') {
    normalized.projectDisplayName = project?.displayName ?? skill.projectDisplayName;
    normalized.projectPath = project?.path ?? skill.projectPath;
  }
  return normalized;
}

export function mount(container, api) {
  const root = document.createElement('div');
  root.className = 'pm-library';
  const style = document.createElement('style');
  style.textContent = `
    .pm-library{height:100%;overflow:auto;padding:24px;box-sizing:border-box;color:hsl(var(--foreground, 0 0% 12%));background:hsl(var(--background, 0 0% 100%));font:14px system-ui,sans-serif}
    .pm-library *{box-sizing:border-box}.pm-library h1{font-size:20px;margin:0 0 6px}.pm-library h2{font-size:15px;margin:24px 0 4px}.pm-library p{margin:4px 0;color:hsl(var(--muted-foreground, 0 0% 45%));line-height:1.5}
    .pm-library nav,.pm-library .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:20px 0}.pm-library nav[role=tablist],.pm-library .pills{display:flex;width:max-content;flex-wrap:nowrap;gap:3px;padding:3px;border:1px solid hsl(var(--border, 0 0% 87%));border-radius:999px;background:hsl(var(--muted, 0 0% 93%));box-shadow:0 1px 3px rgba(0,0,0,.08);margin:12px 0 4px}
    .pm-library nav[role=tablist] button,.pm-library .pills button{border:0;border-radius:999px;padding:6px 12px}.pm-library nav[role=tablist] button[aria-selected=true],.pm-library .pills button[aria-selected=true]{background:hsl(var(--background, 0 0% 100%));box-shadow:0 1px 3px rgba(0,0,0,.12)}
    .pm-library button{font:inherit;cursor:pointer;color:inherit;background:transparent;border:1px solid hsl(var(--border, 0 0% 87%));border-radius:6px;padding:7px 12px}
    .pm-library button:disabled{opacity:.45;cursor:default}.pm-library button[aria-selected=true]{background:hsl(var(--muted, 0 0% 93%));font-weight:600}
    .pm-library input[type=search]{font:inherit;color:inherit;background:transparent;border:1px solid hsl(var(--border, 0 0% 87%));border-radius:6px;padding:9px 12px;flex:1;min-width:160px}
    .pm-library .row{display:flex;align-items:center;gap:20px;border-bottom:1px solid hsl(var(--border, 0 0% 87%));padding:16px 0}
    .pm-library .title{display:block;border:0;text-align:left;padding:0;font-weight:600}.pm-library .details{flex:1;min-width:0}.pm-library .details p{white-space:pre-wrap;overflow-wrap:anywhere}
    .pm-library .switch{display:flex;align-items:center;gap:8px;font-size:12px;white-space:nowrap}.pm-library input[role=switch]{appearance:none;width:32px;height:18px;border-radius:12px;background:#aaa;position:relative;cursor:pointer;margin:0}
    .pm-library input[role=switch]:before{content:'';position:absolute;width:14px;height:14px;border-radius:50%;background:white;top:2px;left:2px}.pm-library input[role=switch]:checked{background:#5252cc}.pm-library input[role=switch]:checked:before{left:16px}
    .pm-library input:focus-visible,.pm-library button:focus-visible{outline:2px solid #6366f1;outline-offset:3px}.pm-library [role=alert]{color:#b91c1c;margin:12px 0}.pm-library .meta{font-size:12px}
    .pm-library .tree{margin:0 0 12px 18px;padding:6px 0 6px 14px;border-left:1px solid hsl(var(--border, 0 0% 87%))}.pm-library .tree-row{display:flex;align-items:center;gap:8px;min-height:28px;font-size:12px}.pm-library .tree-row button{border:0;padding:3px 5px;text-align:left}.pm-library .tree-row .meta{margin-left:auto;padding-right:8px}
    .pm-library .entry-actions{position:relative}.pm-library .more{border:0;font-size:20px;line-height:1;padding:5px 8px}.pm-library .entry-menu{position:absolute;right:0;top:100%;z-index:10;min-width:120px;padding:4px;background:hsl(var(--background, 0 0% 100%));border:1px solid hsl(var(--border, 0 0% 87%));border-radius:7px;box-shadow:0 6px 18px rgba(0,0,0,.14)}.pm-library .entry-menu button{width:100%;border:0;text-align:left;color:#b91c1c}
    .pm-library .modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:50}
    .pm-library .modal{background:hsl(var(--background, 0 0% 100%));border:1px solid hsl(var(--border, 0 0% 87%));border-radius:8px;padding:20px;width:min(420px,90vw);display:flex;flex-direction:column;gap:10px}
    .pm-library .modal h2{margin:0 0 4px;font-size:16px}
    .pm-library .modal label{display:flex;flex-direction:column;gap:4px;font-size:13px;font-weight:600}
    .pm-library .modal input[type=text],.pm-library .modal textarea{font:inherit;color:inherit;background:transparent;border:1px solid hsl(var(--border, 0 0% 87%));border-radius:6px;padding:8px 10px}
    .pm-library .modal textarea{min-height:80px;resize:vertical}
    .pm-library .modal .toolbar{justify-content:flex-end;margin:6px 0 0}
    @media(max-width:600px){.pm-library{padding:16px}.pm-library .row{gap:12px;flex-wrap:wrap}}
  `;
  const layout = document.createElement('div');
  layout.style.cssText = 'display:flex;height:100%;min-width:0;overflow:hidden';
  root.style.cssText = 'flex:1;min-width:0';
  const content = document.createElement('div');
  const modalHost = document.createElement('div');
  root.append(content, modalHost);
  layout.append(root);
  container.append(style, layout);
  let context = api.context;
  let tab = 'skill';
  let view = 'mine';
  let scope = 'legal';
  let search = '';
  let entries = [];
  let plugins = [];
  const pluginTrees = new Map();
  let pluginTreeBusy = '';
  let snapshot = null;
  let marketplace = null;
  let loading = false;
  let busy = false;
  let error = '';
  let revision = 0;
  let disposed = false;
  let creating = null;
  let createBusy = false;
  let createError = '';
  let pinnedScrollTop = null;
  let openMenuId = '';

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function button(text, action) {
    const node = element('button', text);
    node.type = 'button';
    node.disabled = busy;
    node.onclick = action;
    return node;
  }

  async function request(method, path, body) {
    const result = await api.rpc(method, path, body);
    if (result?.error || result?.ok === false) throw new Error(result.error || result.reason || 'Opération impossible.');
    return result;
  }

  async function load() {
    const version = ++revision;
    loading = true;
    error = '';
    render();
    try {
      const workspace = context.project?.path;
      const query = workspace ? `?workspacePath=${encodeURIComponent(workspace)}` : '';
      if (view === 'discover') {
        const kind = tab === 'connectors' ? 'connector' : tab;
        const data = await request('GET', `/plugin/marketplace?scope=${scope}&kind=${kind}`);
        if (version === revision) marketplace = data;
      } else if (tab === 'connectors') {
        const data = workspace ? await request('GET', `/activation${query}`) : null;
        if (version === revision) snapshot = data;
      } else if (tab === 'plugin') {
        const collectionData = await request('GET', `/plugins${query}`);
        if (version === revision) plugins = collectionData.plugins || [];
      } else {
        const catalogData = await request('GET', `/catalog${query}`);
        if (version === revision) entries = catalogData.entries;
      }
    } catch (cause) { if (version === revision) error = cause.message; }
    finally { if (version === revision && !disposed) { loading = false; render(); } }
  }

  async function mutate(method, path, body) {
    if (busy) return;
    busy = true;
    error = '';
    pinnedScrollTop = root.scrollTop;
    render();
    try { await request(method, path, body); await load(); }
    catch (cause) { error = cause.message; }
    finally { busy = false; pinnedScrollTop = null; if (!disposed) render(); }
  }

  /**
   * "Dans ce dossier" switches: flip locally, re-render once, save in the
   * background. No loading/busy round trip and no catalog reload, so the
   * switch just stays where the user left it instead of flashing on every
   * click. Revert only if the save itself fails.
   */
  function toggleActivation(item, path, body) {
    const previous = item.enabled;
    item.enabled = !previous;
    render();
    request('PUT', path, body).catch((cause) => {
      item.enabled = previous;
      error = cause.message;
      if (!disposed) render();
    });
  }

  async function open(entry) {
    const version = revision;
    try {
      const document = await request('GET', `/catalog/${entry.id}`);
      if (disposed || version !== revision) return;
      let previousContent = document.content;
      const save = async (content) => {
        if (disposed) throw new Error('La Bibliothèque est fermée.');
        const updated = await request('PUT', `/catalog/${entry.id}`, { content, previousContent });
        previousContent = updated.content;
        await load();
      };
      window.dispatchEvent(new CustomEvent('piecemaker:library-document', { detail: { name: document.name, content: document.content, container: layout, save } }));
    } catch (cause) { error = cause.message; render(); }
  }

  async function openPluginFile(plugin, file) {
    const version = revision;
    try {
      const prefix = `/plugins/${encodeURIComponent(plugin.id)}/file`;
      const document = await request('GET', `${prefix}?path=${encodeURIComponent(file.path)}`);
      if (disposed || version !== revision) return;
      let previousContent = document.content;
      const save = async (content) => {
        if (disposed) throw new Error('La Bibliothèque est fermée.');
        await request('PUT', prefix, { path: file.path, content, previousContent });
        previousContent = content;
        await load();
      };
      window.dispatchEvent(new CustomEvent('piecemaker:library-document', { detail: { name: `${plugin.name}/${file.path}`, editorPath: file.path, content: document.content, container: layout, save } }));
    } catch (cause) { error = cause.message; render(); }
  }

  async function togglePluginTree(plugin) {
    if (pluginTrees.has(plugin.id)) {
      pluginTrees.delete(plugin.id);
      render();
      return;
    }
    pluginTreeBusy = plugin.id;
    error = '';
    pinnedScrollTop = root.scrollTop;
    render();
    try {
      const response = await request('GET', `/plugins/${encodeURIComponent(plugin.id)}/files`);
      pluginTrees.set(plugin.id, response.files || []);
    } catch (cause) { error = cause.message; }
    finally { pluginTreeBusy = ''; pinnedScrollTop = null; if (!disposed) render(); }
  }

  function openCreate(kind) {
    creating = { kind, name: '', description: '' };
    createError = '';
    render();
  }

  function closeCreate() {
    creating = null;
    createError = '';
    render();
  }

  async function submitCreate() {
    if (createBusy) return;
    if (!creating.name.trim()) { createError = 'Nom requis.'; render(); return; }
    createBusy = true;
    createError = '';
    render();
    try {
      await request('POST', '/catalog', { kind: creating.kind, name: creating.name, description: creating.description });
      creating = null;
      await load();
    } catch (cause) { createError = cause.message; }
    finally { createBusy = false; if (!disposed) render(); }
  }

  function toggle(label, checked, disabled, action, visibleLabel = true) {
    const node = element('label', undefined, 'switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', label);
    input.title = label;
    input.checked = checked;
    input.disabled = disabled || busy;
    input.onchange = action;
    node.append(input);
    if (visibleLabel) node.append(element('span', label));
    return node;
  }

  function row(item, action) {
    const node = element('div', undefined, 'row');
    const details = element('div', undefined, 'details');
    if (action) { const title = button(item.name, action); title.className = 'title'; details.append(title); }
    else details.append(element('strong', item.name));
    details.append(element('p', item.description || 'Aucune description.'));
    node.append(details);
    return node;
  }

  function matches(item) {
    return `${item.name} ${item.description || ''} ${item.provider || ''} ${item.scope || ''} ${item.command || ''} ${item.sourcePath || ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  }

  function pluralName() {
    return { connectors: 'connecteurs', skill: 'skills', plugin: 'plugins', agent: 'agents' }[tab];
  }

  function render() {
    const scrollTop = pinnedScrollTop !== null ? pinnedScrollTop : root.scrollTop;
    content.replaceChildren();
    content.append(element('h1', 'Bibliothèque'), element('p', 'Connecteurs, skills, plugins et agents activés pour les dossiers choisis.'));
    const nav = element('nav');
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Bibliothèque');
    for (const [key, label] of [['connectors', 'Connecteurs'], ['skill', 'Skills'], ['plugin', 'Plugins'], ['agent', 'Agents']]) {
      const item = button(label, () => { tab = key; view = 'mine'; scope = key === 'connectors' ? 'piecemaker' : 'legal'; search = ''; void load(); });
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', String(tab === key));
      nav.append(item);
    }
    content.append(nav);
    const views = element('div', undefined, 'pills');
    views.setAttribute('role', 'tablist');
    views.setAttribute('aria-label', `Vue des ${pluralName()}`);
    for (const [key, label] of [['mine', `Mes ${pluralName()}`], ['discover', 'Découvrir']]) {
      const item = button(label, () => { view = key; search = ''; void load(); });
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', String(view === key));
      views.append(item);
    }
    content.append(views);
    const toolbar = element('div', undefined, 'toolbar');
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Rechercher un titre ou une description…';
    input.setAttribute('aria-label', 'Rechercher dans la bibliothèque');
    input.value = search;
    input.oninput = () => { search = input.value; renderRows(); };
    toolbar.append(input, button('Actualiser', () => void load()));
    if (view === 'mine' && tab === 'skill') toolbar.append(button('Nouveau skill', () => openCreate('skill')));
    if (view === 'mine' && tab === 'agent') toolbar.append(button('Nouvel agent', () => openCreate('agent')));
    content.append(toolbar);
    if (error) { const notice = element('p', error); notice.setAttribute('role', 'alert'); content.append(notice); }
    const body = element('div');
    content.append(body);
    function renderRows() {
      body.replaceChildren();
      if (loading) { body.append(element('p', 'Chargement…')); return; }
      if (view === 'discover') {
        const scopes = element('div', undefined, 'pills');
        const availableScopes = tab === 'connectors'
          ? [['piecemaker', 'PieceMaker'], ['legal', 'Legal'], ['official', 'Officiel Anthropic']]
          : [['legal', 'Legal'], ['official', 'Officiel Anthropic']];
        if (!availableScopes.some(([id]) => id === scope)) scope = availableScopes[0][0];
        for (const [id, title] of availableScopes) {
          const item = button(title, () => { scope = id; void load(); });
          item.setAttribute('aria-selected', String(scope === id));
          scopes.append(item);
        }
        scopes.append(button(marketplace?.registered ? 'Rafraîchir le catalogue' : 'Enregistrer le catalogue', () => void mutate('POST', '/plugin/marketplace/register', { scope })));
        body.append(scopes);
        if (marketplace?.reason) body.append(element('p', marketplace.reason));
        if (!marketplace?.registered) body.append(element('p', 'Ce catalogue doit être enregistré avant de pouvoir installer ses éléments.'));
        const visible = (marketplace?.plugins || []).filter(matches);
        if (!visible.length) body.append(element('p', `Aucun ${pluralName()} dans ce catalogue.`));
        for (const entry of visible) {
          const item = row(entry);
          item.append(button(entry.installed ? 'Installé' : 'Ajouter', () => void mutate('POST', '/plugin/marketplace/acquire', { id: entry.id, scope })));
          item.lastChild.disabled = busy || entry.installed;
          body.append(item);
        }
      } else if (tab === 'skill' || tab === 'agent') {
        body.append(element('p', context.project ? `Activation automatique dans ${context.project.path}` : 'Sélectionnez un dossier pour activer un élément.', 'meta'));
        const visible = entries.filter((item) => item.kind === tab && matches(item));
        if (!visible.length) body.append(element('p', 'Aucun élément.'));
        for (const entry of visible) {
          const item = row(entry, () => void open(entry));
          const switchLabel = entry.enabled ? 'Retirer de ce dossier' : 'Installer dans ce dossier';
          item.append(toggle(switchLabel, entry.enabled, !context.project, () => toggleActivation(entry, `/catalog/${entry.id}/activation`, { workspacePath: context.project.path, enabled: !entry.enabled }), false));
          if (entry.kind === 'skill') {
            const actions = element('div', undefined, 'entry-actions');
            const more = button('⋮', (event) => {
              event.stopPropagation();
              openMenuId = openMenuId === entry.id ? '' : entry.id;
              render();
            });
            more.className = 'more';
            more.setAttribute('aria-label', `Actions pour ${entry.name}`);
            more.setAttribute('aria-expanded', String(openMenuId === entry.id));
            actions.append(more);
            if (openMenuId === entry.id) {
              const menu = element('div', undefined, 'entry-menu');
              menu.setAttribute('role', 'menu');
              const remove = button('Supprimer', () => { openMenuId = ''; void mutate('DELETE', `/catalog/${entry.id}`); });
              remove.setAttribute('role', 'menuitem');
              menu.append(remove);
              actions.append(menu);
            }
            item.append(actions);
          }
          body.append(item);
        }
        body.append(element('p', 'Les changements s’appliquent aux prochains messages. Une désactivation ne retire pas les instructions déjà reçues dans une conversation.', 'meta'));
      } else if (tab === 'plugin') {
        body.append(element('p', context.project ? `Activation automatique dans ${context.project.path}` : 'Sélectionnez un dossier pour activer un plugin.', 'meta'));
        body.append(element('h2', 'Plugins installés'));
        if (!plugins.length) body.append(element('p', 'Aucun plugin dans la bibliothèque.'));
        for (const plugin of plugins.filter(matches)) {
            const item = row(plugin);
            const actions = element('div', undefined, 'toolbar');
            actions.append(button(pluginTrees.has(plugin.id) ? 'Masquer l’arborescence' : pluginTreeBusy === plugin.id ? 'Chargement…' : 'Voir l’arborescence', () => void togglePluginTree(plugin)));
            item.append(actions, toggle(plugin.componentCount ? (plugin.partial ? 'Partiellement installé' : 'Dans ce dossier') : 'Aucun composant portable', plugin.enabled, !context.project || !plugin.componentCount, () => toggleActivation(plugin, `/plugins/${encodeURIComponent(plugin.id)}/activation`, { workspacePath: context.project.path, enabled: !plugin.enabled })));
            body.append(item);
            if (pluginTrees.has(plugin.id)) {
              const tree = element('div', undefined, 'tree');
              const files = pluginTrees.get(plugin.id);
              if (!files.length) tree.append(element('p', 'Aucun fichier éditable importé.', 'meta'));
              const directories = new Set();
              for (const file of files) {
                const parts = file.path.split('/');
                for (let index = 1; index < parts.length; index += 1) directories.add(parts.slice(0, index).join('/'));
              }
              const nodes = [
                ...[...directories].map((path) => ({ path, directory: true })),
                ...files.map((file) => ({ ...file, directory: false })),
              ].sort((left, right) => left.path.localeCompare(right.path));
              for (const node of nodes) {
                const treeRow = element('div', undefined, 'tree-row');
                treeRow.style.paddingLeft = `${Math.max(0, node.path.split('/').length - 1) * 14}px`;
                if (node.directory) treeRow.append(element('span', `▾ ${node.path.split('/').at(-1)}/`));
                else {
                  const fileButton = button(`└ ${node.path.split('/').at(-1)}`, () => void openPluginFile(plugin, node));
                  fileButton.disabled = busy || !node.editable;
                  treeRow.append(fileButton, element('span', node.editable ? `${node.size} octets` : 'lecture seule', 'meta'));
                }
                tree.append(treeRow);
              }
              body.append(tree);
            }
        }
      } else if (tab === 'connectors') {
        if (!snapshot) { body.append(element('p', 'Sélectionnez un dossier pour gérer les connecteurs.')); return; }
        for (const [assistant, items] of [['claude', snapshot.claude.mcp], ['codex', snapshot.codex.mcp]]) {
          for (const entry of items.filter(matches)) {
            const item = row(entry);
            item.append(toggle(`${assistant === 'claude' ? 'Claude' : 'Codex'} · ${entry.protocol || 'MCP'}`, entry.enabled, !entry.toggleable, () => void mutate('POST', '/activation/toggle', { workspacePath: context.project.path, assistant, family: entry.family || 'mcp', id: entry.id, enabled: !entry.enabled })));
            body.append(item);
          }
        }
      }
    }
    renderRows();
    renderModal();
    root.scrollTop = scrollTop;
  }

  function renderModal() {
    modalHost.replaceChildren();
    if (!creating) return;
    const backdrop = element('div', undefined, 'modal-backdrop');
    const modal = element('div', undefined, 'modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.append(element('h2', creating.kind === 'agent' ? 'Nouvel agent' : 'Nouveau skill'));
    const nameLabel = element('label', 'Nom');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = creating.name;
    nameInput.setAttribute('aria-label', 'Nom');
    nameInput.oninput = () => { creating.name = nameInput.value; };
    nameLabel.append(nameInput);
    const descLabel = element('label', 'Description');
    const descInput = document.createElement('textarea');
    descInput.value = creating.description;
    descInput.setAttribute('aria-label', 'Description');
    descInput.oninput = () => { creating.description = descInput.value; };
    descLabel.append(descInput);
    modal.append(nameLabel, descLabel);
    if (createError) { const notice = element('p', createError); notice.setAttribute('role', 'alert'); modal.append(notice); }
    const actions = element('div', undefined, 'toolbar');
    const cancelButton = button('Annuler', closeCreate);
    cancelButton.disabled = createBusy;
    const submitButton = button(createBusy ? 'Création…' : 'Créer', () => void submitCreate());
    submitButton.disabled = createBusy;
    actions.append(cancelButton, submitButton);
    modal.append(actions);
    backdrop.append(modal);
    backdrop.onclick = (event) => { if (event.target === backdrop) closeCreate(); };
    modalHost.append(backdrop);
    nameInput.focus();
  }

  const unsubscribe = api.onContextChange((next) => {
    const changed = context.project?.path !== next.project?.path;
    context = next;
    if (changed) { entries = []; plugins = []; pluginTrees.clear(); snapshot = null; void load(); }
    else render();
  });
  mounts.set(container, () => { disposed = true; revision++; unsubscribe(); layout.remove(); style.remove(); });
  void load();
}

export function unmount(container) {
  mounts.get(container)?.();
  mounts.delete(container);
  window.dispatchEvent(new CustomEvent('piecemaker:library-close'));
}
