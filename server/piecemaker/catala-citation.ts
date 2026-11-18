import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { SourceConnectors } from '@/modules/piecemaker-suivi/index.js';

import { sourceContext } from '../../shared/piecemaker/catala-sources.js';

import type { createCitationStore } from './harness/citation-store.js';
import { locateSourcePassages } from './harness/source-passages.js';
import { LAWYER_ACTOR } from './okf/bundle.js';
import { expectedValue, matchesExpected, premiseEvidence } from './okf/premises.js';
import { scenarioFacts } from './vendor/skills/Skill-PieceMaker/scripts/catala-documentation.mjs';

type Validated = { token: string; title: string; verified: true; status: 'passed'; message: string; recours?: Array<{ id: string; date: string; juridiction: string }>; mention?: string };

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DECISION = /^(?:JURITEXT|CETATEXT|CONSTEXT)\d+$|^[0-9a-f]{24}$/i;
export function historyNeeded(id: string, title: string, now = new Date()) {
  if (!DECISION.test(id)) return false;
  const found = /(\d{1,2})(?:er)? (janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre) (\d{4})/i.exec(title);
  if (!found) return true;
  const limit = new Date(now);
  limit.setFullYear(limit.getFullYear() - 5);
  return new Date(Number(found[3]), MONTHS.indexOf(found[2].toLowerCase()), Number(found[1])) > limit;
}

