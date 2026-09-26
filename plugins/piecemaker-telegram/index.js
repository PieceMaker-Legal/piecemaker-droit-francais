const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const instances = new WeakMap();

export function mount(container, api) {
  const root = document.createElement('div');
  root.className = 'pm-telegram piecemaker-ui';
  root.dataset.theme = api.context.theme;
  root.innerHTML = `
    <style>
      .pm-telegram{--telegram-text:var(--piecemaker-text,#374151);--telegram-muted:var(--piecemaker-muted,#6b7280);--telegram-ink:var(--piecemaker-ink,#111827);--telegram-border:var(--piecemaker-border,#e5e7eb);height:100%;overflow:auto;background:hsl(var(--background,0 0% 100%));color:var(--telegram-text);font:14px/1.5 var(--piecemaker-font-ui,Inter,ui-sans-serif,system-ui,sans-serif)}
      .pm-telegram[data-theme=dark]{--telegram-text:hsl(var(--foreground,210 20% 96%));--telegram-muted:hsl(var(--muted-foreground,215 12% 65%));--telegram-ink:hsl(var(--foreground,210 20% 96%));--telegram-border:hsl(var(--border,222 12% 18%))}
      .pm-telegram *{box-sizing:border-box}.pm-telegram main{max-width:820px;margin:auto;padding:24px 24px 64px}
      .pm-telegram h1,.pm-telegram h2{font-family:var(--piecemaker-font-editorial,"EB Garamond",Georgia,serif);font-weight:500;color:var(--telegram-ink)}
      .pm-telegram h1{font-size:1.25rem;letter-spacing:-.02em;margin:0 0 6px}.pm-telegram h2{font-size:1.05rem;margin:0 0 10px}
      .pm-telegram p{margin:6px 0 12px}.pm-telegram .muted{color:var(--telegram-muted)}
      .pm-telegram .card{border:1px solid var(--telegram-border);border-radius:12px;padding:18px;margin-top:16px;background:hsl(var(--card,0 0% 100%))}
      .pm-telegram .row{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
      .pm-telegram .actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
      .pm-telegram button,.pm-telegram input,.pm-telegram select{font:inherit}
      .pm-telegram button{display:inline-flex;align-items:center;justify-content:center;min-height:1.75rem;border:1px solid var(--liquid-glass-border-subtle,var(--telegram-border));border-radius:9999px;padding:5px 12px;background:var(--liquid-glass-background-subtle,hsl(var(--card,0 0% 100%)));box-shadow:var(--liquid-glass-shadow-subtle,none);color:var(--telegram-text);font-size:12px;font-weight:500;white-space:nowrap;cursor:pointer;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px)}
      .pm-telegram button:hover{filter:brightness(.97)}.pm-telegram button:active{transform:scale(.98)}
      .pm-telegram button.primary{background:rgb(3 7 18 / 88%);border-color:transparent;box-shadow:none;color:#fff;backdrop-filter:none}
      .pm-telegram[data-theme=dark] button.primary{background:hsl(var(--foreground,210 20% 96%));color:hsl(var(--background,222 16% 8%))}
      .pm-telegram button:disabled{opacity:.4;cursor:not-allowed}.pm-telegram button.danger{color:#b91c1c}
      .pm-telegram input,.pm-telegram select{width:100%;padding:9px 12px;border:1px solid var(--telegram-border);border-radius:.75rem;background:hsl(var(--background,0 0% 100%));color:var(--telegram-text)}
      .pm-telegram button:focus-visible,.pm-telegram input:focus-visible,.pm-telegram select:focus-visible{outline:none;box-shadow:0 0 0 2px rgb(0 136 255 / 40%),0 0 0 4px hsl(var(--background,0 0% 100%))}
      .pm-telegram label{display:block;font-weight:600;font-size:12px;margin:12px 0 5px}
      .pm-telegram .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 14px}
      .pm-telegram .hint{font-size:12px;color:var(--telegram-muted)}
      .pm-telegram .notice{padding:10px 12px;border-radius:.75rem;margin-top:14px;background:color-mix(in srgb,var(--piecemaker-blue,rgb(0 136 255)) 10%,hsl(var(--card,0 0% 100%)))}
      .pm-telegram .error{background:color-mix(in srgb,#b91c1c 12%,hsl(var(--card,0 0% 100%)));color:#b91c1c}
      .pm-telegram a{color:var(--piecemaker-blue,rgb(0 136 255))}.pm-telegram .status{font-size:12px;font-weight:600}
      .pm-telegram .linked-bot{padding:12px 0;border-top:1px solid var(--telegram-border)}
      .pm-telegram .link-heading{margin-top:18px}
      @media(max-width:620px){.pm-telegram main{padding:16px 16px 48px}.pm-telegram .grid{grid-template-columns:1fr}}
    </style>
    <main><div class="row"><div><h1>Telegram</h1><p class="muted">Un bot principal suit vos sessions. Chaque dossier a son propre bot pour discuter avec Claude.</p></div><button data-action="refresh">Actualiser</button></div><div data-content>Chargement…</div></main>`;
  container.appendChild(root);
  const content = root.querySelector('[data-content]');
  const instance = { api, root, content, state: null, message: '', busy: false, selectedProject: api.context.project?.name || '' };
  instances.set(container, instance);
  instance.unsubscribe = api.onContextChange((context) => {
    root.dataset.theme = context.theme;
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
      ${linked.map((bot) => `<div class="row linked-bot"><div><strong>${escape(bot.projectName)}</strong> <span class="status">${bot.active ? '● Active' : '○ Arrêtée'}</span><div><a href="https://t.me/${escape(bot.username)}" target="_blank" rel="noreferrer">@${escape(bot.username)}</a></div></div><div class="actions"><button data-action="${bot.active ? 'restart' : 'start'}" data-id="${escape(bot.id)}" ${instance.busy || !state.installed ? 'disabled' : ''}>${bot.active ? 'Relancer' : 'Démarrer'}</button>${bot.active ? `<button data-action="stop" data-id="${escape(bot.id)}" ${instance.busy ? 'disabled' : ''}>Arrêter</button>` : ''}<button class="danger" data-action="remove" data-id="${escape(bot.id)}" ${instance.busy ? 'disabled' : ''}>Délier</button></div></div>`).join('')}
      ${available.length ? `<h2 class="link-heading">Lier un dossier</h2>${botForm('project', selected, available, instance.busy)}` : '<p class="hint">Tous les dossiers enregistrés ont un bot, ou aucun dossier n’est encore disponible.</p>'}
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
