import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { ReasoningConnectors } from '@/modules/piecemaker-reasoning/index.js';

import { sourceContext } from '../../shared/piecemaker/catala-sources.js';

import type { createCitationStore } from './harness/citation-store.js';
import { locateSourcePassages } from './harness/source-passages.js';
import { premiseEvidence } from './okf/premises.js';

export function createCatalaCitation(connectors: Pick<ReasoningConnectors, 'source' | 'match'>, store: ReturnType<typeof createCitationStore>) {
  const inspect = async (cwd: string, id: string, quote: string, content?: string) => {
    if (!/^(?:LEGIARTI|JURITEXT|CETATEXT|CONSTEXT)\d+$/.test(id) && !/^[0-9a-f]{24}$/i.test(id) && !path.isAbsolute(id)) throw new Error('Source absente du programme Catala.');
    if (content !== undefined && quote && !content.includes(quote) && !sourceContext('https://catala.local/source.catala_fr', [{ nom: 'source.catala_fr', chemin: '/source.catala_fr', contenu: content }], true).text.replace(/^>\s?/gm, '').includes(quote)) throw new Error('Citation absente du programme Catala.');
    const info = await connectors.source(cwd, id);
    if (!info) throw new Error(path.isAbsolute(id) ? 'Pièce ou texte converti indisponible dans le dossier.' : 'Texte officiel indisponible.');
    const verified = Boolean(quote && connectors.match(info.text, quote));
    const quotes = quote ? [{ quote, verification: { verified } }] : [];
    const source = info.validity ? `Validité : ${info.validity.from} → ${info.validity.to ?? 'en vigueur'}\n\n${info.text}` : info.text;
    const token = await store.save({ sessionId: `catala:${cwd}`, title: info.title, source, citation: { ref: 1, ...(info.kind === 'decision' ? { kind: 'case' as const, decision_id: id } : info.kind === 'piece' ? { kind: 'document' as const, doc_id: id } : { kind: 'article' as const, article_id: id }), verified, quotes }, ranges: locateSourcePassages(source, quotes) });
    return { token, title: info.title, verified, status: !quote ? 'missing' : verified ? 'passed' : 'failed', message: !quote ? 'Aucun extrait cité.' : verified ? 'Citation retrouvée dans la source.' : 'Citation non retrouvée dans la source.' };
  };
  const entries = (files: Array<{ nom: string; chemin: string; contenu: string }>) => files.flatMap((file) => {
    const found = new Map<string, { target: string; quote: string; origin: string; label: string; kind: string; question?: string }>();
    const contexts = [sourceContext(`https://catala.local/${encodeURIComponent(path.basename(file.nom))}`, [file], true), ...file.contenu.split('\n').map((_, index) => sourceContext(`https://catala.local/${encodeURIComponent(path.basename(file.nom))}#L${index + 1}`, [file]))];
    for (const context of contexts) for (const ref of context.references) if (['article', 'piece', 'jurisprudence', 'premise'].includes(ref.kind)) found.set(JSON.stringify([ref.target || ref.label, ref.quote]), ref);
    return [...found.values()];
  });
  return {
    async cite(cwd: string, id: string, quote: string, content: string) {
      if (!content.includes(id)) throw new Error('Source absente du programme Catala.');
      return (await inspect(cwd, id, quote, content)).token;
    },
    async verify(cwd: string, files: Array<{ nom: string; chemin: string; contenu: string }>) {
      const results = [];
      for (const ref of entries(files)) {
        try {
          if (!ref.target) { results.push({ ...ref, verified: false, status: 'missing', message: 'Lien de source absent.' }); continue; }
          if (ref.kind === 'premise') {
            const evidence = premiseEvidence(cwd, ref.target);
            if (!evidence) { results.push({ ...ref, verified: false, status: ref.question ? 'missing' : 'failed', message: ref.question ? `Prémisse à établir : ${ref.question}` : 'Prémisse absente de l’index du dossier.' }); continue; }
            const pieces = [];
            for (const piece of evidence.pieces) {
              const id = path.join(cwd, piece.resource);
              const located = { target: encodeURI(path.relative(path.dirname(ref.origin), id).split(path.sep).join('/')), quote: piece.citation, id };
              try { pieces.push({ ...located, ...await inspect(cwd, id, piece.citation) }); } catch (error) { pieces.push({ ...located, title: piece.title, verified: false, status: 'failed', message: error instanceof Error ? error.message : String(error) }); }
            }
            const verified = pieces.length > 0 && pieces.every((piece) => piece.verified);
            results.push({ ...ref, title: evidence.title, verified, status: verified ? 'passed' : pieces.length ? 'failed' : 'missing', message: verified ? 'Prémisse établie par des pièces citées.' : pieces.length ? 'Citation non retrouvée dans une pièce de la prémisse.' : 'Prémisse sans pièce citée.', pieces });
            continue;
          }
          let id: string;
          if (/^https?:/i.test(ref.target)) {
            const url = new URL(ref.target);
            const legal = /^(?:www\.)?legifrance\.gouv\.fr$/.test(url.hostname) && url.pathname.match(/\/(LEGIARTI\d+|JURITEXT\d+|CETATEXT\d+|CONSTEXT\d+)(?:\/|$)/)?.[1];
            const judilibre = /^www\.courdecassation\.fr$/.test(url.hostname) && url.pathname.match(/^\/decision\/([0-9a-f]{24})\/?$/i)?.[1];
            const sourceId = legal || judilibre;
            if (!sourceId) { results.push({ ...ref, verified: false, status: 'missing', message: 'Source non prise en charge par le contrôle existant.' }); continue; }
            id = sourceId;
          } else {
            id = fileURLToPath(new URL(ref.target, pathToFileURL(ref.origin)));
            if (!id.startsWith(path.resolve(cwd) + path.sep)) throw new Error('Pièce hors du dossier.');
          }
          const file = files.find((file) => file.chemin === ref.origin)!;
          results.push({ ...ref, id, ...await inspect(cwd, id, ref.quote, file.contenu) });
        } catch (error) { results.push({ ...ref, verified: false, status: 'failed', message: error instanceof Error ? error.message : String(error) }); }
      }
      const passed = results.length > 0 && results.every((entry) => entry.verified);
      return { passed, status: passed ? 'passed' : results.some((entry) => entry.status === 'failed') ? 'failed' : 'missing', message: results.length ? `${results.filter((entry) => entry.verified).length}/${results.length} citation(s) vérifiée(s).` : 'Aucune citation déclarée.', results };
    },
  };
}
