import type { Step } from './graph.js';

type File = { nom: string; chemin: string; contenu?: string };

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const same = (left: string, right: string) => left.replaceAll('\\', '/') === right.replaceAll('\\', '/');

const inline = (text: string, origin: string) => escape(text)
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label: string, target: string) => `<button type="button" class="pmc-reference" data-open-reference data-target="${target}" data-origin="${escape(origin)}" data-quote="">${label}</button>`)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/\*([^*]+)\*/g, '<em>$1</em>');

function prose(lines: string[], origin: string) {
  const parts: string[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];
  const flush = () => {
    if (paragraph.length) parts.push(`<p>${paragraph.map((line) => inline(line, origin)).join('<br>')}</p>`);
    if (items.length) parts.push(`<ul>${items.map((item) => `<li>${inline(item, origin)}</li>`).join('')}</ul>`);
    paragraph = [];
    items = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (!line || line.startsWith('>')) flush();
    else if (heading) { flush(); const level = Math.min(heading[1].length + 1, 6); parts.push(`<h${level}>${inline(heading[2].replace(/\s*\|\s*[A-Z]+\d+\s*$/, ''), origin)}</h${level}>`); }
    else if (item) { if (paragraph.length) flush(); items.push(item[1]); }
    else { if (items.length) flush(); paragraph.push(line); }
  }
  flush();
  return parts.join('');
}

function block(code: string[], start: number, file: File, language: string, steps: Step[], badge: (step: Step) => string) {
  const end = start + code.length + 1;
  const coded = steps.filter((step) => step.origins.some((origin) => origin.selected && origin.role !== 'declaration' && same(origin.file, file.chemin) && origin.line >= start && origin.line <= end));
  const titles = [...code.join('\n').matchAll(/titre:\s*([^\\\n"]+)/g)].map((match) => match[1].trim());
  const label = coded.length ? coded.map((step) => `<span>${escape(step.title)} ${badge(step)}</span>`).join('')
    : titles.length ? titles.map((title) => `<span>${escape(title)}</span>`).join('')
    : `<span>${language === 'catala-metadata' ? 'Déclarations' : 'Code'}</span>`;
  return `<details class="pmc-code-block"><summary><span class="pmc-kind">Catala</span>${label}</summary><pre>${escape(code.join('\n'))}</pre></details>`;
}

export function acteText(files: File[], steps: Step[], badge: (step: Step) => string) {
  const shown = files.filter((file) => /\.catala_[a-z]+$/.test(file.nom) && !/^test_/.test(file.nom) && file.contenu);
  if (!shown.length) return '<p class="pmc-muted">Aucun texte rédigé dans ce programme.</p>';
  return shown.map((file) => {
    const lines = file.contenu!.split(/\r?\n/);
    const parts: string[] = [];
    let text: string[] = [];
    for (let index = 0; index < lines.length; index++) {
      const fence = /^```\s*([\w-]*)\s*$/.exec(lines[index]);
      if (!fence) { text.push(lines[index]); continue; }
      parts.push(prose(text, file.chemin));
      text = [];
      const start = index + 1;
      const code: string[] = [];
      while (++index < lines.length && !/^```\s*$/.test(lines[index])) code.push(lines[index]);
      parts.push(block(code, start, file, fence[1], steps, badge));
    }
    parts.push(prose(text, file.chemin));
    return `<article class="pmc-acte-file">${parts.join('')}</article>`;
  }).join('');
}
