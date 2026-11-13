const { contextBridge, ipcRenderer } = require('electron');

if (process.isMainFrame && location.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  let pending = null;
  let pendingTimer;
  let saving = false;
  let savedNotice = '';
  let resetDialog;

  async function invoke(action, input) {
    const response = await ipcRenderer.invoke('piecemaker-password', action, input);
    if (response.error) throw new Error(response.error);
    return response.result;
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function publish(result) {
    if (!result?.token) return;
    localStorage.setItem('auth-token', result.token);
    location.reload();
  }

  function showReset() {
    if (resetDialog?.isConnected) { resetDialog.showModal(); return; }
    resetDialog = element('dialog', '', 'rounded-2xl border border-border bg-card p-6 text-foreground shadow-xl');
    resetDialog.setAttribute('aria-label', 'Réinitialiser le mot de passe');
    resetDialog.style.maxWidth = 'min(440px, 90vw)';
    const form = element('form', '', 'space-y-4');
    form.append(element('h2', 'Réinitialiser le mot de passe', 'text-lg font-medium'));
    form.append(element('p', 'Le système vérifiera votre identité. Les autres appareils seront déconnectés. Vos conversations et vos dossiers seront conservés.', 'text-sm text-muted-foreground'));
    const inputs = [];
    for (const [id, title] of [['piecemaker-new-password', 'Nouveau mot de passe'], ['piecemaker-confirm-password', 'Confirmez le mot de passe']]) {
      const label = element('label', title, 'block text-sm');
      label.htmlFor = id;
      const input = element('input', '', 'mt-2 block w-full rounded-lg border border-border bg-background px-3 py-2');
      input.id = id;
      input.type = 'password';
      input.autocomplete = 'new-password';
      input.minLength = 6;
      input.required = true;
      label.append(input);
      form.append(label);
      inputs.push(input);
    }
    const message = element('p', '', 'text-sm text-destructive');
    message.setAttribute('role', 'alert');
    const buttons = element('div', '', 'flex gap-3');
    const confirm = element('button', 'Vérifier mon identité et réinitialiser', 'rounded-full bg-primary px-4 py-2 text-sm text-primary-foreground');
    confirm.type = 'submit';
    const cancel = element('button', 'Annuler', 'rounded-full border border-border px-4 py-2 text-sm');
    cancel.type = 'button';
    cancel.onclick = () => resetDialog.close();
    buttons.append(confirm, cancel);
    form.append(message, buttons);
    form.onsubmit = async event => {
      event.preventDefault();
      if (inputs[0].value !== inputs[1].value) { message.textContent = 'Les mots de passe diffèrent.'; return; }
      confirm.disabled = true;
      cancel.disabled = true;
      message.textContent = 'Authentification système en cours…';
      try {
        const result = await invoke('reset', inputs[0].value);
        if (result.saved === false) {
          message.textContent = 'Mot de passe réinitialisé. Le système n’a pas pu l’enregistrer. Conservez votre nouveau mot de passe, puis connectez-vous.';
          inputs.forEach(input => { input.value = ''; });
          return;
        }
        publish(result);
      } catch (error) { message.textContent = error.message; }
      finally { confirm.disabled = false; cancel.disabled = false; }
    };
    resetDialog.onclose = () => { inputs.forEach(input => { input.value = ''; }); };
    resetDialog.append(form);
    document.body.append(resetDialog);
    resetDialog.showModal();
    inputs[0].focus();
  }

  contextBridge.exposeInMainWorld('piecemakerPasswords', { openReset: showReset });

  document.addEventListener('submit', event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.querySelector('#username') || !form.querySelector('#password')) return;
    pending = { username: form.querySelector('#username').value.trim(), password: form.querySelector('#password').value };
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => { pending = null; }, 30000);
  }, true);

  window.addEventListener('auth-token-refreshed', async () => {
    if (!pending || saving) return;
    saving = true;
    const credentials = pending;
    pending = null;
    clearTimeout(pendingTimer);
    try { await invoke('remember', credentials); }
    catch (error) { savedNotice = error.message; }
    finally { saving = false; credentials.password = ''; }
  });

  const attachControls = () => {
    const password = document.querySelector('input#password[autocomplete="current-password"]');
    const form = password?.closest('form');
    if (!form || form.querySelector('[data-piecemaker-password]')) return;
    const controls = element('div', '', 'space-y-2');
    controls.dataset.piecemakerPassword = 'true';
    const message = element('p', savedNotice || 'Après connexion, cet ordinateur enregistre le mot de passe avec la protection de macOS ou Windows.', 'text-xs text-muted-foreground');
    message.setAttribute('role', 'status');
    const saved = element('button', 'Utiliser le mot de passe enregistré', 'block text-sm text-primary');
    saved.type = 'button';
    saved.onclick = async () => {
      saved.disabled = true;
      try {
        const result = await invoke('login');
        if (result) publish(result);
        else message.textContent = 'Aucun mot de passe enregistré. Connectez-vous une première fois.';
      } catch (error) { message.textContent = error.message; }
      finally { saved.disabled = false; }
    };
    const reset = element('button', 'Mot de passe oublié ? Vérifier mon identité sur cet ordinateur', 'block text-sm text-primary');
    reset.type = 'button';
    reset.onclick = showReset;
    controls.append(saved, reset, message);
    form.append(controls);
  };
  const observer = new MutationObserver(attachControls);
  window.addEventListener('DOMContentLoaded', () => {
    observer.observe(document.body, { childList: true, subtree: true });
    attachControls();
    if (!localStorage.getItem('auth-token')) {
      void invoke('login').then(result => {
        if (!localStorage.getItem('auth-token') && !document.querySelector('input#password')?.value) publish(result);
      }).catch(() => {});
    }
  }, { once: true });
}
