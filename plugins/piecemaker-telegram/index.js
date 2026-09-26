const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const instances = new WeakMap();

export function mount(container, api) {
  const root = document.createElement('div');
  root.className = 'pm-telegram';
  root.innerHTML = `
    <style>
      .pm-telegram{height:100%;overflow:auto;background:var(--background,#fff);color:var(--foreground,#1c2430);font:14px/1.5 system-ui,sans-serif}
      .pm-telegram *{box-sizing:border-box}.pm-telegram main{max-width:820px;margin:auto;padding:28px 22px 64px}
      .pm-telegram h1{font-size:26px;margin:0 0 6px}.pm-telegram h2{font-size:17px;margin:0 0 10px}
      .pm-telegram p{margin:6px 0 12px}.pm-telegram .muted{color:var(--muted-foreground,#667085)}
      .pm-telegram .card{border:1px solid var(--border,#d9dee5);border-radius:10px;padding:18px;margin-top:16px;background:var(--card,#fff)}
      .pm-telegram .row{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
      .pm-telegram .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .pm-telegram button,.pm-telegram input,.pm-telegram select{font:inherit}
      .pm-telegram button{border:1px solid var(--border,#cad1d9);border-radius:7px;padding:8px 12px;background:var(--background,#fff);color:inherit;cursor:pointer}
      .pm-telegram button.primary{background:#2563eb;border-color:#2563eb;color:#fff}
      .pm-telegram button:disabled{opacity:.5;cursor:wait}.pm-telegram button.danger{color:#b42318}
      .pm-telegram input,.pm-telegram select{width:100%;padding:9px 10px;border:1px solid var(--border,#cad1d9);border-radius:7px;background:var(--background,#fff);color:inherit}
      .pm-telegram label{display:block;font-weight:600;font-size:12px;margin:12px 0 5px}
      .pm-telegram .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
      .pm-telegram .hint{font-size:12px;color:var(--muted-foreground,#667085)}
      .pm-telegram .notice{padding:10px 12px;border-radius:7px;margin-top:14px;background:color-mix(in srgb,#2563eb 10%,var(--background,#fff))}
      .pm-telegram .error{background:color-mix(in srgb,#b42318 12%,var(--background,#fff));color:#b42318}
      .pm-telegram a{color:#2563eb}.pm-telegram .status{font-size:12px;font-weight:600}
      @media(max-width:620px){.pm-telegram main{padding:20px 14px 48px}.pm-telegram .grid{grid-template-columns:1fr}}
    </style>
    <main><div class="row"><div><h1>Telegram</h1><p class="muted">Un bot principal suit vos sessions. Chaque dossier a son propre bot pour discuter avec Claude.</p></div><button data-action="refresh">Actualiser</button></div><div data-content>Chargement…</div></main>`;
  container.appendChild(root);
  const content = root.querySelector('[data-content]');
  const instance = { api, root, content, state: null, message: '', busy: false, selectedProject: api.context.project?.name || '' };
  instances.set(container, instance);
  instance.unsubscribe = api.onContextChange((context) => {
    if (!instance.selectedProject && context.project) instance.selectedProject = context.project.name;
  });
  root.addEventListener('submit', (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    event.preventDefault();
    const data = new FormData(form);
    const role = form.dataset.role;
    perform(instance, 'POST', '/bots', {
      role,
      projectId: role === 'project' ? data.get('projectId') : undefined,
      token: data.get('token'),
      ownerId: data.get('ownerId'),
    }, role === 'main' ? 'Bot principal enregistré.' : 'Bot lié au dossier.');
  });
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button || instance.busy) return;
    const action = button.dataset.action;
    if (action === 'install') perform(instance, 'POST', '/install', {}, 'Plugin Telegram installé dans la bibliothèque.');
    if (action === 'refresh') load(instance);
    if (action === 'start' || action === 'stop' || action === 'restart') {
      perform(instance, 'POST', `/sessions/${encodeURIComponent(button.dataset.id)}`, { action }, 'Session mise à jour.');
    }
    if (action === 'remove' && confirm('Retirer le lien avec ce bot Telegram ?')) {
      perform(instance, 'DELETE', `/bots/${encodeURIComponent(button.dataset.id)}`, undefined, 'Bot retiré.');
    }
  });
  load(instance);
}

export function unmount(container) {
  const instance = instances.get(container);
  instance?.unsubscribe?.();
  instance?.root.remove();
  instances.delete(container);
}

async function load(instance) {
  try {
    const result = await instance.api.rpc('GET', '/state');
    if (result.error) throw new Error(result.error);
    instance.state = result;
    render(instance);
  } catch (error) {
    instance.content.innerHTML = `<div class="notice error">${escape(error.message)}</div><button data-action="refresh">Réessayer</button>`;
  }
}

async function perform(instance, method, path, body, success) {
  instance.busy = true;
  render(instance);
  try {
    const result = await instance.api.rpc(method, path, body);
    if (result.error) throw new Error(result.error);
    instance.state = result;
    instance.message = success;
  } catch (error) {
    instance.message = `Erreur : ${error.message}`;
  } finally {
    instance.busy = false;
    render(instance);
  }
}