export function createCatalaCitation(connectors: Pick<SourceConnectors, 'source' | 'match'>, store: ReturnType<typeof createCitationStore>) {
  const appeals = (details: string[] = []) => details.flatMap((line) => { const found = /^Recours (\S+) du (\S+) \((.*?)\)/.exec(line); return found ? [{ id: found[1], date: found[2], juridiction: found[3] }] : []; });
  const inspect = async (cwd: string, id: string, quote: string, content?: string) => {
    if (!/^(?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)\d+$/.test(id) && !/^[0-9a-f]{24}$/i.test(id) && !path.isAbsolute(id)) throw new Error('Source absente du programme Catala.');
    if (content !== undefined && quote && !content.includes(quote) && !sourceContext('https://catala.local/source.catala_fr', [{ nom: 'source.catala_fr', chemin: '/source.catala_fr', contenu: content }], true).text.replace(/^>\s?/gm, '').includes(quote)) throw new Error('Citation absente du programme Catala.');
    const info = await connectors.source(cwd, id);
    if (!info) throw new Error(path.isAbsolute(id) ? 'Pièce ou texte converti indisponible dans le dossier.' : 'Texte officiel indisponible.');
    const found = quote ? connectors.match(info.text, quote) : null;
    const verified = Boolean(found);
    const correction = found && found !== quote ? { avant: quote, apres: found } : undefined;
    const recours = appeals(info.history?.details);
    const quotes = quote ? [{ quote: found || quote, verification: { verified } }] : [];
    const source = info.validity ? `Validité : ${info.validity.from} → ${info.validity.to ?? 'en vigueur'}\n\n${info.text}` : info.text;
    const token = await store.save({ sessionId: `catala:${cwd}`, title: info.title, source, citation: { ref: 1, ...(info.kind === 'decision' ? { kind: 'case' as const, decision_id: id } : info.kind === 'piece' ? { kind: 'document' as const, doc_id: id } : { kind: 'article' as const, article_id: id }), verified, quotes }, ranges: locateSourcePassages(source, quotes) });
    return { token, title: info.title, verified, status: !quote ? 'missing' : verified ? 'passed' : 'failed', message: !quote ? 'Aucun extrait cité.' : verified ? 'Citation retrouvée dans la source.' : 'Citation non retrouvée dans la source.', ...(correction ? { correction } : {}), ...(recours.length ? { recours, mention: `Non rendue en dernier ressort, voir ${recours.map((entry) => `${entry.juridiction}, ${entry.date}`).join(' ; ')}` } : {}) };
  };
  const entries = (files: Array<{ nom: string; chemin: string; contenu: string }>) => files.flatMap((file) => {
    const found = new Map<string, { target: string; quote: string; origin: string; label: string; kind: string; values?: string[] }>();
    const contexts = [sourceContext(`https://catala.local/${encodeURIComponent(path.basename(file.nom))}`, [file], true), ...file.contenu.split('\n').map((_, index) => sourceContext(`https://catala.local/${encodeURIComponent(path.basename(file.nom))}#L${index + 1}`, [file]))];
    for (const context of contexts) for (const ref of context.references) if (['article', 'piece', 'jurisprudence', 'premise'].includes(ref.kind)) found.set(JSON.stringify([ref.target || ref.label, ref.quote]), ref);
    for (const fact of scenarioFacts(file.contenu, { test: /^test_/.test(path.basename(file.nom)) })) {
      if (!fact.source) continue;
      const key = JSON.stringify([fact.source, '']);
      const ref = found.get(key) ?? { label: fact.source, target: fact.source, kind: 'premise', origin: file.chemin, quote: '' };
      found.set(key, { ...ref, values: [...(ref.values ?? []), fact.value].filter(Boolean) });
    }
    const outside = file.contenu.replace(/(^#{1,6}\s+.*\|\s*(?:LEGIARTI|JORFARTI)\d{12}\b.*$)(?:\n(?!\s{0,3}(?:#{1,6}\s|`{3,}|~{3,})).*)*/gm, '$1');
    return [...found.values()].filter((ref) => ref.target || outside.includes(ref.label));
  });
  return {
    async cite(cwd: string, id: string, quote: string, content: string, parent?: string) {
      if (!content.includes(id)) {
        const history = parent && content.includes(parent) ? (await connectors.source(cwd, parent))?.history : undefined;
        if (!appeals(history?.details).some((entry) => entry.id === id)) throw new Error('Source absente du programme Catala.');
        return (await inspect(cwd, id, '')).token;
      }
      return (await inspect(cwd, id, quote, content)).token;
    },
    async verify(cwd: string, files: Array<{ nom: string; chemin: string; contenu: string }>) {
      const results = [];
      for (const ref of entries(files)) {
        try {
          if (!ref.target) { results.push({ ...ref, verified: false, status: 'missing', message: 'Lien de source absent.' }); continue; }
          if (ref.kind === 'premise') {
            const evidence = premiseEvidence(cwd, ref.target);
            if (!evidence) { results.push({ ...ref, verified: false, status: 'failed', message: 'Prémisse absente de l’index du dossier.' }); continue; }
            const pieces = [];
            for (const piece of evidence.pieces) {
              const id = path.join(cwd, piece.resource);
              const located = { target: encodeURI(path.relative(path.dirname(ref.origin), id).split(path.sep).join('/')), quote: piece.citation, id };
              try { pieces.push({ ...located, ...await inspect(cwd, id, piece.citation) }); } catch (error) { pieces.push({ ...located, title: piece.title, verified: false, status: 'failed', message: error instanceof Error ? error.message : String(error) }); }
            }
            const stated = evidence.pieces.map((piece) => piece.value).filter(Boolean);
            const differs = (ref.values ?? []).find((expression) => { const expected = expectedValue(expression); return expected && stated.length && !stated.some((value) => matchesExpected(expected, value)); });
            const verified = pieces.length > 0 && pieces.every((piece) => piece.verified) && !differs;
            const warning = evidence.pieces.some((piece) => piece.origin === LAWYER_ACTOR) ? `${ref.target} : lien posé par l’avocat, vérification manuelle requise.` : undefined;
            results.push({ ...ref, title: evidence.title, verified, status: verified ? 'passed' : pieces.length ? 'failed' : 'missing', message: differs ? `Valeur du scénario (${differs}) différente de la prémisse (${stated.join(' ; ')}).` : verified ? 'Prémisse établie par des pièces citées.' : pieces.length ? 'Citation non retrouvée dans une pièce de la prémisse.' : 'Prémisse sans pièce citée.', pieces, ...(warning ? { warning } : {}) });
            continue;
          }
          let id: string;
          if (/^https?:/i.test(ref.target)) {
            const url = new URL(ref.target);
            const legal = /^(?:www\.)?legifrance\.gouv\.fr$/.test(url.hostname) && url.pathname.match(/\/(LEGIARTI\d+|JORFARTI\d+|JURITEXT\d+|CETATEXT\d+|CONSTEXT\d+)(?:\/|$)/)?.[1];
            const judilibre = /^www\.courdecassation\.fr$/.test(url.hostname) && url.pathname.match(/^\/decision\/([0-9a-f]{24})\/?$/i)?.[1];
            const sourceId = legal || judilibre;
            if (!sourceId) { results.push({ ...ref, verified: false, status: 'missing', message: 'Source non prise en charge par le contrôle existant.' }); continue; }
            id = sourceId;
          } else {
            id = fileURLToPath(new URL(ref.target, pathToFileURL(ref.origin)));
            if (!id.startsWith(path.resolve(cwd) + path.sep)) throw new Error('Pièce hors du dossier.');
          }
          const file = files.find((file) => file.chemin === ref.origin)!;
          const known = path.isAbsolute(id) ? null : await store.validated<Validated>(id, ref.quote);
          if (known && !historyNeeded(id, known.title) && await store.read(known.token)) { results.push({ ...ref, id, ...known }); continue; }
          const inspected = await inspect(cwd, id, ref.quote, file.contenu);
          if (!path.isAbsolute(id) && inspected.verified && !inspected.correction) await store.remember(id, ref.quote, { ...inspected, verified: true, status: 'passed' });
          results.push({ ...ref, id, ...inspected });
        } catch (error) { results.push({ ...ref, verified: false, status: 'failed', message: error instanceof Error ? error.message : String(error) }); }
      }
      const passed = results.length > 0 && results.every((entry) => entry.verified);
      const warnings = results.flatMap((entry) => 'warning' in entry && entry.warning ? [entry.warning] : []);
      return { passed, status: passed ? 'passed' : results.some((entry) => entry.status === 'failed') ? 'failed' : 'missing', message: results.length ? `${results.filter((entry) => entry.verified).length}/${results.length} citation(s) vérifiée(s).` : 'Aucune citation déclarée.', results, warnings };
    },
  };
}
