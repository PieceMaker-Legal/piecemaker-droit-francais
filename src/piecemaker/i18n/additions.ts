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
  fr:      { common: { tabs: { dossier: 'Dossier', library: 'Bibliothèque' } } },
  en:      { common: { tabs: { dossier: 'Case file', library: 'Library' } } },
  es:      { common: { tabs: { dossier: 'Expediente', library: 'Biblioteca' } } },
  it:      { common: { tabs: { dossier: 'Fascicolo', library: 'Biblioteca' } } },
  de:      { common: { tabs: { dossier: 'Dossier', library: 'Bibliothek' } } },
  tr:      { common: { tabs: { dossier: 'Dava dosyası', library: 'Kütüphane' } } },
  ru:      { common: { tabs: { dossier: 'Досье', library: 'Библиотека' } } },
  ja:      { common: { tabs: { dossier: '案件', library: 'ライブラリ' } } },
  ko:      { common: { tabs: { dossier: '사건', library: '라이브러리' } } },
  'zh-CN': { common: { tabs: { dossier: '案件', library: '资料库' } } },
  'zh-TW': { common: { tabs: { dossier: '案件', library: '資料庫' } } },
};
