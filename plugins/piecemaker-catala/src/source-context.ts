export function sourceContext(source: string, files: Array<{ nom: string; chemin: string; contenu?: string }>, wholeDocument = false) {
  let location: URL;
  try { location = new URL(source); } catch { return { text: '', references: [] }; }
  let filename = '';
  try { filename = decodeURIComponent(location.pathname).split('/').pop() ?? ''; } catch { return { text: '', references: [] }; }
  const matches = files.filter((file) => file.nom.split('/').pop() === filename);
  const file = matches.length === 1 ? matches[0] : undefined;
  const line = Number(location.hash.match(/^#L(\d+)/)?.[1]);
  if (!file?.contenu || (!line && !wholeDocument)) return { text: '', references: [] };
  const lines = file.contenu.split(/\r?\n/);
  const sections = [{ level: 0, lines: [] as string[] }];
  let catala = false;
  let fence = '';
  for (let index = 0; index < (wholeDocument ? lines.length : Math.min(line, lines.length)); index++) {
    const marker = lines[index].match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (marker) {
      if (fence && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) { fence = ''; catala = false; }
      else if (!fence) { fence = marker[1]; catala = /^catala\b|^catala-/.test(marker[2].trim()); }
    } else if (!fence) {
      const heading = lines[index].match(/^(#{1,6})\s+/);
      if (heading && !wholeDocument) {
        while (sections.at(-1)!.level >= heading[1].length) sections.pop();
        sections.push({ level: heading[1].length, lines: [] });
      }
      sections.at(-1)!.lines.push(lines[index]);
    }
  }
  if (!catala && !wholeDocument) return { text: '', references: [] };
  const text = sections.map((section) => section.lines.join('\n').trim()).filter(Boolean).join('\n\n');
  const references: Array<{ label: string; target: string; kind: string }> = [];
  const add = (label: string, target: string, kind?: string) => {
    const category = kind ?? (/\bjurisprudence\b|\barrêt\b|\/(?:juri|ceta)\/id\//i.test(label + ' ' + target) ? 'jurisprudence' : /^pièce\b|\.(?:pdf|docx?)(?:[?#]|$)/i.test(label + ' ' + target) ? 'piece' : /legifrance\.gouv\.fr|\barticle\b/i.test(target + ' ' + label) ? 'article' : /^[a-z][\w+.-]*:/i.test(target) ? 'reference' : 'piece');
    if (!references.some((entry) => entry.label === label && entry.target === target)) references.push({ label, target, kind: category });
  };
  const definitions = new Map([...file.contenu.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm)].map((match) => [match[1].toLowerCase(), match[2]]));
  for (const match of text.matchAll(/!?\[([^\]\n]+)\]\((<[^>]+>|(?:[^\s()]|\([^()]*\))+)(?:\s+"[^"]*")?\)/g)) add(match[1], match[2].replace(/^<|>$/g, ''));
  for (const match of text.matchAll(/\[([^\]\n]+)\](?:\[([^\]\n]*)\])?(?!\()/g)) {
    const target = definitions.get((match[2] || match[1]).toLowerCase());
    if (target) add(match[1], target);
  }
  for (const match of text.matchAll(/https?:\/\/[^\s<>\])]+/g)) if (!references.some((entry) => entry.target === match[0])) add(match[0], match[0]);
  for (const match of text.matchAll(/\b(?:LEGIARTI|JURITEXT|CETATEXT|JORFTEXT|JORFARTI)\d+\b/g)) {
    const id = match[0];
    const heading = text.split('\n').find((line) => /^#{1,6}\s/.test(line) && line.includes(id));
    const label = heading?.replace(/^#{1,6}\s*/, '').split('|')[0].trim() || id;
    if (!references.some((entry) => entry.target.includes(id))) add(label, `https://www.legifrance.gouv.fr/${id.startsWith('LEGIARTI') ? 'codes/article_lc' : id.startsWith('JURI') ? 'juri/id' : id.startsWith('CETA') ? 'ceta/id' : 'jorf/id'}/${id}`, /^(?:JURI|CETA)/.test(id) ? 'jurisprudence' : 'article');
  }
  for (const match of text.matchAll(/\b(?:[Aa]rticles?\s+(?:[LRD]\.\s*)?\d+[\w.−-]*|[Pp]ièce\s+(?:n[°ºo]\s*)?\d+)\b/g)) if (!references.some((entry) => entry.label.includes(match[0]))) add(match[0], '', /^pièce/i.test(match[0]) ? 'piece' : 'article');
  return { text, references: references.map((entry) => ({ ...entry, origin: file.chemin })) };
}

export function logicalText(text: string) {
  const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  return (text.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:et|ou|and|or)\b|[^"']+?(?=\b(?:et|ou|and|or)\b|["']|$)|./gs) ?? []).map((token) => /^(?:et|ou|and|or)$/.test(token) ? `<span class="pmc-logic-pill" data-operator="${token === 'and' ? 'et' : token === 'or' ? 'ou' : token}">${token === 'and' ? 'et' : token === 'or' ? 'ou' : token}</span>` : escape(token)).join('');
}
