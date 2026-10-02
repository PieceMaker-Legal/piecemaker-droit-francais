import fs from 'node:fs';
import path from 'node:path';

import type { Cell, Review, ReviewColumn } from '../../plugins/piecemaker-tabular-review/src/shared.js';
import { MAX_CITATION_CORRECTIONS } from '../../plugins/piecemaker-tabular-review/src/shared.js';
import { citationProblems, correctionPrompt, verifyCells } from '../../plugins/piecemaker-tabular-review/src/server/citations.js';
import { parseCells, reviewNote, systemPrompt, userPrompt } from '../../plugins/piecemaker-tabular-review/src/server/prompt.js';
import { openSession } from '../../plugins/piecemaker-tabular-review/src/server/sessions.js';

type Decision = { id: string; title: string; link: string };
type Row = { id: string; seconds: number; turns: number; corrections: number; error?: string; cells: Record<string, Cell> };

const here = path.dirname(new URL(import.meta.url).pathname);
const model = process.env.MODEL ?? 'gpt-5.6-luna';
const concurrency = Number(process.env.CONCURRENCY ?? 3);
const output = path.join(here, 'results', 'luna.json');
const columns = (JSON.parse(fs.readFileSync(path.join(here, 'columns.json'), 'utf8')) as (ReviewColumn & { key: string })[]);
const decisions = (JSON.parse(fs.readFileSync(path.join(here, 'corpus.json'), 'utf8')) as { decisions: Decision[] }).decisions;
const note = reviewNote({ category: 'recherche-juridique', research: { dispositifOnly: true } } as Pick<Review, 'category' | 'research'>);
const rows: Row[] = fs.existsSync(output) ? (JSON.parse(fs.readFileSync(output, 'utf8')) as { rows: Row[] }).rows.filter((row) => !row.error) : [];
const done = new Set(rows.map((row) => row.id));
const queue = decisions.filter((decision) => !done.has(decision.id));
const started = Date.now();

function save(): void {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify({ model, concurrency, wallSeconds: (Date.now() - started) / 1000, rows }, null, 2)}\n`);
}

async function analyse(decision: Decision): Promise<Row> {
  const text = fs.readFileSync(path.join(here, 'corpus', `${decision.id}.md`), 'utf8');
  const documents = [{ name: decision.link, text }];
  const controller = new AbortController();
  const session = openSession({ provider: 'codex', model, mode: 'inline', system: systemPrompt('inline'), readableDirectory: here, environment: process.env, signal: controller.signal });
  const begin = Date.now();
  let turns = 0;
  let corrections = 0;
  const cells = new Map<number, Cell>();
  try {
    turns += 1;
    const first = await session.send(userPrompt(decision.title, [{ name: decision.link, path: '', content: text }], columns, note));
    for (const [index, cell] of verifyCells(parseCells(first, columns, decision.link), documents)) cells.set(index, cell);
    for (let problems = citationProblems(cells, columns); problems.length && corrections < MAX_CITATION_CORRECTIONS; problems = citationProblems(cells, columns)) {
      corrections += 1;
      turns += 1;
      const answer = await session.send(correctionPrompt(problems, corrections, MAX_CITATION_CORRECTIONS));
      for (const [index, cell] of verifyCells(parseCells(answer, problems.map((problem) => problem.column), decision.link), documents)) cells.set(index, cell);
    }
    return { id: decision.id, seconds: (Date.now() - begin) / 1000, turns, corrections, cells: Object.fromEntries(cells) };
  } catch (error) {
    return { id: decision.id, seconds: (Date.now() - begin) / 1000, turns, corrections, error: error instanceof Error ? error.message : String(error), cells: Object.fromEntries(cells) };
  } finally {
    session.close();
  }
}

async function worker(): Promise<void> {
  for (let decision = queue.shift(); decision; decision = queue.shift()) {
    const row = await analyse(decision);
    rows.push(row);
    save();
    console.log(row.id, row.seconds.toFixed(1), row.corrections, row.error ?? Object.values(row.cells).map((cell) => cell.summary.slice(0, 30)).join(' | '));
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
save();
