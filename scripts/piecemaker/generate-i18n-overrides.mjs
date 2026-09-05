/**
 * Generates the PieceMaker i18n override bundles.
 *
 * Upstream CloudCLI locale files under `src/modules/i18n/locales` are never edited.
 * This script reads them, rewrites the wording PieceMaker needs (the workspace entity
 * is a legal case file, and the product is PieceMaker, not CloudCLI) and writes only
 * the leaf keys whose value actually changed into `src/piecemaker/i18n/overrides`.
 *
 * Re-run after pulling upstream translations:
 *   node scripts/piecemaker/generate-i18n-overrides.mjs
 */

import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LOCALES_DIR = join(ROOT, 'src/modules/i18n/locales');
const OUTPUT_DIR = join(ROOT, 'src/piecemaker/i18n/overrides');

/** Brand rename applied to every locale before the per-locale rules run. */
const BRAND_RULES = [
  ['CloudCLI', 'PieceMaker'],
  ['cloudcli', 'piecemaker'],
];

/** Leaf keys left untouched entirely: third-party names and literal commands. */
const FROZEN_KEYS = new Set([
  'settings:pluginSettings.prismCloudCLI.name',
  'settings:pluginSettings.prismCloudCLI.description',
  'common:versionUpdate.npmUpgradeCommand',
]);

/**
 * Namespaces that keep the upstream wording: in TaskMaster's copy "project" means a
 * software project (PRD, breaking work down, contributing upstream), not a case file.
 * The brand rename still applies to them.
 */
const WORDING_EXCLUDED_NAMESPACES = new Set(['tasks']);

/**
 * Per-locale replacements, applied in order, so longer inflected forms win over the
 * bare noun. Each entry is [search, replacement]; plain strings, replaced globally.
 */
const RULES = {
  en: [
    ['Projects', 'Cases'],
    ['projects', 'cases'],
    ['Project', 'Case'],
    ['project', 'case'],
  ],
  fr: [
    ['Projets', 'Dossiers'],
    ['projets', 'dossiers'],
    ['Projet', 'Dossier'],
    ['projet', 'dossier'],
  ],
  es: [
    ['Proyectos', 'Expedientes'],
    ['proyectos', 'expedientes'],
    ['Proyecto', 'Expediente'],
    ['proyecto', 'expediente'],
  ],
  it: [
    ['Progetti', 'Fascicoli'],
    ['progetti', 'fascicoli'],
    ['Progetto', 'Fascicolo'],
    ['progetto', 'fascicolo'],
  ],
  de: [
    // "das Dossier" is neuter like "das Projekt", so articles and adjectives stay correct.
    ['Auf allen Projekten', 'In allen Dossiers'],
    ['Projekten', 'Dossiers'],
    ['Projektes', 'Dossiers'],
    ['Projekts', 'Dossiers'],
    ['Projekte', 'Dossiers'],
    ['Projekt', 'Dossier'],
    ['projekten', 'dossiers'],
    ['projekte', 'dossiers'],
    ['projekts', 'dossiers'],
    ['projekt', 'dossier'],
  ],
  tr: [
    ['Projelerde', 'Davalarda'],
    ['Projelerin', 'Davaların'],
    ['Projelere', 'Davalara'],
    ['Projeleri', 'Davaları'],
    ['Projeler', 'Davalar'],
    ['Projeyi', 'Davayı'],
    ['Projeye', 'Davaya'],
    ['Projeni', 'Davanı'],
    ['Projede', 'Davada'],
    ['Projen', 'Davan'],
    ['Proje', 'Dava'],
    ['projelerde', 'davalarda'],
    ['projelerin', 'davaların'],
    ['projelere', 'davalara'],
    ['projeleri', 'davaları'],
    ['projeler', 'davalar'],
    ['projeyi', 'davayı'],
    ['projeye', 'davaya'],
    ['projeni', 'davanı'],
    ['projede', 'davada'],
    ['projen', 'davan'],
    ['proje', 'dava'],
  ],
  ru: [
    // "досье" is an indeclinable neuter noun, so agreeing words are fixed explicitly.
    ['проект просканирован', 'досье просканировано'],
    ['проекта просканировано', 'досье просканировано'],
    ['проектов просканировано', 'досье просканировано'],
    ['Проект будет убран', 'Досье будет убрано'],
    ['Новый проект', 'Новое досье'],
    ['новый проект', 'новое досье'],
    ['Этот проект', 'Это досье'],
    ['этот проект', 'это досье'],
    ['Каждый проект', 'Каждое досье'],
    ['каждый проект', 'каждое досье'],
    ['Проекты не найдены', 'Досье не найдены'],
    ['Проектами', 'Досье'],
    ['Проектах', 'Досье'],
    ['Проектам', 'Досье'],
    ['Проектов', 'Досье'],
    ['Проектом', 'Досье'],
    ['Проекты', 'Досье'],
    ['Проекта', 'Досье'],
    ['Проекте', 'Досье'],
    ['Проекту', 'Досье'],
    ['Проект', 'Досье'],
    ['проектами', 'досье'],
    ['проектах', 'досье'],
    ['проектам', 'досье'],
    ['проектов', 'досье'],
    ['проектом', 'досье'],
    ['проекты', 'досье'],
    ['проекта', 'досье'],
    ['проекте', 'досье'],
    ['проекту', 'досье'],
    ['проект', 'досье'],
  ],
  ja: [['プロジェクト', '案件']],
  ko: [
    // 사건 ends in a consonant, so the object/subject/topic particles change with it.
    ['프로젝트를', '사건을'],
    ['프로젝트가', '사건이'],
    ['프로젝트는', '사건은'],
    ['프로젝트와', '사건과'],
    ['프로젝트', '사건'],
  ],
  'zh-CN': [['项目', '案件']],
  // zh-TW uses 專案 for the workspace; 項目 there means "item" and is left alone.
  'zh-TW': [['專案', '案件']],
};

