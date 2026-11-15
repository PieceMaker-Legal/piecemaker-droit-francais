const decode = (value) => value.replace(/\\\r?\n[ \t]*/g, '').replace(/\\([\s\S])/g, (_, char) => char === 'n' ? '\n' : char === 't' ? '\t' : char);

const ANCHOR = /\|\s*(?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)\d+/;
const CITED = /\b(?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)\d{12}\b/g;
const MALFORMED = /\b(?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)(?!\d{12}\b)/;
const WHOLE_TEXT = /\b(?:LEGITEXT|JORFTEXT)\d+/;
const ARTICLE_LABEL = /\d[\p{L}\p{N}]*_\p{L}[\p{L}_]*$/u;
const PREMISE = /^okf:\/\S+$/;
const DECLARED_TEST = /#\[test\]\s*(?:déclaration|declaration)\s+(?:champ d'application|scope)\s+([\p{L}\p{N}_]+)/gu;

export function catalaDocumentation(content, { test = false } = {}) {
  const entries = [];
  const errors = [];
  const tests = new Set([...content.matchAll(DECLARED_TEST)].map((match) => match[1]));
  const lines = content.split(/\r?\n/);
  let headings = [];
  let fence = '';
  let code = false;
  let startLine = 0;
  let block = [];
  let scope = '';
  const inspect = () => {
    const text = block.join('\n');
    const anchored = Boolean(headings.at(-1)?.anchored);
    const tokens = /#\[\s*doc\s*=\s*"((?:\\[\s\S]|[^"\\])*)"\s*\]|##[ \t]+([^\n]*)|#\[(?:"(?:\\[\s\S]|[^"\\])*"|[^\]])*\]|"(?:\\[\s\S]|[^"\\])*"|#[^\n]*|(?<![\p{L}\p{N}_])(?:(?:déclaration|declaration)\s+(?:champ d'application|scope|structure|énumération|enumeration)|définition|definition|règle|rule|déclaration|declaration|champ d'application|scope|assertion|entrée|input|résultat|output|interne|internal|contexte|context|étiquette|label|exception)(?![\p{L}\p{N}_])/gu;
    let pending = [];
    let meta = {};
    let pendingLine = 0;
    let previous;
    let counted = 0;
    let newlines = 0;
    const lineAt = (offset) => {
      if (offset < counted) { counted = 0; newlines = 0; }
      for (; counted < offset; counted++) if (text.charCodeAt(counted) === 10) newlines++;
      return startLine + newlines + 1;
    };
    for (const token of text.matchAll(tokens)) {
      if (token[1] !== undefined || token[2] !== undefined) {
        if (previous) previous.endLine = lineAt(token.index) - 1;
        previous = undefined;
        pendingLine ||= lineAt(token.index);
        if (token[1] !== undefined) {
          pending.push(decode(token[1]));
          const field = decode(token[1]).match(/^\s*(titre|source|quote)\s*:/im)?.[1];
          if (field) errors.push({ line: lineAt(token.index), message: `#[doc] contient « ${field}: » : le titre va dans ## texte court, la source juridique dans le titre de section.` });
        } else if (PREMISE.test(token[2].trim())) {
          pending.push(token[2].trim());
        } else {
          meta.title = token[2].trim();
          const words = meta.title.split(/\s+/).filter(Boolean);
          if (words.length < 2 || words.length > 7 || /[_?]/.test(meta.title)) errors.push({ line: lineAt(token.index), message: `titre « ${meta.title} » : écrivez 2 à 7 mots, sans identifiant de variable ni « ? ».` });
        }
        continue;
      }
      if (/^(?:étiquette|label|exception)$/.test(token[0])) {
        const label = text.slice(token.index + token[0].length).match(/^\s+([\p{L}\p{N}_]+)/u)?.[1] ?? '';
        if (/article/i.test(label) && /\d/.test(label) && !ARTICLE_LABEL.test(label)) errors.push({ line: lineAt(token.index), message: `étiquette « ${label} » : ajoutez le texte après le numéro (ex. article_2_code_civil).` });
        continue;
      }
      if (/^[#"]/.test(token[0])) continue;
      if (/^(?:champ d'application|scope)$/.test(token[0])) scope = text.slice(token.index + token[0].length).match(/^\s+([\p{L}\p{N}_]+)/u)?.[1] ?? '';
      if (/^(?:déclaration|declaration)/.test(token[0])) scope = '';
      if (previous) previous.endLine = lineAt(token.index) - 1;
      const line = lineAt(token.index);
      const doc = pending.join('\n');
      const title = meta.title ?? doc.trim();
      const entry = { startLine: pendingLine || line, endLine: startLine + block.length, doc, hasDoc: pending.length > 0, title };
      entries.push(entry);
      previous = entry;
      if (/^(?:entrée|input)$/.test(token[0]) && !meta.title) errors.push({ line, message: 'titre manquant pour cette entrée. Écrivez ## texte court au-dessus.' });
      if (/^(?:définition|definition|règle|rule)$/.test(token[0]) && !test && !tests.has(scope) && !anchored) errors.push({ line, message: "règle sans source juridique : placez-la sous un titre ## Article N | LEGIARTI… (JORFARTI) ou ## Décision | JURITEXT… (CETATEXT, CONSTEXT), suivi de l'extrait exact entre « »." });
      pending = [];
      meta = {};
      pendingLine = 0;
    }
    block = [];
  };
  const anchoredIds = new Set();
  let own = [];
  lines.forEach((line, index) => {
    if (!/^#{1,6}\s/.test(line) || !ANCHOR.test(line) || !(lines.slice(index + 1).find((following) => following.trim()) ?? '').trim().startsWith('«')) return;
    for (const id of line.match(CITED) ?? []) anchoredIds.add(id);
  });
  lines.forEach((line, index) => {
    if (MALFORMED.test(line)) errors.push({ line: index + 1, message: 'identifiant Légifrance mal formé : le préfixe est suivi de 12 chiffres, sans espace.' });
    if (/^#{1,6}\s/.test(line) && WHOLE_TEXT.test(line)) errors.push({ line: index + 1, message: "citez l'article (LEGIARTI ou JORFARTI), pas le texte entier (LEGITEXT ou JORFTEXT)." });
    const inclusion = line.match(/^>\s*(?:Inclusion|Include)\s*:\s*(\S+)/)?.[1];
    if (inclusion && !/^(?:LEGIARTI|JORFARTI)\d+$/.test(inclusion) && (inclusion.startsWith('/') || inclusion.split(/[\\/]/).includes('..'))) errors.push({ line: index + 1, message: `inclusion « ${inclusion} » hors du dossier du programme : placez le fichier dans le programme.` });
    const heading = !fence && line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const next = lines.slice(index + 1).find((following) => following.trim()) ?? '';
      headings = [...headings.filter((entry) => entry.level < heading[1].length), { level: heading[1].length, anchored: ANCHOR.test(heading[2]) && next.trim().startsWith('«') }];
      own = heading[2].match(CITED) ?? [];
      if (own.length > 1) errors.push({ line: index + 1, message: 'une section = une source : ce titre cite plusieurs identifiants. Écrivez une section ## Article N | LEGIARTI… par source, avec son extrait et sa règle.' });
    }
    for (const id of line.match(CITED) ?? []) {
      if (!anchoredIds.has(id)) errors.push({ line: index + 1, message: `${id} cité sans section propre : écrivez ## Article N | ${id} suivi de l'extrait entre « ».` });
      else if (!own.includes(id) && !inclusion) errors.push({ line: index + 1, message: `${id} cité hors de sa section : une règle = une source. Ne citez ${id} que dans son titre ## Article N | ${id}, jamais dans le texte d'une autre section.` });
    }
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
  for (const fact of scenarioFacts(content, { test })) if (!fact.source) errors.push({ line: fact.line, message: `fait du scénario sans justification : écrivez ## okf:/_premises/<fiche>.md juste au-dessus de ${fact.variable}.` });
  return { entries, errors };
}

const FACT = /^\s*(?:(?:règle|rule)\s+([\p{L}\p{N}_]+\.[\p{L}\p{N}_.]+)\s+(?:rempli|fulfilled)|(?:définition|definition)\s+([\p{L}\p{N}_]+\.[\p{L}\p{N}_.]+)\s+(?:égal à|equals)(.*))\s*$/u;

export function scenarioFacts(content, { test = false } = {}) {
  const tests = new Set([...content.matchAll(DECLARED_TEST)].map((match) => match[1]));
  const facts = [];
  let scope = '';
  let source = '';
  content.split(/\r?\n/).forEach((line, index) => {
    const opened = line.match(/^\s*(?:champ d'application|scope)\s+([\p{L}\p{N}_]+)\s*:/u);
    if (opened) scope = opened[1];
    else if (/^\s*(?:#\[test\]\s*)?(?:déclaration|declaration)(?![\p{L}\p{N}_])|^\s{0,3}(?:`{3,}|~{3,})/u.test(line)) scope = '';
    const fact = scope && (test || tests.has(scope)) && line.match(FACT);
    if (fact && !/^\p{Lu}[\p{L}\p{N}_]*$/u.test((fact[3] ?? '').trim())) facts.push({ line: index + 1, variable: fact[1] ?? fact[2], value: (fact[3] ?? '').trim(), source });
    if (line.trim()) source = line.match(/^\s*##\s+(okf:\/\S+)\s*$/)?.[1] ?? '';
  });
  return facts;
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
