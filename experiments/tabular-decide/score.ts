import fs from 'node:fs';
import path from 'node:path';

import type { Cell } from '../../plugins/piecemaker-tabular-review/src/shared.js';
import { NOT_FOUND_SUMMARY } from '../../plugins/piecemaker-tabular-review/src/shared.js';
import { verifyCitation } from '../../plugins/piecemaker-tabular-review/src/server/citations.js';

type Column = { index: number; key: string; name: string; format: string; tags?: string[] };
type Decision = { id: string; link: string };
type Answer = { label: string | null; quotes: { quote: string; verified: boolean }[] };
type System = { name: string; seconds: number[]; wallSeconds: number; answers: Record<string, Record<string, Answer>>; extra: Record<string, unknown> };

const here = path.dirname(new URL(import.meta.url).pathname);
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(here, file), 'utf8'));
const columns = read('columns.json') as Column[];
const decisions = (read('corpus.json') as { decisions: Decision[] }).decisions;
const truth = read('truth.json') as Record<string, Record<string, string | null>>;
const RELEVANCE: Record<string, RegExp> = {
  solution: /\b(casse|rejette|irrecevable)\b/i,
  harcelement: /harc[eè]lement/i,
  securite: /sécurité|prévention/i,
  inaptitude: /inapt/i,
};

function lunaLabel(column: Column, cell: Cell | undefined): string | null {
  const summary = (cell?.summary ?? '').replace(/[*_]/g, '').trim();
  if (!summary || summary === NOT_FOUND_SUMMARY || /^non trouvé/i.test(summary)) return cell && column.key === 'inaptitude' ? 'Non' : null;
  if (column.format === 'yes_no') return /^oui/i.test(summary) ? 'Oui' : /^non/i.test(summary) ? 'Non' : null;
  const tags = (column.tags ?? []).filter((tag) => summary.toLowerCase().includes(tag.toLowerCase()));
  return tags.length ? tags.join(', ') : null;
}

function luna(): System {
  const data = read('results/luna.json') as { wallSeconds: number; rows: { id: string; seconds: number; corrections: number; error?: string; cells: Record<string, Cell> }[] };
  const answers: System['answers'] = {};
  for (const row of data.rows) {
    answers[row.id] = Object.fromEntries(columns.map((column) => {
      const cell = row.cells[String(column.index)];
      return [column.key, { label: lunaLabel(column, cell), quotes: (cell?.citations ?? []).map((citation) => ({ quote: citation.quote, verified: citation.verified })) }];
    }));
  }
  return {
    name: 'GPT-5.6 Luna',
    seconds: data.rows.map((row) => row.seconds),
    wallSeconds: data.wallSeconds,
    answers,
    extra: { errors: data.rows.filter((row) => row.error).length, rowsWithCorrections: data.rows.filter((row) => row.corrections > 0).length, corrections: data.rows.reduce((total, row) => total + row.corrections, 0) },
  };
}

function decide(): System {
  const data = read(`results/decide-${process.env.DECIDE ?? 'chunk384-b4'}.json`) as { load_seconds: number; threads: number; config: unknown; rows: { id: string; seconds: number; answer_seconds: number; answers: Record<string, { label: string; confidence: number }>; citations: Record<string, { quote: string } | null | undefined> }[] };
  const answers: System['answers'] = {};
  for (const row of data.rows) {
    const decision = decisions.find((entry) => entry.id === row.id)!;
    const text = fs.readFileSync(path.join(here, 'corpus', `${row.id}.md`), 'utf8');
    answers[row.id] = Object.fromEntries(columns.map((column) => {
      const citation = row.citations[column.key];
      const quotes = citation ? [{ quote: citation.quote, verified: verifyCitation([{ name: decision.link, text }], { document: decision.link, quote: citation.quote }).verified }] : [];
      return [column.key, { label: row.answers[column.key].label, quotes }];
    }));
  }
  const total = data.rows.reduce((sum, row) => sum + row.seconds, 0);
  return {
    name: 'GLiNER2.5-multi-Decide',
    seconds: data.rows.map((row) => row.seconds),
    wallSeconds: total,
    answers,
    extra: { loadSeconds: data.load_seconds, threads: data.threads, config: data.config, answerSeconds: data.rows.reduce((sum, row) => sum + row.answer_seconds, 0) },
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function score(system: System) {
  const perColumn = columns.map((column) => {
    let scored = 0;
    let correct = 0;
    let abstained = 0;
    let falsePositive = 0;
    let falseNegative = 0;
    let negatives = 0;
    let positives = 0;
    let answered = 0;
    let cited = 0;
    let verified = 0;
    let relevant = 0;
    const lengths: number[] = [];
    for (const decision of decisions) {
      const answer = system.answers[decision.id]?.[column.key];
      if (answer?.label) {
        answered += 1;
        if (answer.quotes.length) cited += 1;
        if (answer.quotes.length && answer.quotes.every((quote) => quote.verified)) verified += 1;
        if (answer.quotes.some((quote) => quote.verified && RELEVANCE[column.key].test(quote.quote))) relevant += 1;
        lengths.push(...answer.quotes.map((quote) => words(quote.quote)));
      }
      const expected = truth[decision.id]?.[column.key];
      if (!expected) continue;
      scored += 1;
      if (expected === 'Oui') positives += 1;
      if (expected === 'Non') negatives += 1;
      if (!answer?.label) {
        abstained += 1;
        continue;
      }
      if (answer.label.split(', ').includes(expected)) correct += 1;
      else if (answer.label === 'Oui') falsePositive += 1;
      else if (answer.label === 'Non') falseNegative += 1;
    }
    return { column: column.key, scored, correct, accuracy: correct / scored, abstained, falsePositive, negatives, falseNegative, positives, answered, cited, verified, relevant, medianQuoteWords: median(lengths) };
  });
  return {
    name: system.name,
    decisions: Object.keys(system.answers).length,
    wallSeconds: system.wallSeconds,
    sessionSeconds: system.seconds.reduce((sum, value) => sum + value, 0),
    medianSeconds: median(system.seconds),
    maxSeconds: Math.max(...system.seconds),
    extra: system.extra,
    columns: perColumn,
  };
}

function disagreements(systems: System[]) {
  return decisions.flatMap((decision) => columns.flatMap((column) => {
    const expected = truth[decision.id]?.[column.key];
    const labels = systems.map((system) => system.answers[decision.id]?.[column.key]?.label ?? null);
    return expected && labels.some((label) => !(label ?? '').split(', ').includes(expected)) ? [{ id: decision.id, column: column.key, expected, luna: labels[0], decide: labels[1] }] : [];
  }));
}

const systems = [luna(), decide()];
const report = { systems: systems.map(score), errors: disagreements(systems) };
fs.writeFileSync(path.join(here, 'results', `report-${process.env.DECIDE ?? 'chunk384-b4'}.json`), `${JSON.stringify(report, null, 2)}\n`);
for (const system of report.systems) {
  console.log(`\n${system.name} — ${system.decisions} décisions, ${system.wallSeconds.toFixed(0)} s au total, médiane ${system.medianSeconds.toFixed(1)} s, max ${system.maxSeconds.toFixed(1)} s`, JSON.stringify(system.extra));
  console.table(system.columns.map((column) => ({ ...column, accuracy: `${(column.accuracy * 100).toFixed(1)} %` })));
}