/** Phrases repaired after the noun swap, where the substituted word needs a different frame. */
const POST_RULES = {
  fr: [
    ['dans un répertoire de dossier', "dans le répertoire d'un dossier"],
    ['dans votre répertoire de dossier', 'dans le répertoire de votre dossier'],
    ['répertoire de dossier', 'répertoire du dossier'],
  ],
  ru: [['Досье не найдены', 'Досье не найдено']],
};

/** Longest search string first, so inflected forms are consumed before the bare noun. */
const orderRules = rules => [...rules].sort((a, b) => b[0].length - a[0].length);

/**
 * i18next interpolation placeholders are identifiers, not prose: `{{projectName}}` must
 * survive untouched, so replacement only runs on the text between them.
 */
const applyRules = (value, rules) =>
  value
    .split(/(\{\{[^}]*\}\})/)
    .map((part, index) =>
      index % 2 === 1 ? part : rules.reduce((text, [from, to]) => text.split(from).join(to), part),
    )
    .join('');

/** Walks the upstream bundle and collects the leaf keys whose rewritten value differs. */
const collectOverrides = (source, locale, namespace, path = []) => {
  const result = {};
  for (const [key, value] of Object.entries(source)) {
    const keyPath = [...path, key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = collectOverrides(value, locale, namespace, keyPath);
      if (Object.keys(nested).length > 0) result[key] = nested;
      continue;
    }
    if (typeof value !== 'string') continue;
    if (FROZEN_KEYS.has(`${namespace}:${keyPath.join('.')}`)) continue;
    let rewritten = applyRules(value, BRAND_RULES);
    if (!WORDING_EXCLUDED_NAMESPACES.has(namespace)) {
      rewritten = applyRules(rewritten, orderRules(RULES[locale]));
      rewritten = applyRules(rewritten, POST_RULES[locale] ?? []);
    }
    if (rewritten !== value) result[key] = rewritten;
  }
  return result;
};

rmSync(OUTPUT_DIR, { recursive: true, force: true });

let total = 0;
for (const locale of readdirSync(LOCALES_DIR)) {
  if (!RULES[locale]) throw new Error(`No PieceMaker wording rules for locale "${locale}"`);
  mkdirSync(join(OUTPUT_DIR, locale), { recursive: true });
  for (const file of readdirSync(join(LOCALES_DIR, locale))) {
    if (!file.endsWith('.json')) continue;
    const namespace = file.replace(/\.json$/, '');
    const source = JSON.parse(readFileSync(join(LOCALES_DIR, locale, file), 'utf8'));
    const overrides = collectOverrides(source, locale, namespace);
    const count = JSON.stringify(overrides).match(/"[^"]*":\s*"/g)?.length ?? 0;
    total += count;
    writeFileSync(join(OUTPUT_DIR, locale, file), `${JSON.stringify(overrides, null, 2)}\n`);
    console.log(`${locale}/${file}: ${count} overridden strings`);
  }
}
console.log(`\n${total} overridden strings written to src/piecemaker/i18n/overrides`);
