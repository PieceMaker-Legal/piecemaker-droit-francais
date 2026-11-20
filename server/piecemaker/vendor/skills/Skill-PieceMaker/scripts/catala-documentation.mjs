const decode = (value) => value.replace(/\\\r?\n[ \t]*/g, '').replace(/\\([\s\S])/g, (_, char) => char === 'n' ? '\n' : char === 't' ? '\t' : char);

const ANCHOR = /\|\s*(?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)\d+/;
const CITED = /\b(?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)\d{12}\b/g;
const MALFORMED = /\b(?:LEGIARTI|JORFARTI|JURITEXT|CETATEXT|CONSTEXT)(?!\d{12}\b)/;
const WHOLE_TEXT = /\b(?:LEGITEXT|JORFTEXT)\d+/;
const ARTICLE_LABEL = /\d[\p{L}\p{N}]*_\p{L}[\p{L}_]*$/u;
const PREMISE = /^okf:\/\S+$/;
const DECLARED_TEST = /#\[test\]\s*(?:déclaration|declaration)\s+(?:champ d'application|scope)\s+([\p{L}\p{N}_]+)/gu;

const CONTRACT_WORDS = /(?<![\p{L}])(?:contrat|convention|clause|statuts|pacte|avenant|bail|protocole|conditions générales|CGV|accord)(?![\p{L}])/iu;
const CLAUSE_TITLE = /^(?:article|art\.|clause|annexe|préambule|stipulation)(?![\p{L}])/iu;

// Une clause de contrat est une source : son titre ## nomme la clause, son texte exact suit entre « ».
// Hors mode contrat, le titre doit nommer l'acte (contrat, statuts, bail…) pour éviter de prendre un article de loi sans identifiant pour une clause.
export function clauseHeading(title, next, contract = false) {
  const text = String(title ?? '').trim();
  if (!text || ANCHOR.test(text) || WHOLE_TEXT.test(text) || !String(next ?? '').trim().startsWith('«')) return false;
  return CONTRACT_WORDS.test(text) || contract && CLAUSE_TITLE.test(text);
}

