const decode = (value) => value.replace(/\\\r?\n[ \t]*/g, '').replace(/\\([\s\S])/g, (_, char) => char === 'n' ? '\n' : char === 't' ? '\t' : char);

export function catalaDocumentation(content) {
  const entries = [];
  const errors = [];
  let fence = '';
  let code = false;
  let startLine = 0;
  let block = [];
  const inspect = () => {
    const text = block.join('\n');
    const tokens = /#\[\s*doc\s*=\s*"((?:\\[\s\S]|[^"\\])*)"\s*\]|#\[\s*piecemaker\.(source|citation|question)\s*=\s*"((?:\\[\s\S]|[^"\\])*)"\s*\]|##[ \t]+([^\n]*)|#\[(?:"(?:\\[\s\S]|[^"\\])*"|[^\]])*\]|"(?:\\[\s\S]|[^"\\])*"|#[^\n]*|(?<![\p{L}\p{N}_])(?:(?:déclaration|declaration)\s+(?:champ d'application|scope|structure|énumération|enumeration)|définition|definition|règle|rule|déclaration|declaration|champ d'application|scope|assertion|entrée|input|résultat|output|interne|internal|contexte|context|étiquette|label|exception)(?![\p{L}\p{N}_])/gu;
    let pending = [];
    let meta = {};
    let pendingLine = 0;
    let previous;
    const lineAt = (offset) => startLine + text.slice(0, offset).split('\n').length;
    for (const token of text.matchAll(tokens)) {
      if (token[1] !== undefined || token[2] || token[4] !== undefined) {
        if (previous) previous.endLine = lineAt(token.index) - 1;
        previous = undefined;
        pendingLine ||= lineAt(token.index);
        if (token[1] !== undefined) pending.push(decode(token[1]));
        else if (token[2]) meta[token[2]] = decode(token[3]);
        else meta.title = token[4].trim();
        continue;
      }
      if (/^[#"]/.test(token[0]) || /^(?:étiquette|label|exception)$/.test(token[0])) continue;
      if (previous) previous.endLine = lineAt(token.index) - 1;
      const line = lineAt(token.index);
      const doc = pending.join('\n');
      const title = meta.title ?? (/^\s*(?:titre|source|quote)\s*:/im.test(doc) ? doc.match(/^\s*titre\s*:\s*(.+?)\s*$/im)?.[1] : doc.trim()) ?? '';
      const entry = { startLine: pendingLine || line, endLine: startLine + block.length, doc, hasDoc: pending.length > 0, title, source: meta.source ?? '', citation: meta.citation ?? '', question: meta.question ?? '' };
      entries.push(entry);
      previous = entry;
      if (/^(?:entrée|input)$/.test(token[0]) && !meta.title && !meta.source && !meta.question) errors.push({ line, message: 'titre manquant pour cette entrée. Écrivez ## texte court au-dessus, ou #[piecemaker.source = "okf:/_premises/<fiche>.md"] pour un fait du dossier.' });
      if (entry.source && !/^okf:/i.test(entry.source) && !entry.citation.trim()) errors.push({ line: entry.startLine, message: `#[piecemaker.citation] manquante pour la pièce ${entry.source}. Une pièce citée directement porte #[piecemaker.citation = "extrait exact"].` });
      pending = [];
      meta = {};
      pendingLine = 0;
    }
    block = [];
  };
  content.split(/\r?\n/).forEach((line, index) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (marker && fence && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
      if (code) inspect();
      fence = ''; code = false;
    } else if (marker && !fence) {
      if (/catala/i.test(marker[2]) && !/^catala(?:-metadata)?\s*$/.test(marker[2])) errors.push({ line: index + 1, message: 'bloc ignoré par Catala : ouvrez-le exactement par ```catala ou ```catala-metadata, sans espace ni majuscule.' });
      fence = marker[1]; code = /^catala(?:-metadata)?\s*$/.test(marker[2].trim()); startLine = index + 1;
    } else if (fence && code) block.push(line);
  });
  if (code) inspect();
  return { entries, errors };
}

export function testsWithoutAssertion(content) {
  const asserted = new Set();
  for (const match of content.matchAll(/^\s*(?:champ d'application|scope)\s+([\p{L}\p{N}_]+)\s*:([\s\S]*?)(?=^\s*(?:#\[test\]|déclaration|declaration|champ d'application|scope)(?![\p{L}\p{N}_])|^\s*```|(?![\s\S]))/gmu)) {
    if (/(?<![\p{L}\p{N}_])assertion(?![\p{L}\p{N}_])/u.test(match[2])) asserted.add(match[1]);
  }
  return [...content.matchAll(/#\[test\]\s*(?:déclaration|declaration)\s+(?:champ d'application|scope)\s+([\p{L}\p{N}_]+)/gu)]
    .filter((match) => !asserted.has(match[1]))
    .map((match) => ({ scope: match[1], line: content.slice(0, match.index).split('\n').length }));
}

export function okfCitedVariables(content) {
  const found = [];
  let scope = '';
  const pattern = /champ d'application\s+([\p{L}\p{N}_]+)\s*:|#\[\s*piecemaker\.source\s*=\s*"((?:\\[\s\S]|[^"\\])*)"\s*\](?:\s*(?:#\[(?:"(?:\\[\s\S]|[^"\\])*"|[^\]])*\]|##[^\n]*))*\s*(?:(?:étiquette|label|exception)\s+[\p{L}\p{N}_]+\s+)?(?:(?:déclaration|declaration|entrée|input|résultat|output|interne|internal|contexte|context|définition|definition|règle|rule)\s+)?([\p{L}\p{N}_]+)/gu;
  for (const match of content.matchAll(pattern)) {
    if (match[1]) { scope = match[1]; continue; }
    const source = decode(match[2]).match(/^\s*(okf:\S+)/i)?.[1];
    if (source && scope) found.push({ scope, variable: match[3], source, line: content.slice(0, match.index).split('\n').length });
  }
  return found;
}
