import assert from 'node:assert/strict';
import test from 'node:test';

import { adoptShellEnvironment, extractMarkedEnvironment } from './shell-environment.js';

test('environnement extrait entre les repères malgré le bruit des fichiers de démarrage', () => {
  const output = 'Bienvenue {"faux": 1} abc123{"PATH":"/a:/b","LANG":"fr_FR.UTF-8"}abc123 fin';
  assert.deepEqual(extractMarkedEnvironment(output, 'abc123'), { PATH: '/a:/b', LANG: 'fr_FR.UTF-8' });
  assert.equal(extractMarkedEnvironment('aucun repère', 'abc123'), null);
  assert.equal(extractMarkedEnvironment('abc123{cassé}abc123', 'abc123'), null);
});

test("le PATH du shell passe devant, sans doublon ni perte d'une entrée de l'app", () => {
  const target: NodeJS.ProcessEnv = { PATH: '/opt/homebrew/bin:/usr/bin:/app/only' };
  adoptShellEnvironment(target, { PATH: '/Users/u/.local/bin:/opt/homebrew/bin:/usr/bin' });
  assert.equal(target.PATH, '/Users/u/.local/bin:/opt/homebrew/bin:/usr/bin:/app/only');
});

test("les variables fixées par l'app et les artefacts de session du shell ne sont jamais écrasés", () => {
  const target: NodeJS.ProcessEnv = { PATH: '/usr/bin', SERVER_PORT: '3101', ELECTRON_RUN_AS_NODE: '1' };
  adoptShellEnvironment(target, {
    PATH: '/usr/bin', SERVER_PORT: '9999', LANG: 'fr_FR.UTF-8', PWD: '/tmp', SHLVL: '2', _: '/bin/node',
    PIECEMAKER_RESOLVING_ENVIRONMENT: '1', DISABLE_AUTO_UPDATE: 'true', ZSH_TMUX_AUTOSTART: 'false',
  });
  assert.deepEqual(target, { PATH: '/usr/bin', SERVER_PORT: '3101', ELECTRON_RUN_AS_NODE: '1', LANG: 'fr_FR.UTF-8' });
});