export function catalaDocumentation(content, { test = false, contract = false } = {}) {
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
        } else if (PREMISE.test(token[2].trim()) || NO_PREMISE.test(`## ${token[2]}`)) {
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
      if (/^(?:définition|definition|règle|rule)$/.test(token[0]) && !test && !tests.has(scope) && !anchored) errors.push({ line, message: contract ? "règle sans clause ni texte : placez-la sous le titre de sa clause (## Article N — Intitulé), suivi du texte exact de la clause entre « », ou sous un titre ## Article N | LEGIARTI… suivi de l'extrait." : "règle sans source juridique : placez-la sous un titre ## Article N | LEGIARTI… (JORFARTI) ou ## Décision | JURITEXT… (CETATEXT, CONSTEXT), suivi de l'extrait exact entre « »." });
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
      headings = [...headings.filter((entry) => entry.level < heading[1].length), { level: heading[1].length, anchored: ANCHOR.test(heading[2]) && next.trim().startsWith('«') || clauseHeading(heading[2], next, contract) }];
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
  if (!contract) for (const fact of scenarioFacts(content, { test })) if (!fact.source) errors.push({ line: fact.line, message: `fait du scénario sans justification : écrivez ## okf:/_premises/<fiche>.md juste au-dessus de ${fact.variable}.` });
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

const SCOPE_OPEN = /^\s*(?:champ d'application|scope)\s+([\p{L}\p{N}_]+)\s*:/u;
const SCOPE_DECLARATION = /^\s*(#\[test\]\s*)?(?:déclaration|declaration)\s+(?:champ d'application|scope)\s+([\p{L}\p{N}_]+)/u;
const INPUT = /^\s*(?:(?:entrée|input)\s+([\p{L}\p{N}_]+)|(?:contexte|context)\s+([\p{L}\p{N}_]+)\s+(?:condition|contenu|content)\b)/u;
const DEFINITION = /^(\s*)(?:(?:règle|rule)\s+([\p{L}\p{N}_.]+)\s+(non rempli|not fulfilled|rempli|fulfilled)|(?:définition|definition)\s+([\p{L}\p{N}_.]+)\s+(?:égal à|equals))/u;
const FIELD_START = /--\s*([\p{Ll}_][\p{L}\p{N}_]*)\s*:/gu;
const OKF_COMMENT = /^\s*##\s+(okf:\/\S+)\s*$/;
export const NO_PREMISE = /^\s*##\s+Sans prémisse\s*:\s*(\S.*?)\s*$/u;
const PATH = /(?<![\p{L}\p{N}_.])[\p{Ll}_][\p{L}\p{N}_]*(?:\.[\p{L}\p{N}_]+)*/gu;
const FENCE = /^\s{0,3}(?:`{3,}|~{3,})/;

function commentsAbove(lines, index) {
  const block = [];
  for (let i = index - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    if (!/^\s*##\s/.test(lines[i])) break;
    block.push(lines[i]);
  }
  return block;
}

// Struct-literal fields of an expression: { name, value, offset } where value runs to the next
// field of the same literal or to its closing brace.
function fieldsOf(expression) {
  const fields = [];
  for (const match of expression.matchAll(FIELD_START)) {
    let depth = 0;
    let end = match.index + match[0].length;
    for (; end < expression.length; end++) {
      const char = expression[end];
      if ('([{'.includes(char)) depth++;
      else if (')]}'.includes(char)) { if (!depth) break; depth--; }
      else if (!depth && expression.startsWith('--', end) && /^--\s*[\p{L}_][\p{L}\p{N}_]*\s*:/u.test(expression.slice(end))) break;
    }
    fields.push({ name: match[1], value: expression.slice(match.index + match[0].length, end).trim(), offset: match.index });
  }
  return fields;
}

const lineOf = (text, offset) => text.slice(0, offset).split('\n').length - 1;
const shown = (value) => JSON.stringify(value.replace(/\s+/g, ' ').trim());

// Premise links of a Catala program. An input of a business scope (entrée, or contexte …
// condition) must be set, in each scope that cites an OKF premise (the dossier scenario), from a
// fact under ## okf:/…, from an expression whose value is computed from such a fact, or with an
// explicit "## Sans prémisse : <motif>". A constant wrapped in a definition or a structure field
// is followed to the line that writes it.
export function premiseCoverage(files, { exists = () => true } = {}) {
  const inputs = new Map();
  const definitions = new Map();
  const feeds = [];
  const mentions = [];
  const linked = new Set();
  const dossierScopes = new Set();
  for (const { name: file, content } of files) {
    const lines = content.split(/\r?\n/);
    const testFile = /^test_/.test(file.split(/[\\/]/).pop());
    let declaring = null;
    let scope = '';
    const braces = [];
    lines.forEach((line, index) => {
      for (const match of line.matchAll(/okf:\/_premises\/[^\s)»"'`]+?\.md/g)) mentions.push({ file, line: index + 1, source: match[0] });
      const declared = line.match(SCOPE_DECLARATION);
      if (declared) {
        const previous = lines.slice(0, index).reverse().find((entry) => entry.trim()) ?? '';
        declaring = testFile || declared[1] || /^\s*#\[test\]\s*$/.test(previous) ? null : declared[2];
        scope = '';
        return;
      }
      if (declaring && line.trim() && !/^\s/.test(line)) declaring = null;
      const input = declaring && line.match(INPUT);
      if (input) {
        const name = input[1] ?? input[2];
        if (!inputs.has(name)) inputs.set(name, { name, file, line: index + 1, context: !input[1] });
        return;
      }
      const opened = line.match(SCOPE_OPEN);
      if (opened) { scope = `${file}\u0000${opened[1]}`; return; }
      if (FENCE.test(line)) { scope = ''; declaring = null; return; }
      if (!scope) { braces.length = 0; return; }
      const comments = commentsAbove(lines, index);
      const premises = comments.flatMap((comment) => comment.match(OKF_COMMENT)?.[1] ?? []).filter((source) => exists(source));
      const motive = comments.map((comment) => comment.match(NO_PREMISE)?.[1]).find(Boolean);
      if (premises.length) dossierScopes.add(scope);
      for (const source of premises) linked.add(source);
      const definition = line.match(DEFINITION);
      if (definition) {
        const target = definition[2] ?? definition[4];
        const indent = definition[1].length;
        let last = index;
        for (let next = index + 1; next < lines.length; next++) {
          if (!lines[next].trim()) continue;
          if (lines[next].search(/\S/) <= indent || FENCE.test(lines[next])) break;
          last = next;
        }
        const text = lines.slice(index, last + 1).join('\n');
        const expression = definition[3] ?? text.slice(definition[0].length);
        const entry = { file, line: index + 1, scope, variable: target.split('.').pop(), dotted: target.includes('.'), expression, offset: definition[0].length, text, premises, motive, falsity: /^(?:non rempli|not fulfilled)$/.test(definition[3] ?? '') };
        if (!definitions.has(entry.variable)) definitions.set(entry.variable, []);
        definitions.get(entry.variable).push(entry);
        if (target.includes('.')) feeds.push({ ...entry, value: definition[3] ?? expression });
      }
      // Only the fields of a scope call (résultat de X avec { … }) set inputs; a structure literal does not.
      const fields = fieldsOf(line);
      for (let at = 0, next = 0; at <= line.length; at++) {
        while (next < fields.length && fields[next].offset === at) { if (braces.at(-1)) feeds.push({ file, line: index + 1, scope, variable: fields[next].name, value: fields[next].value, premises, motive, falsity: false }); next++; }
        if (line[at] === '{') braces.push(/(?:avec|with)\s*$/.test(line.slice(0, at)));
        else if (line[at] === '}') braces.pop();
      }
    });
  }

  // Follows a value to the constant that writes it. Returns null when the value is computed from
  // an OKF premise, or the location of the constant otherwise.
  const resolving = new Set();
  const resolve = (value, at) => {
    const expression = value.trim().replace(/^\(\s*([\s\S]*?)\s*\)$/, '$1');
    const paths = [...expression.matchAll(PATH)].map((match) => match[0]);
    if (!paths.length) return { ...at, value: expression };
    const whole = paths.length === 1 && paths[0] === expression;
    let first = null;
    for (const path of paths) {
      const [head, ...rest] = path.split('.');
      const key = `${head}.${rest.join('.')}`;
      if (resolving.has(key)) continue;
      const entries = definitions.get(head) ?? [];
      if (!entries.length) continue;
      resolving.add(key);
      try {
        for (const entry of entries) {
          if (entry.premises.length) return null;
          const field = rest.length && fieldsOf(entry.expression).find((candidate) => candidate.name === rest[0]);
          const found = field
            ? resolve(rest.length > 1 ? `${field.value}.${rest.slice(1).join('.')}`.replace(/^([\s\S]*[^\p{L}\p{N}_])\.(.*)$/u, '$1') : field.value, { file: entry.file, line: entry.line + lineOf(entry.text, entry.offset + field.offset), value: field.value })
            : resolve(entry.expression, { file: entry.file, line: entry.line, value: entry.expression });
          if (!found) return null;
          first ??= found;
        }
      } finally { resolving.delete(key); }
    }
    return whole && first ? first : first && paths.length === 1 ? first : { ...at, value: expression };
  };

  // OKF premises whose fact reaches a value, following the same paths as resolve.
  const collecting = new Set();
  const premisesOf = (value, found = new Set()) => {
    for (const path of value.matchAll(PATH)) {
      const [head, ...rest] = path[0].split('.');
      const key = `${head}.${rest.join('.')}`;
      if (collecting.has(key)) continue;
      collecting.add(key);
      for (const entry of definitions.get(head) ?? []) {
        for (const source of entry.premises) found.add(source);
        const field = rest.length && fieldsOf(entry.expression).find((candidate) => candidate.name === rest[0]);
        premisesOf(field ? field.value : entry.expression, found);
      }
      collecting.delete(key);
    }
    return found;
  };

  const errors = [];
  const warnings = [];
  const used = new Set();
  // A context variable that the business rules define themselves is not a fact of the dossier.
  for (const input of inputs.values()) if (input.context && (definitions.get(input.name) ?? []).some((entry) => !entry.dotted)) inputs.delete(input.name);
  for (const input of inputs.values()) {
    const set = feeds.filter((feed) => feed.variable === input.name && dossierScopes.has(feed.scope));
    if (!set.length) {
      errors.push({ file: input.file, line: input.line, input: input.name, message: `input "${input.name}" is never set in a dossier scenario. Set it in the scope that cites the OKF premises, from a fact under "## okf:/_premises/<file>.md", or write "## Sans prémisse : <reason>" above the line that sets it.` });
      continue;
    }
    for (const feed of set) {
      for (const source of [...feed.premises, ...premisesOf(feed.premises.length ? '' : feed.value ?? '')]) used.add(source);
      if (feed.premises.length || feed.falsity) continue;
      const constant = resolve(feed.value, { file: feed.file, line: feed.line, value: feed.value });
      if (!constant) continue;
      const origin = constant.file !== feed.file || constant.line !== feed.line ? `, which comes from ${shown(constant.value)} at ${constant.file}:${constant.line}` : '';
      const value = feed.value === undefined ? '' : shown(feed.value);
      if (feed.motive) { warnings.push({ file: feed.file, line: feed.line, input: input.name, message: `input "${input.name}" is set to ${value}${origin} without OKF premise: ${feed.motive}` }); continue; }
      errors.push({ file: feed.file, line: feed.line, input: input.name, origin: origin ? { file: constant.file, line: constant.line } : undefined, message: `input "${input.name}" is set to ${value}${origin}, not derived from any OKF premise. Compute it from facts set under "## okf:/_premises/<file>.md", or write "## Sans prémisse : <reason>" above line ${feed.line}.` });
    }
  }
  const order = (a, b) => a.file.localeCompare(b.file) || a.line - b.line;
  return { inputs: [...inputs.values()], errors: errors.sort(order), warnings: warnings.sort(order), used: [...used], cited: [...linked], mentions };
}
