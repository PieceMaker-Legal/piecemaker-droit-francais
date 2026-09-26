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
  fr:      { common: { tabs: { dossier: 'Dossier', library: 'Bibliothèque' } }, chat: { composer: { removeCommandPill: 'Retirer la commande {{name}}' } }, sidebar: { tooltips: { anonymizationComplete: 'Anonymisation effectuée' } }, settings: { mainTabs: { uninstall: 'Désinstaller' }, uninstall: { title: 'Désinstaller PieceMaker', action: 'Désinstaller PieceMaker', confirm: 'Confirmer la désinstallation', cancel: 'Annuler', hint: 'Retire l’application, les certificats, Node, Python, GLiNER, MinerU et toutes les données de PieceMaker (réglages, historique, facturation, journaux, caches). Seule la base auth.db est conservée. Vos dossiers restent sur cet ordinateur.', failed: 'La désinstallation n’a pas pu démarrer.' } } },
  en:      { common: { tabs: { dossier: 'Case file', library: 'Library' } }, chat: { composer: { removeCommandPill: 'Remove the {{name}} command' } }, sidebar: { tooltips: { anonymizationComplete: 'Anonymization complete' } }, settings: { mainTabs: { uninstall: 'Uninstall' }, uninstall: { title: 'Uninstall PieceMaker', action: 'Uninstall PieceMaker', confirm: 'Confirm uninstall', cancel: 'Cancel', hint: 'Removes the application, the certificates, Node, Python, GLiNER, MinerU and all PieceMaker data (settings, history, billing, logs, caches). Only the auth.db database is kept. Your case files stay on this computer.', failed: 'Uninstall could not start.' } } },
  es:      { common: { tabs: { dossier: 'Expediente', library: 'Biblioteca' } }, chat: { composer: { removeCommandPill: 'Quitar el comando {{name}}' } }, sidebar: { tooltips: { anonymizationComplete: 'Anonimización realizada' } } },
  it:      { common: { tabs: { dossier: 'Fascicolo', library: 'Biblioteca' } }, chat: { composer: { removeCommandPill: 'Rimuovi il comando {{name}}' } }, sidebar: { tooltips: { anonymizationComplete: 'Anonimizzazione completata' } } },
  de:      { common: { tabs: { dossier: 'Dossier', library: 'Bibliothek' } }, chat: { composer: { removeCommandPill: 'Befehl {{name}} entfernen' } }, sidebar: { tooltips: { anonymizationComplete: 'Anonymisierung abgeschlossen' } } },
  tr:      { common: { tabs: { dossier: 'Dava dosyası', library: 'Kütüphane' } }, chat: { composer: { removeCommandPill: '{{name}} komutunu kaldır' } }, sidebar: { tooltips: { anonymizationComplete: 'Anonimleştirme tamamlandı' } } },
  ru:      { common: { tabs: { dossier: 'Досье', library: 'Библиотека' } }, chat: { composer: { removeCommandPill: 'Удалить команду {{name}}' } }, sidebar: { tooltips: { anonymizationComplete: 'Анонимизация выполнена' } } },
  ja:      { common: { tabs: { dossier: '案件', library: 'ライブラリ' } }, chat: { composer: { removeCommandPill: '{{name}} コマンドを削除' } }, sidebar: { tooltips: { anonymizationComplete: '匿名化が完了しました' } } },
  ko:      { common: { tabs: { dossier: '사건', library: '라이브러리' } }, chat: { composer: { removeCommandPill: '{{name}} 명령 제거' } }, sidebar: { tooltips: { anonymizationComplete: '익명화 완료' } } },
  'zh-CN': { common: { tabs: { dossier: '案件', library: '资料库' } }, chat: { composer: { removeCommandPill: '移除 {{name}} 命令' } }, sidebar: { tooltips: { anonymizationComplete: '已完成匿名化' } } },
  'zh-TW': { common: { tabs: { dossier: '案件', library: '資料庫' } }, chat: { composer: { removeCommandPill: '移除 {{name}} 命令' } }, sidebar: { tooltips: { anonymizationComplete: '已完成匿名化' } } },
};
