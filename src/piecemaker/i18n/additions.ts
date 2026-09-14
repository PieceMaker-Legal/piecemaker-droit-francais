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
  fr:      { common: { tabs: { dossier: 'Dossier', library: 'Bibliothèque' } }, chat: { composer: { removeCommandPill: 'Retirer la commande {{name}}' } } },
  en:      { common: { tabs: { dossier: 'Case file', library: 'Library' } }, chat: { composer: { removeCommandPill: 'Remove the {{name}} command' } } },
  es:      { common: { tabs: { dossier: 'Expediente', library: 'Biblioteca' } }, chat: { composer: { removeCommandPill: 'Quitar el comando {{name}}' } } },
  it:      { common: { tabs: { dossier: 'Fascicolo', library: 'Biblioteca' } }, chat: { composer: { removeCommandPill: 'Rimuovi il comando {{name}}' } } },
  de:      { common: { tabs: { dossier: 'Dossier', library: 'Bibliothek' } }, chat: { composer: { removeCommandPill: 'Befehl {{name}} entfernen' } } },
  tr:      { common: { tabs: { dossier: 'Dava dosyası', library: 'Kütüphane' } }, chat: { composer: { removeCommandPill: '{{name}} komutunu kaldır' } } },
  ru:      { common: { tabs: { dossier: 'Досье', library: 'Библиотека' } }, chat: { composer: { removeCommandPill: 'Удалить команду {{name}}' } } },
  ja:      { common: { tabs: { dossier: '案件', library: 'ライブラリ' } }, chat: { composer: { removeCommandPill: '{{name}} コマンドを削除' } } },
  ko:      { common: { tabs: { dossier: '사건', library: '라이브러리' } }, chat: { composer: { removeCommandPill: '{{name}} 명령 제거' } } },
  'zh-CN': { common: { tabs: { dossier: '案件', library: '资料库' } }, chat: { composer: { removeCommandPill: '移除 {{name}} 命令' } } },
  'zh-TW': { common: { tabs: { dossier: '案件', library: '資料庫' } }, chat: { composer: { removeCommandPill: '移除 {{name}} 命令' } } },
};
