import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { readLegalPeriod } from '@/modules/piecemaker-reasoning/index.js';
import type { ReasoningConnectors, SourceInfo } from '@/modules/piecemaker-reasoning/index.js';
import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { legifranceText, searchBodacc } from './bodacc-search.js';
import { callTool } from './company-search.js';
import { resolvePieceRef } from './file-links.js';
import { formatPieceTitle } from './harness/piece-title.js';
import { nearestPassage } from './harness/source-passages.js';

const root = findApplicationRoot(getModuleDirectory(import.meta.url));
const require = createRequire(import.meta.url);
const vendor = path.join(root, 'server/piecemaker/vendor/piecemaker-plugin/scripts/lib');
const { extractFullText, extractSourceTitle } = require(path.join(root, 'server/piecemaker/harness/decisions.cjs'));
const { verifyQuoteAgainstSource } = require(path.join(vendor, 'verify-citations.cjs'));
const { markdownCounterpart } = require(path.join(vendor, 'protection.cjs'));

const notFound = (error: unknown) => {
  if (error instanceof Error && error.message.includes('aucun résultat')) return { found: false, status: '' };
  throw error;
};

const inside = (base: string, target: string) => target === base || target.startsWith(`${base}${path.sep}`);
const words = (value: string) => (value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');

const readHistory = (raw: string): SourceInfo['history'] | null => {
  const found = /^Historique: (remise en cause|à examiner|non remise en cause)\s*$/mu.exec(raw);
  if (!found) return null;
  const following = raw.slice(found.index + found[0].length).split('\n').map((line) => line.trim()).filter((line, index) => line || index > 0);
  const end = following.findIndex((line) => !line.startsWith('- '));
  const details = following.slice(0, end < 0 ? following.length : end).map((line) => line.slice(2));
  return { statut: found[1] as NonNullable<SourceInfo['history']>['statut'], details };
};

type Resolver = { accepts(id: string): boolean; resolve(cwd: string, id: string): Promise<SourceInfo | null> };

const legifrance: Resolver = {
  accepts: (id) => /^(LEGIARTI|JURITEXT|CETATEXT|CONSTEXT)\d+$/.test(id),
  async resolve(_cwd, id) {
    const article = id.startsWith('LEGIARTI');
    const raw = await legifranceText(article ? 'consulter_article' : 'consulter_decision', article ? { article_id: id } : { text_id: id });
    const text = extractFullText(raw);
    if (!text) return null;
    const validity = article ? readLegalPeriod(raw) : undefined;
    const history = article ? null : readHistory(raw);
    return { kind: article ? 'texte' : 'decision', title: extractSourceTitle(raw) || id, text, ...(validity ? { validity } : {}), ...(history ? { history } : {}) };
  },
};

const piece: Resolver = {
  accepts: (id) => /[/\\]/.test(id) || /\.[a-z0-9]{2,5}$/i.test(id),
  async resolve(cwd, reference) {
    const caseRoot = await realpath(cwd);
    const located = await resolvePieceRef(cwd, reference) ?? path.resolve(cwd, reference);
    const canonical = await realpath(located).catch(() => null);
    if (!canonical || !inside(caseRoot, canonical)) return null;
    const counterpart = path.extname(canonical).toLowerCase() === '.md' ? { exists: true, path: canonical } : markdownCounterpart(canonical, cwd);
    if (!counterpart?.exists || typeof counterpart.path !== 'string') return null;
    const markdown = await realpath(counterpart.path);
    if (!inside(caseRoot, markdown)) return null;
    return { kind: 'piece', title: formatPieceTitle(undefined, path.relative(caseRoot, canonical)), text: await readFile(markdown, 'utf8') };
  },
};

const RESOLVERS: Resolver[] = [legifrance, piece];

export function createReasoningConnectors(): ReasoningConnectors {
  return {
    async source(cwd, id) {
      const resolver = RESOLVERS.find((entry) => entry.accepts(id));
      return resolver ? resolver.resolve(cwd, id) : undefined;
    },
    match(text, excerpt) {
      if (verifyQuoteAgainstSource(text, excerpt).verified) return excerpt;
      const nearest = nearestPassage(text, excerpt);
      return nearest && words(nearest) === words(excerpt) ? nearest : null;
    },
    async registry({ siren, name }) {
      if (siren) {
        try {
          const record = await callTool('fiche_entreprise', { siren });
          return { found: true, status: /^#\s+.+\(([^()]*)\)\s*$/m.exec(record)?.[1]?.trim() ?? '' };
        } catch (error) { return notFound(error); }
      }
      if (!name) return { found: false, status: '' };
      try {
        const found = (await callTool('rechercher_entreprise', { query: name.slice(0, 200) })).split('\n').some((line) => /\|\s+SIREN\s+\d{9}\s+\|/.test(line));
        return { found, status: found ? 'trouvée par son nom, SIREN à confirmer' : '' };
      } catch (error) { return notFound(error); }
    },
    async bodacc(siren) {
      return (await searchBodacc(siren, '', null)).alertes;
    },
  };
}
