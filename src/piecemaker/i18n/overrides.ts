/**
 * PieceMaker wording layer on top of the upstream CloudCLI translations.
 *
 * The bundles under `overrides/` hold only the keys whose wording differs — the workspace
 * entity is a legal case file, and the product is PieceMaker. They are merged over the
 * upstream resources after i18next is initialized, so `src/modules/i18n/locales` stays
 * untouched and upstream translation updates merge cleanly.
 *
 * Regenerate the bundles with `node scripts/piecemaker/generate-i18n-overrides.mjs`.
 */

import type { i18n as I18nInstance } from 'i18next';

import { PIECEMAKER_I18N_ADDITIONS } from './additions';

/** Language used when the user has never picked one; PieceMaker targets French practitioners. */
export const PIECEMAKER_DEFAULT_LANGUAGE = 'fr';

const overrideBundles = import.meta.glob<{ default: Record<string, unknown> }>(
  './overrides/*/*.json',
  { eager: true },
);

/** Merges every override bundle into the running i18next instance, replacing upstream values. */
export function applyPieceMakerI18nOverrides(i18n: I18nInstance): void {
  for (const [path, module] of Object.entries(overrideBundles)) {
    const match = /\/overrides\/([^/]+)\/([^/]+)\.json$/.exec(path);
    if (!match) continue;
    const [, language, namespace] = match;
    // deep: merge into the existing namespace; overwrite: our value wins over upstream's.
    i18n.addResourceBundle(language, namespace, module.default, true, true);
  }

  // Keys PieceMaker adds rather than rewrites; see additions.ts.
  for (const [language, namespaces] of Object.entries(PIECEMAKER_I18N_ADDITIONS)) {
    for (const [namespace, bundle] of Object.entries(namespaces)) {
      i18n.addResourceBundle(language, namespace, bundle, true, true);
    }
  }
}