function render(instance) {
  const state = instance.state;
  if (!state) return;
  const main = state.bots.find((bot) => bot.id === 'main');
  const linked = state.bots.filter((bot) => bot.projectId);
  const available = state.projects.filter((project) => !linked.some((bot) => bot.projectId === project.id));
  const selected = available.some((project) => project.id === instance.selectedProject) ? instance.selectedProject : available[0]?.id;
  instance.content.innerHTML = `
    ${instance.message ? `<div class="notice ${instance.message.startsWith('Erreur') ? 'error' : ''}" role="status">${escape(instance.message)}</div>` : ''}
    <section class="card"><h2>Guide rapide</h2>
      <p>1. Installez le canal Telegram officiel dans la bibliothèque.</p>
      <p>2. Dans Telegram, créez un bot principal avec <a href="https://t.me/BotFather" target="_blank" rel="noreferrer">@BotFather</a> (<code>/newbot</code>). Créez ensuite un bot différent pour chaque dossier.</p>
      <p>3. Obtenez votre identifiant numérique auprès de <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer">@userinfobot</a>. Seul cet identifiant pourra écrire aux bots.</p>
      <p>4. Collez chaque jeton ci-dessous. Démarrez la session du dossier, puis ouvrez son bot dans Telegram et envoyez <code>/start</code>.</p>
      <p class="hint">Les jetons et les liens sont enregistrés dans auth.db. Le canal Claude utilise aussi des fichiers de fonctionnement dans ~/.claude/channels.</p>
    </section>
    <section class="card row"><div><h2>Plugin Telegram</h2><span class="status">${state.installed ? 'Installé dans la bibliothèque' : 'À installer'}</span></div>
      ${state.installed ? '' : `<button class="primary" data-action="install" ${instance.busy ? 'disabled' : ''}>Installer depuis la bibliothèque</button>`}
    </section>
    <section class="card"><div class="row"><div><h2>Bot principal</h2><p class="muted">Reçoit /status, /launch, /stop et /restart pour tous les dossiers liés.</p></div>${main ? `<span class="status">${state.mainOnline ? '● En ligne' : '○ Arrêté'}</span>` : ''}</div>
      ${main ? `<div class="row"><div><a href="https://t.me/${escape(main.username)}" target="_blank" rel="noreferrer">@${escape(main.username)}</a><div class="hint">Identifiant autorisé : ${escape(main.ownerId)}</div>${state.mainError ? `<div class="hint error">${escape(state.mainError)}</div>` : ''}</div><button class="danger" data-action="remove" data-id="main" ${instance.busy ? 'disabled' : ''}>Retirer</button></div>` : botForm('main', null, [], instance.busy)}
    </section>
    <section class="card"><h2>Un bot par dossier</h2><p class="muted">Chaque bot ouvre une session Claude dans le dossier associé. Le bot principal peut la relancer à distance.</p>
      ${linked.map((bot) => `<div class="row" style="padding:12px 0;border-top:1px solid var(--border,#d9dee5)"><div><strong>${escape(bot.projectName)}</strong> <span class="status">${bot.active ? '● Active' : '○ Arrêtée'}</span><div><a href="https://t.me/${escape(bot.username)}" target="_blank" rel="noreferrer">@${escape(bot.username)}</a></div></div><div class="actions"><button data-action="${bot.active ? 'restart' : 'start'}" data-id="${escape(bot.id)}" ${instance.busy || !state.installed ? 'disabled' : ''}>${bot.active ? 'Relancer' : 'Démarrer'}</button>${bot.active ? `<button data-action="stop" data-id="${escape(bot.id)}" ${instance.busy ? 'disabled' : ''}>Arrêter</button>` : ''}<button class="danger" data-action="remove" data-id="${escape(bot.id)}" ${instance.busy ? 'disabled' : ''}>Délier</button></div></div>`).join('')}
      ${available.length ? `<h2 style="margin-top:18px">Lier un dossier</h2>${botForm('project', selected, available, instance.busy)}` : '<p class="hint">Tous les dossiers enregistrés ont un bot, ou aucun dossier n’est encore disponible.</p>'}
    </section>`;
}

function botForm(role, selected, projects, busy) {
  return `<form data-role="${role}">
    ${role === 'project' ? `<label for="pm-tg-project">Dossier</label><select id="pm-tg-project" name="projectId">${projects.map((project) => `<option value="${escape(project.id)}" ${project.id === selected ? 'selected' : ''}>${escape(project.name)}</option>`).join('')}</select>` : ''}
    <div class="grid"><div><label for="pm-tg-token-${role}">Jeton donné par BotFather</label><input id="pm-tg-token-${role}" name="token" type="password" autocomplete="off" required placeholder="123456789:…"></div>
    <div><label for="pm-tg-owner-${role}">Votre identifiant Telegram</label><input id="pm-tg-owner-${role}" name="ownerId" inputmode="numeric" pattern="[0-9]+" required placeholder="Ex. 412587349"></div></div>
    <p class="hint">Le jeton n’est jamais réaffiché. Le bot refuse les messages des autres comptes.</p>
    <button class="primary" type="submit" ${busy ? 'disabled' : ''}>${role === 'main' ? 'Enregistrer le bot principal' : 'Lier ce bot au dossier'}</button>
  </form>`;
}
