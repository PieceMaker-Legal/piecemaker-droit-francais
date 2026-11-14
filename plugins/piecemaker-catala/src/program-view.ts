import { reasoningGraph, type Reasoning } from './graph.js';

type File = { nom: string; chemin: string; contenu?: string };

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

function fileDocument(model: Reasoning, file: File) {
  const parts: string[] = [];
  let paragraph: string[] = [];
  let fence = '';
  let language = '';
  let start = 0;
  let code: string[] = [];
  const flush = () => { if (paragraph.length) parts.push(`<p>${escape(paragraph.join(' '))}</p>`); paragraph = []; };
  const block = (end: number) => {
    const rules = language === 'catala' ? model.steps.filter((step) => step.kind === 'rule' && step.origins.some((origin) => origin.selected && origin.role === 'definition' && origin.file === file.chemin && origin.line > start && origin.line < end)) : [];
    const graph = rules.length ? reasoningGraph(model, rules) : '';
    parts.push(`${graph ? `<div class="pmc-program-graph">${graph}</div>` : ''}<details class="pmc-program-code"><summary>Code ${escape(language || 'source')}</summary><pre><code>${escape(code.join('\n'))}</code></pre></details>`);
  };
  (file.contenu ?? '').split(/\r?\n/).forEach((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) { block(index + 1); fence = ''; code = []; }
      else code.push(line);
      return;
    }
    if (marker) { flush(); fence = marker[1]; language = marker[2].trim(); start = index + 1; return; }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) { flush(); const level = Math.min(6, heading[1].length + 1); parts.push(`<h${level}>${escape(heading[2])}</h${level}>`); return; }
    if (line.trim()) paragraph.push(line.trim()); else flush();
  });
  flush();
  return `<article class="pmc-program-file" data-file="${escape(file.nom)}">${parts.join('')}</article>`;
}

export function programDocument(model: Reasoning, files: File[]) {
  return files.filter((file) => /\.catala_(?:fr|en)$/.test(file.nom) && !/^test_/.test(file.nom)).map((file) => fileDocument(model, file)).join('');
}
