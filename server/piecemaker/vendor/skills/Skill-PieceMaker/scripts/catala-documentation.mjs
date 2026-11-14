const decode = (value) => value.replace(/\\\r?\n[ \t]*/g, '').replace(/\\([\s\S])/g, (_, char) => char === 'n' ? '\n' : char === 't' ? '\t' : char);

const ANCHOR = /\|\s*(?:LEGIARTI|JURITEXT|CETATEXT|CONSTEXT)\d+/;
const DECLARED_TEST = /#\[test\]\s*(?:déclaration|declaration)\s+(?:champ d'application|scope)\s+([\p{L}\p{N}_]+)/gu;

export function catalaDocumentation(content, { test = false } = {}) {
  const entries = [];
  const errors = [];
  const tests = new Set([...content.matchAll(DECLARED_TEST)].map((match) => match[1]));
  const lines = content.split(/\r?\n/);
  let headings = [];
  let fence = '';
  let code = false;
  let metadata = false;
  let startLine = 0;
  let block = [];
  let scope = '';
  const inspect = () => {
    const text = block.join('\n');
    const anchored = headings.some((heading) => heading.anchored);
    const tokens = /#\[\s*doc\s*=\s*"((?:\\[\s\S]|[^"\\])*)"\s*\]|##[ \t]+([^\n]*)|#\[(?:"(?:\\[\s\S]|[^"\\])*"|[^\]])*\]|"(?:\\[\s\S]|[^"\\])*"|#[^\n]*|(?<![\p{L}\p{N}_])(?:(?:déclaration|declaration)\s+(?:champ d'application|scope|structure|énumération|enumeration)|définition|definition|règle|rule|déclaration|declaration|champ d'application|scope|assertion|entrée|input|résultat|output|interne|internal|contexte|context|étiquette|label|exception)(?![\p{L}\p{N}_])/gu;
    let pending = [];
    let meta = {};
    let pendingLine = 0;
    let previous;
    const lineAt = (offset) => startLine + text.slice(0, offset).split('\n').length;
    for (const token of text.matchAll(tokens)) {
      if (token[1] !== undefined || token[2] !== undefined) {
        if (previous) previous.endLine = lineAt(token.index) - 1;
        previous = undefined;
        pendingLine ||= lineAt(token.index);
        if (token[1] !== undefined) {
          pending.push(decode(token[1]));
          const field = decode(token[1]).match(/^\s*(titre|source|quote)\s*:/im)?.[1];
          if (field) errors.push({ line: lineAt(token.index), message: `#[doc] contient « ${field}: » : le titre va dans ## texte court, la source juridique dans le titre de section, la preuve d'un fait dans un cas de Prémisse.` });
        } else {
          meta.title = token[2].trim();
          const words = meta.title.split(/\s+/).filter(Boolean);
          if (words.length < 2 || words.length > 7 || /[_?]/.test(meta.title)) errors.push({ line: lineAt(token.index), message: `titre « ${meta.title} » : écrivez 2 à 7 mots, sans identifiant de variable ni « ? ».` });
        }
        continue;
      }
      if (/^[#"]/.test(token[0]) || /^(?:étiquette|label|exception)$/.test(token[0])) continue;
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
      if (/^(?:définition|definition|règle|rule)$/.test(token[0]) && !metadata && !test && !tests.has(scope) && !anchored) errors.push({ line, message: "règle sans source juridique : placez-la sous un titre ## Article N | LEGIARTI… ou ## Décision | JURITEXT… (CETATEXT, CONSTEXT), suivi de l'extrait exact entre « »." });
      pending = [];
      meta = {};
      pendingLine = 0;
    }
    block = [];
  };
  lines.forEach((line, index) => {
    const heading = !fence && line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const next = lines.slice(index + 1).find((following) => following.trim()) ?? '';
      headings = [...headings.filter((entry) => entry.level < heading[1].length), { level: heading[1].length, anchored: ANCHOR.test(heading[2]) && next.trim().startsWith('«') }];
    }
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (marker && fence && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
      if (code) inspect();
      fence = ''; code = false;
    } else if (marker && !fence) {
      if (/catala/i.test(marker[2]) && !/^catala(?:-metadata)?\s*$/.test(marker[2])) errors.push({ line: index + 1, message: 'bloc ignoré par Catala : ouvrez-le exactement par ```catala ou ```catala-metadata, sans espace ni majuscule.' });
      fence = marker[1]; code = /^catala(?:-metadata)?\s*$/.test(marker[2].trim()); metadata = /^catala-metadata\s*$/.test(marker[2].trim()); startLine = index + 1;
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

const IDENTIFIER = '[\\p{L}\\p{N}_]+';
const baseType = (type) => type.trim().split('.').at(-1);

function codeOnly(content) {
  let fence = '';
  let code = false;
  return content.split(/\r?\n/).map((line) => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (marker && fence && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) { fence = ''; code = false; return ''; }
    if (marker && !fence) { fence = marker[1]; code = /^catala(?:-metadata)?\s*$/.test(marker[2].trim()); return ''; }
    return code ? line : '';
  });
}

function declarations(content) {
  const enums = new Map();
  const structures = new Map();
  const inputs = [];
  let current = null;
  let scope = null;
  let test = false;
  codeOnly(content).forEach((line, index) => {
    if (/#\[test\]/.test(line)) test = true;
    const declared = line.match(new RegExp(`^\\s*(?:#\\[test\\]\\s*)?(?:déclaration|declaration)\\s+(énumération|enumeration|structure|champ d'application|scope)\\s+(${IDENTIFIER})`, 'u'));
    if (declared) {
      current = /^(?:énumération|enumeration)$/.test(declared[1]) ? enums : /^structure$/.test(declared[1]) ? structures : null;
      if (current) current.set(declared[2], []);
      scope = current ? null : { name: declared[2], test };
      current = current && { map: current, name: declared[2] };
      test = false;
      return;
    }
    if (/^\s*(?:déclaration|declaration|champ d'application|scope)(?![\p{L}\p{N}_])/u.test(line)) { current = null; scope = null; test = false; return; }
    const member = line.match(new RegExp(`^\\s*(?:--\\s*|(?:donnée|data)\\s+)(${IDENTIFIER})(?:\\s+(?:contenu|content)\\s+(.+?))?\\s*$`, 'u'));
    if (current && member) current.map.get(current.name).push({ name: member[1], type: member[2] ?? '', line: index + 1 });
    const input = line.match(new RegExp(`^\\s*(?:entrée|input)\\s+(?:(?:résultat|output)\\s+)?(${IDENTIFIER})\\s+(?:contenu|content)\\s+(.+?)\\s*$`, 'u'));
    if (scope && !scope.test && input) inputs.push({ scope: scope.name, name: input[1], type: input[2], line: index + 1 });
  });
  return { enums, structures, inputs };
}

export function premiseCases(content) {
  return declarations(content).enums.get('Prémisse') ?? [];
}

export function premiseSource(name) {
  return `okf:/_premises/${name.replace(/(?<=[\p{Ll}\p{N}])(?=\p{Lu})/gu, ' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.md`;
}

export function premiseValues(content) {
  return [...content.matchAll(/--\s*valeur\s*:\s*([^\n]+?)\s*\n\s*--\s*preuve\s*:\s*[\p{L}\p{N}_.]*Prémisse\.([\p{L}\p{N}_]+)/gu)]
    .map((match) => ({ name: match[2], expression: match[1], line: content.slice(0, match.index).split('\n').length }));
}

export function untypedFacts(files) {
  const all = files.map((file) => ({ ...file, ...declarations(file.content) }));
  const enums = new Map(all.flatMap((file) => [...file.enums]));
  const structures = new Map(all.flatMap((file) => [...file.structures]));
  const carries = (type) => baseType(type) === 'Prémisse' || (structures.get(baseType(type)) ?? []).some((field) => baseType(field.type) === 'Prémisse');
  const proven = (type) => (enums.get(baseType(type)) ?? []).some((member) => carries(member.type));
  return all.flatMap((file) => file.inputs.filter((input) => !proven(input.type)).map((input) => ({ file: file.name, line: input.line, scope: input.scope, variable: input.name, message: `fait sans preuve typée : l'entrée ${input.name} est de type ${input.type}. Déclarez-la de type Fait (Prouvé contenu Prémisse | NonProuvé) ou d'une énumération dont un cas porte une Prémisse.` })));
}

export function factInputs(files) {
  return files.flatMap((file) => declarations(file.content).inputs.map((input) => ({ ...input, file: file.name })));
}
