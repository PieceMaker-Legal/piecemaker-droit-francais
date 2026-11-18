import { catalaDocumentation, clauseHeading } from '../../server/piecemaker/vendor/skills/Skill-PieceMaker/scripts/catala-documentation.mjs';

let documented: { content: string; entries: ReturnType<typeof catalaDocumentation>['entries'] } | undefined;
const documentedEntries = (content: string) => {
  if (documented?.content !== content) documented = { content, entries: catalaDocumentation(content).entries.filter((entry) => entry.hasDoc) };
  return documented.entries;
};

export function sourceContext(source: string, files: Array<{ nom: string; chemin: string; contenu?: string }>, wholeDocument = false, contract = false): { text: string; references: Array<{ label: string; target: string; kind: string; origin: string; quote: string }> } {
  let location: URL;
  try { location = new URL(source); } catch { return { text: '', references: [] }; }
  let filename = '';
  try { filename = decodeURIComponent(location.pathname).split('/').pop() ?? ''; } catch { return { text: '', references: [] }; }
  const matches = files.filter((file) => file.nom.split('/').pop() === filename);
  const file = matches.length === 1 ? matches[0] : undefined;
  const line = Number(location.hash.match(/^#L(\d+)/)?.[1]);
  if (!file?.contenu || (!line && !wholeDocument)) return { text: '', references: [] };
  const documentation = documentedEntries(file.contenu);
  const annotated = documentation.find((entry) => entry.startLine <= line && line <= entry.endLine);
  const documentContext = (text: string) => sourceContext('https://catala.local/doc.md', [{ nom: 'doc.md', chemin: file.chemin, contenu: text }], true);
  if (!wholeDocument && annotated) return documentContext(annotated.doc);
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
  const clause = wholeDocument ? undefined : [...sections].reverse().map((section) => {
    const title = section.lines[0]?.match(/^#{1,6}\s+(.*)$/)?.[1]?.trim() ?? '';
    const following = section.lines.slice(1).find((entry) => entry.trim()) ?? '';
    return clauseHeading(title, following, contract) ? { title, quote: /^«\s*([\s\S]*?)\s*»/.exec(section.lines.slice(1).join('\n').trim())?.[1] ?? '' } : undefined;
  }).find(Boolean);
  const references: Array<{ label: string; target: string; kind: string }> = [];
  const add = (label: string, target: string, kind?: string) => {
    const category = kind ?? (/^okf:/i.test(target) ? 'premise' : /\bjurisprudence\b|\barrêt\b|\/(?:juri|ceta|cons)\/id\/|courdecassation\.fr\/decision\//i.test(label + ' ' + target) ? 'jurisprudence' : /^pièce\b|\.(?:pdf|docx?)(?:[?#]|$)/i.test(label + ' ' + target) ? 'piece' : /legifrance\.gouv\.fr|\barticle\b/i.test(target + ' ' + label) ? 'article' : /^[a-z][\w+.-]*:/i.test(target) ? 'reference' : 'piece');
    if (!references.some((entry) => entry.label === label && entry.target === target)) references.push({ label, target, kind: category });
  };
  const definitions = new Map([...file.contenu.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm)].map((match) => [match[1].toLowerCase(), match[2]]));
  for (const match of text.matchAll(/!?\[([^\]\n]+)\]\((<[^>]+>|(?:[^\s()]|\([^()]*\))+)(?:\s+"[^"]*")?\)/g)) add(match[1], match[2].replace(/^<|>$/g, ''));
  for (const match of text.matchAll(/\[([^\]\n]+)\](?:\[([^\]\n]*)\])?(?!\()/g)) {
    const target = definitions.get((match[2] || match[1]).toLowerCase());
    if (target) add(match[1], target);
  }
  for (const match of text.matchAll(/^okf:\/\S+$/gm)) add(match[0], match[0]);
  for (const match of text.matchAll(/^source\s*:\s*([^\s<>]+)\s*$/gim)) add(match[1], match[1]);
  for (const match of text.matchAll(/https?:\/\/[^\s<>\])]+/g)) if (!references.some((entry) => entry.target === match[0])) add(match[0], match[0]);
  for (const match of text.matchAll(/\b(?:LEGIARTI|JURITEXT|CETATEXT|CONSTEXT|JORFTEXT|JORFARTI)\d+\b/g)) {
    const id = match[0];
    const heading = text.split('\n').find((line) => /^#{1,6}\s/.test(line) && line.includes(id));
    const label = heading?.replace(/^#{1,6}\s*/, '').split('|')[0].trim() || id;
    if (!references.some((entry) => entry.target.includes(id))) add(label, `https://www.legifrance.gouv.fr/${id.startsWith('LEGIARTI') ? 'codes/article_lc' : id.startsWith('JURI') ? 'juri/id' : id.startsWith('CETA') ? 'ceta/id' : id.startsWith('CONS') ? 'cons/id' : 'jorf/id'}/${id}`, /^(?:JURI|CETA|CONS)/.test(id) ? 'jurisprudence' : 'article');
  }
  for (const match of text.matchAll(/\b(?:[Aa]rticles?\s+(?:[LRD]\.\s*)?\d+[\w.−-]*|[Pp]ièce\s+(?:n[°ºo]\s*)?\d+)\b/g)) if (!references.some((entry) => entry.label.toLowerCase().includes(match[0].toLowerCase()))) add(match[0], '', /^pièce/i.test(match[0]) ? 'piece' : 'article');
  const extracted = references.map((entry) => {
    const marker = entry.target.match(/(?:LEGIARTI|JURITEXT|CETATEXT|CONSTEXT|JORFARTI|JORFTEXT)\d+/)?.[0] ?? (entry.target || entry.label);
    const rows = text.split('\n');
    const quoted = (at: number) => {
      const following = rows.slice(at + 1);
      while (following[0] === '') following.shift();
      const literal = /^(?:(?:Citation|quote)\s*:\s*)?«\s*([\s\S]*?)\s*»(?:\n|$)/i.exec(following.join('\n'))?.[1];
      const quote: string[] = [];
      for (const line of following) { if (!/^>\s?/.test(line)) break; quote.push(line.replace(/^>\s?/, '')); }
      return literal ?? quote.join('\n');
    };
    const own = rows.flatMap((line, index) => entry.target && line.includes(`[${entry.label}](${entry.target}`) ? [index] : []);
    const linked = rows.flatMap((line, index) => entry.target && line.includes(entry.target) ? [index] : []);
    const candidates = [...own, ...linked, ...(linked.length ? [] : rows.flatMap((line, index) => line.includes(marker) ? [index] : []))];
    if (!candidates.length) return { ...entry, origin: file.chemin, quote: '' };
    return { ...entry, origin: file.chemin, quote: candidates.map(quoted).find(Boolean) ?? '' };
  });
  const native = wholeDocument ? documentation.flatMap((entry) => documentContext(entry.doc).references) : [];
  const clauses = clause ? [{ label: clause.title, target: encodeURI(filename), kind: 'clause', origin: file.chemin, quote: clause.quote }] : [];
  return { text: [text, ...(wholeDocument ? documentation.map((entry) => entry.doc) : [])].filter(Boolean).join('\n\n'), references: [...clauses, ...extracted.filter((entry) => !clause || entry.kind !== 'article' || entry.target || !clause.title.toLowerCase().includes(entry.label.toLowerCase())), ...native].filter((entry, index, all) => all.findIndex((other) => other.target === entry.target && other.label === entry.label && other.quote === entry.quote) === index) };
}
