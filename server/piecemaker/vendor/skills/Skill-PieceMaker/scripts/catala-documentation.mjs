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
    const tokens = /#\[\s*doc\s*=\s*"((?:\\[\s\S]|[^"\\])*)"\s*\]|#\[(?:"(?:\\[\s\S]|[^"\\])*"|[^\]])*\]|"(?:\\[\s\S]|[^"\\])*"|#[^\n]*|(?<![\p{L}\p{N}_])(?:(?:déclaration|declaration)\s+(?:champ d'application|scope|structure|énumération|enumeration)|définition|definition|règle|rule|déclaration|declaration|champ d'application|scope|assertion|entrée|input|résultat|output|interne|internal|contexte|context|étiquette|label|exception)(?![\p{L}\p{N}_])/gu;
    let pending = [];
    let pendingLine = 0;
    let previous;
    const lineAt = (offset) => startLine + text.slice(0, offset).split('\n').length;
    const matches = [...text.matchAll(tokens)];
    for (const [index, token] of matches.entries()) {
      if (token[1] !== undefined) {
        if (previous) previous.endLine = lineAt(token.index) - 1;
        previous = undefined;
        pendingLine ||= lineAt(token.index);
        const doc = decode(token[1]);
        if (![...doc.matchAll(/^\s*quote\s*:\s*«([\s\S]*?)»/gim)].some((match) => match[1].trim())) errors.push({ line: lineAt(token.index), message: 'quote manquante ou vide dans #[doc]. Format attendu : quote: « passage exact ».' });
        pending.push(doc);
        continue;
      }
      if (/^[#"]/.test(token[0]) || /^(?:étiquette|label|exception)$/.test(token[0])) continue;
      if (previous) previous.endLine = lineAt(token.index) - 1;
      const line = lineAt(token.index);
      const definition = /^(?:définition|definition|règle|rule)$/.test(token[0]) || /^(?:déclaration|declaration)$/.test(token[0]) && /(?:égal à|equals)/.test(text.slice(token.index, matches[index + 1]?.index));
      const doc = pending.join('\n');
      const entry = { startLine: pendingLine || line, endLine: startLine + block.length, doc, hasDoc: pending.length > 0 };
      entries.push(entry);
      previous = entry;
      if (definition && !entry.hasDoc) errors.push({ line, message: '#[doc] manquant pour cette définition ou règle.' });
      pending = [];
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
      fence = marker[1]; code = /^catala(?:-metadata)?\s*$/.test(marker[2].trim()); startLine = index + 1;
    } else if (fence && code) block.push(line);
  });
  if (code) inspect();
  return { entries, errors };
}
