import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { JSDOM } from 'jsdom';
import test from 'node:test';

test('login offers local recovery, saves only after success, and rejects mismatched passwords', async () => {
  const dom = new JSDOM('<body></body>', { url: 'http://localhost:3002/' });
  const calls = [];
  const { window } = dom;
  window.localStorage.setItem('auth-token', 'existing-token');
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')); };
  const context = createContext({
    require: () => ({ contextBridge: { exposeInMainWorld: (name, bridge) => { window[name] = bridge; } }, ipcRenderer: { invoke: async (_channel, action, input) => { calls.push({ action, input }); return { result: { saved: true } }; } } }),
    process: { isMainFrame: true }, window, document: window.document, location: window.location,
    localStorage: window.localStorage, MutationObserver: window.MutationObserver, HTMLFormElement: window.HTMLFormElement, setTimeout, clearTimeout,
  });
  runInContext(await fs.readFile(new URL('./preload.cjs', import.meta.url), 'utf8'), context);
  window.dispatchEvent(new window.Event('DOMContentLoaded'));
  window.document.body.innerHTML = '<form><input id="username" value="avocat"><input id="password" type="password" autocomplete="current-password" value="secret-fictif"><button>Connexion</button></form>';
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(window.document.querySelectorAll('[data-piecemaker-password]').length, 1);
  const form = window.document.querySelector('form');
  form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(calls.length, 0);
  window.dispatchEvent(new window.Event('auth-token-refreshed'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls[0].action, 'remember');
  const reset = [...form.querySelectorAll('button')].find(button => button.textContent.startsWith('Mot de passe oublié'));
  reset.click();
  const dialog = window.document.querySelector('dialog');
  assert.ok(dialog.open);
  const inputs = dialog.querySelectorAll('input');
  inputs[0].value = 'nouveau-secret';
  inputs[1].value = 'autre-secret';
  dialog.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  assert.match(dialog.textContent, /diffèrent/);
  assert.equal(calls.length, 1);
  inputs[1].value = inputs[0].value;
  dialog.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls[1].action, 'reset');
  dialog.close();
  assert.equal(inputs[0].value, '');
  dom.window.close();
});
