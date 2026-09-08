const mounts = new WeakMap();

export function mount(container, api) {
  const root = document.createElement('div');
  root.className = 'pm-library';
  const style = document.createElement('style');
  style.textContent = `
    .pm-library{height:100%;overflow:auto;padding:24px;box-sizing:border-box;color:hsl(var(--foreground, 0 0% 12%));background:hsl(var(--background, 0 0% 100%));font:14px system-ui,sans-serif}
    .pm-library *{box-sizing:border-box}.pm-library h1{font-size:20px;margin:0 0 6px}.pm-library p{margin:4px 0;color:hsl(var(--muted-foreground, 0 0% 45%));line-height:1.5}
    .pm-library nav,.pm-library .toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:20px 0}
    .pm-library button{font:inherit;cursor:pointer;color:inherit;background:transparent;border:1px solid hsl(var(--border, 0 0% 87%));border-radius:6px;padding:7px 12px}
    .pm-library button:disabled{opacity:.45;cursor:default}.pm-library button[aria-selected=true]{background:hsl(var(--muted, 0 0% 93%));font-weight:600}
    .pm-library input[type=search]{font:inherit;color:inherit;background:transparent;border:1px solid hsl(var(--border, 0 0% 87%));border-radius:6px;padding:9px 12px;flex:1;min-width:160px}
    .pm-library .row{display:flex;align-items:center;gap:20px;border-bottom:1px solid hsl(var(--border, 0 0% 87%));padding:16px 0}
    .pm-library .title{display:block;border:0;text-align:left;padding:0;font-weight:600}.pm-library .details{flex:1;min-width:0}.pm-library .details p{white-space:pre-wrap;overflow-wrap:anywhere}
    .pm-library .switch{display:flex;align-items:center;gap:8px;font-size:12px;white-space:nowrap}.pm-library input[role=switch]{appearance:none;width:32px;height:18px;border-radius:12px;background:#aaa;position:relative;cursor:pointer;margin:0}
    .pm-library input[role=switch]:before{content:'';position:absolute;width:14px;height:14px;border-radius:50%;background:white;top:2px;left:2px}.pm-library input[role=switch]:checked{background:#5252cc}.pm-library input[role=switch]:checked:before{left:16px}
    .pm-library input:focus-visible,.pm-library button:focus-visible{outline:2px solid #6366f1;outline-offset:3px}.pm-library [role=alert]{color:#b91c1c;margin:12px 0}.pm-library .meta{font-size:12px}
    @media(max-width:600px){.pm-library{padding:16px}.pm-library .row{gap:12px;flex-wrap:wrap}}
  `;
  const layout = document.createElement('div');
  layout.style.cssText = 'display:flex;height:100%;min-width:0;overflow:hidden';
  root.style.cssText = 'flex:1;min-width:0';
  layout.append(root);
  container.append(style, layout);
  let context = api.context;
  let tab = 'skill';
  let scope = 'legal';
  let search = '';
  let entries = [];
  let snapshot = null;
  let marketplace = null;
  let loading = false;
  let busy = false;
  let error = '';
  let revision = 0;
  let disposed = false;

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
      if (tab === 'marketplace') {
        const data = await request('GET', `/plugin/marketplace?scope=${scope}`);
        if (version === revision) marketplace = data;
      } else if (tab === 'connectors') {
        const data = workspace ? await request('GET', `/activation${query}`) : null;
        if (version === revision) snapshot = data;
      } else {
        const data = await request('GET', `/catalog${query}`);
        if (version === revision) entries = data.entries;
      }
    } catch (cause) { if (version === revision) error = cause.message; }
    finally { if (version === revision && !disposed) { loading = false; render(); } }
  }

  async function mutate(method, path, body) {
    if (busy) return;
    busy = true;
    error = '';
    render();
    try { await request(method, path, body); await load(); }
    catch (cause) { error = cause.message; }
    finally { busy = false; if (!disposed) render(); }
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

  function toggle(label, checked, disabled, action) {
    const node = element('label', undefined, 'switch');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('role', 'switch');
    input.setAttribute('aria-label', label);
    input.checked = checked;
    input.disabled = disabled || busy;
    input.onchange = action;
    node.append(input, element('span', label));
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
    return `${item.name} ${item.description || ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase());
  }

  function render() {
    root.replaceChildren();
    root.append(element('h1', 'Bibliothèque'), element('p', 'Skills et agents privés, activés uniquement pour les dossiers choisis.'));
    const nav = element('nav');
    nav.setAttribute('role', 'tablist');
    nav.setAttribute('aria-label', 'Bibliothèque');
    for (const [key, label] of [['skill', 'Skills'], ['connectors', 'MCP & connecteurs'], ['agent', 'Agents'], ['marketplace', 'Marketplace']]) {
      const item = button(label, () => { tab = key; search = ''; void load(); });
      item.setAttribute('role', 'tab');
      item.setAttribute('aria-selected', String(tab === key));
      nav.append(item);
    }
    root.append(nav);
    const toolbar = element('div', undefined, 'toolbar');
    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Rechercher un titre ou une description…';
    input.setAttribute('aria-label', 'Rechercher dans la bibliothèque');
    input.value = search;
    input.oninput = () => { search = input.value; renderRows(); };
    toolbar.append(input, button('Actualiser', () => void load()));
    root.append(toolbar);
    if (error) { const notice = element('p', error); notice.setAttribute('role', 'alert'); root.append(notice); }
    const body = element('div');
    root.append(body);
    function renderRows() {
      body.replaceChildren();
      if (loading) { body.append(element('p', 'Chargement…')); return; }
      if (tab === 'skill' || tab === 'agent') {
        body.append(element('p', context.project ? `Activation automatique dans ${context.project.path}` : 'Sélectionnez un dossier pour activer un élément.', 'meta'));
        const visible = entries.filter((item) => item.kind === tab && matches(item));
        if (!visible.length) body.append(element('p', 'Aucun élément.'));
        for (const entry of visible) {
          const item = row(entry, () => void open(entry));
          item.append(toggle('Dans ce dossier', entry.enabled, !context.project, () => void mutate('PUT', `/catalog/${entry.id}/activation`, { workspacePath: context.project.path, enabled: !entry.enabled })));
          body.append(item);
        }
        body.append(element('p', 'Les changements s’appliquent aux prochains messages. Une désactivation ne retire pas les instructions déjà reçues dans une conversation.', 'meta'));
      } else if (tab === 'connectors') {
        if (!snapshot) { body.append(element('p', 'Sélectionnez un dossier pour gérer les MCP et connecteurs.')); return; }
        for (const [assistant, family, items] of [['claude', 'mcp', snapshot.claude.mcp], ['codex', 'mcp', snapshot.codex.mcp], ['claude', 'plugin', snapshot.claude.plugins]]) {
          for (const entry of items.filter(matches)) {
            const item = row(entry);
            item.append(toggle(`${assistant === 'claude' ? 'Claude' : 'Codex'} · ${family === 'mcp' ? 'MCP' : 'Connecteur'}`, entry.enabled, !entry.toggleable, () => void mutate('POST', '/activation/toggle', { workspacePath: context.project.path, assistant, family, id: entry.id, enabled: !entry.enabled })));
            body.append(item);
          }
        }
      } else {
        const scopes = element('div', undefined, 'toolbar');
        for (const [id, title] of [['legal', 'Legal'], ['official', 'Officiel Anthropic']]) {
          const item = button(title, () => { scope = id; void load(); });
          item.setAttribute('aria-selected', String(scope === id));
          scopes.append(item);
        }
        scopes.append(button('Découvrir / rafraîchir', () => void mutate('POST', '/plugin/marketplace/register', { scope })));
        body.append(scopes);
        if (marketplace?.reason) body.append(element('p', marketplace.reason));
        if (!marketplace?.registered) body.append(element('p', 'Ce catalogue doit être enregistré avec « Découvrir / rafraîchir ».'));
        for (const entry of (marketplace?.plugins || []).filter(matches)) {
          const item = row(entry);
          item.append(button(entry.installed ? 'Installé' : 'Ajouter à la bibliothèque', () => void mutate('POST', '/plugin/marketplace/acquire', { id: entry.id, scope })));
          item.lastChild.disabled = busy || entry.installed;
          body.append(item);
        }
      }
    }
    renderRows();
  }

  const unsubscribe = api.onContextChange((next) => {
    const changed = context.project?.path !== next.project?.path;
    context = next;
    if (changed) { entries = []; snapshot = null; void load(); }
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
