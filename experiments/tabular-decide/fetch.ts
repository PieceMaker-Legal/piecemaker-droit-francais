import fs from 'node:fs';
import path from 'node:path';

import { discardResearch, researchPage, researchState, researchText, startResearch, waitForResearch } from '../../plugins/piecemaker-tabular-review/src/server/research.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const filters = JSON.parse(fs.readFileSync(path.join(here, 'search.json'), 'utf8'));
const limit = Number(process.env.LIMIT ?? 100);
const countOnly = process.env.COUNT_ONLY === '1';

const started = startResearch(filters);
if (countOnly) {
  for (;;) {
    const state = researchState(started.id);
    if (state.phase !== 'counting') {
      console.log(JSON.stringify({ phase: state.phase, total: state.total, counts: state.counts, error: state.error }));
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await discardResearch(started.id);
  process.exit(0);
}

await waitForResearch(started.id);
const state = researchState(started.id);
if (state.phase !== 'done') {
  console.error(JSON.stringify(state));
  await discardResearch(started.id).catch(() => undefined);
  process.exit(1);
}

const decisions = [];
for (let page = 1; ; page += 1) {
  const result = researchPage(started.id, page, 'kept');
  decisions.push(...result.items);
  if (page >= result.pageCount) break;
}

const corpus = path.join(here, 'corpus');
fs.rmSync(corpus, { recursive: true, force: true });
fs.mkdirSync(corpus, { recursive: true });
const selected = decisions.filter((decision) => !decision.error).slice(0, limit);
const index = selected.map((decision) => {
  const text = researchText(started.id, decision.id);
  const markdown = [`# ${decision.title}`, '', `Source : ${decision.link}`, '', text.retained, ''].join('\n');
  fs.writeFileSync(path.join(corpus, `${decision.id}.md`), markdown);
  return { id: decision.id, title: decision.title, link: decision.link, date: decision.date, importance: decision.importance, zone: text.zone, zoneOrigin: text.zoneOrigin ?? null, chars: markdown.length };
});
fs.writeFileSync(path.join(here, 'corpus.json'), `${JSON.stringify({ filters: state.filters, total: state.total, kept: state.kept, excluded: state.excluded, failed: state.failed, selected: index.length, decisions: index }, null, 2)}\n`);
await discardResearch(started.id);
console.log(JSON.stringify({ total: state.total, kept: state.kept, excluded: state.excluded, failed: state.failed, selected: index.length }));
