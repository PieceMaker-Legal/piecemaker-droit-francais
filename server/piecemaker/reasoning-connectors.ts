import { createRequire } from 'node:module';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { readHistory, readLegalPeriod } from '@/modules/piecemaker-reasoning/index.js';
import type { ReasoningConnectors } from '@/modules/piecemaker-reasoning/index.js';
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

export function createReasoningConnectors(): ReasoningConnectors {
  return {
    async law(id) {
      const raw = await legifranceText(id.startsWith('LEGIARTI') ? 'consulter_article' : 'consulter_decision', id.startsWith('LEGIARTI') ? { article_id: id } : { text_id: id });
      return { title: extractSourceTitle(raw) || id, text: extractFullText(raw), validity: readLegalPeriod(raw), history: readHistory(raw) };
    },
    async piece(cwd, reference) {
      const caseRoot = await realpath(cwd);
      const piece = await resolvePieceRef(cwd, reference) ?? path.resolve(cwd, reference);
      const canonical = await realpath(piece).catch(() => null);
      if (!canonical || !inside(caseRoot, canonical)) return null;
      const counterpart = path.extname(canonical).toLowerCase() === '.md' ? { exists: true, path: canonical } : markdownCounterpart(canonical, cwd);
      if (!counterpart?.exists || typeof counterpart.path !== 'string') return null;
      const markdown = await realpath(counterpart.path);
      if (!inside(caseRoot, markdown)) return null;
      return { title: formatPieceTitle(undefined, path.relative(caseRoot, canonical)), text: await readFile(markdown, 'utf8') };
    },
    match(text, excerpt) {
      if (verifyQuoteAgainstSource(text, excerpt).verified) return excerpt;
      return nearestPassage(text, excerpt);
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
