import { app, BrowserWindow, session } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { installUiUpdates } from '../../../desktop-bootstrap/overlay/electron-piecemaker/ui-updates/index.mjs';

const root = process.env.PIECEMAKER_UI_TEST_ROOT;
const phase = JSON.parse(process.env.PIECEMAKER_UI_TEST_PHASE);
app.setPath('userData', path.join(root, 'browser-profile'));

async function run() {
  let window;
  const errors = [];
  const logs = [];
  let timer;
  try {
    await app.whenReady();
    app.on('window-all-closed', () => {});
    session.defaultSession.webRequest.onBeforeRequest((request, callback) => {
      const url = new URL(request.url);
      callback({ cancel: ['http:', 'https:'].includes(url.protocol) && !['localhost', '127.0.0.1'].includes(url.hostname) });
    });
    class Controller {
      dataRoot = path.join(root, 'data');
      async resolveLocalServerUrl() { return process.env.PIECEMAKER_UI_TEST_ORIGIN; }
    }
    const packagedApp = new Proxy(app, {
      get(target, name) {
        if (name === 'isPackaged') return true;
        const value = Reflect.get(target, name);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await installUiUpdates({ app: packagedApp, session, LocalServerController: Controller, applicationRoot: root, log: (message) => logs.push(message) });
    const origin = await new Controller().resolveLocalServerUrl();
    window = new BrowserWindow({
      width: 1100, height: 760, show: phase.visible === true, title: 'PieceMaker — test local isolé',
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    window.webContents.on('console-message', (event) => {
      if (event.level === 'error' && !event.message.includes('ERR_BLOCKED_BY_CLIENT')) errors.push(event.message);
    });
    const stateFile = path.join(root, 'data/ui-updates', process.env.PIECEMAKER_UI_TEST_RUNTIME, 'state.json');
    timer = setTimeout(() => {
      console.error('Local integration phase timed out');
      app.exit(1);
    }, 65000);
    await window.loadURL(origin);
    let result;
    for (let attempt = 0; attempt < 230; attempt++) {
      const rendered = await window.webContents.executeJavaScript(`({
        build: document.documentElement.dataset.piecemakerUi,
        login: Boolean(document.querySelector('input[type="password"]')),
        origin: location.origin,
        session: localStorage.getItem('local-test-session'),
      })`);
      let state;
      try { state = JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch { state = {}; }
      const pendingSequence = state.pending ? JSON.parse(state.pending.payload).sequence : 0;
      const currentSequence = state.current ? JSON.parse(state.current.payload).sequence : 0;
      if (phase.forbidden === currentSequence && !state.trial) throw new Error('A crashing interface was incorrectly confirmed');
      if (rendered.build === phase.build && rendered.login && !state.trial
        && pendingSequence === phase.pending && currentSequence === phase.current
        && (!phase.log || logs.some((line) => line.includes(phase.log)))) {
        result = { ...rendered, pendingSequence, currentSequence, highest: state.highest || 0, logs, errors };
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!result) throw new Error(`Phase incomplete: ${JSON.stringify({ phase, logs, errors })}`);
    if (phase.seed) await window.webContents.executeJavaScript('localStorage.setItem("local-test-session", "preserved")');
    if (phase.visible) await new Promise((resolve) => setTimeout(resolve, 2000));
    await fs.writeFile(path.join(root, `${phase.name}.png`), (await window.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(root, `${phase.name}.json`), JSON.stringify(result, null, 2));
    console.log(`PASS ${phase.name}: UI=${result.build}, current=${result.currentSequence}, pending=${result.pendingSequence}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    window?.destroy();
    app.exit(process.exitCode || 0);
  }
}

void run();
