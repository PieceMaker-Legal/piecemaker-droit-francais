import type { i18n } from 'i18next';
import { afterEach, expect, test, vi } from 'vitest';

import { applyPieceMakerI18nOverrides } from '@/piecemaker/i18n/overrides';

afterEach(() => vi.unstubAllGlobals());

test('Windows desktop distinguishes preparation from completed installation', () => {
  vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0 Electron/38.0.0' });
  const addResourceBundle = vi.fn();
  applyPieceMakerI18nOverrides({ addResourceBundle } as unknown as i18n);
  expect(addResourceBundle).toHaveBeenLastCalledWith('fr', 'common', {
    versionUpdate: {
      updateCompleted: 'Préparation de la mise à jour terminée.',
      restartServer: 'Suivez les indications de la fenêtre de mise à jour PieceMaker.',
    },
  }, true, true);
});

test('the browser does not receive the Windows desktop update wording', () => {
  vi.stubGlobal('navigator', { userAgent: 'Windows NT 10.0 Chrome/130.0.0' });
  const addResourceBundle = vi.fn();
  applyPieceMakerI18nOverrides({ addResourceBundle } as unknown as i18n);
  expect(addResourceBundle.mock.calls.some(([, , bundle]) =>
    bundle.versionUpdate?.updateCompleted === 'Préparation de la mise à jour terminée.',
  )).toBe(false);
});
