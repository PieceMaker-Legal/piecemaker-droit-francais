/**
 * Translation keys PieceMaker adds on top of CloudCLI, as opposed to the wording
 * overrides under `overrides/`.
 *
 * Kept hand-written and separate on purpose: `scripts/piecemaker/generate-i18n-overrides.mjs`
 * rewrites `overrides/` wholesale from the upstream locales, so a key that has no upstream
 * counterpart could not survive there.
 *
 */

type AdditionBundles = Record<string, Record<string, Record<string, unknown>>>;

/** Case-file tab label, using each locale's term for a legal case file. */
export const PIECEMAKER_I18N_ADDITIONS: AdditionBundles = {
  fr:      { common: { tabs: { dossier: 'Dossier' } } },
  en:      { common: { tabs: { dossier: 'Case file' } } },
  es:      { common: { tabs: { dossier: 'Expediente' } } },
  it:      { common: { tabs: { dossier: 'Fascicolo' } } },
  de:      { common: { tabs: { dossier: 'Dossier' } } },
  tr:      { common: { tabs: { dossier: 'Dava dosyası' } } },
  ru:      { common: { tabs: { dossier: 'Досье' } } },
  ja:      { common: { tabs: { dossier: '案件' } } },
  ko:      { common: { tabs: { dossier: '사건' } } },
  'zh-CN': { common: { tabs: { dossier: '案件' } } },
  'zh-TW': { common: { tabs: { dossier: '案件' } } },
};
