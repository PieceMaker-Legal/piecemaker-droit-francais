type Position = { file: string; start: { line: number; character: number }; end: { line: number; character: number }; law_headings: string[] };
type RulePosition = { filename: string; start_line: number; start_column: number; end_line: number; end_column: number; law_headings: string[] };
type Event = { element: { kind: string; name?: string; input?: string; output?: boolean; decl_pos?: Position; cons_pos?: Position }; pos: Position; value: unknown; trace?: Event[] };
type Tree = { label: string; rules: Array<{ pos: RulePosition; condition_pos?: RulePosition; condition_text?: string }>; exceptions: Tree[] };
export type NativeProvenance = {
  trace: Event[];
  definitions: Array<{ fichier: string; scope: string; variable: string; trees: Tree[] }>;
  dependencies: Array<{ fichier: string; intra_scopes: Record<string, { nodes: Record<string, string>; edges: Array<{ from: number; to: number }> }> }>;
  issues: string[];
};
export type NativeOrigin = { file: string; line: number; column: number; endLine: number; endColumn: number; headings: string[]; role: 'definition' | 'condition' | 'declaration'; label: string; expression: string; selected: boolean; overrides: string };

const origin = (pos: Position, role: NativeOrigin['role'], selected = true): NativeOrigin => ({ file: pos.file, line: pos.start.line, column: pos.start.character, endLine: pos.end.line, endColumn: pos.end.character, headings: pos.law_headings, role, label: '', expression: '', selected, overrides: '' });
const fromRule = (pos: RulePosition): Position => ({ file: pos.filename, start: { line: pos.start_line, character: pos.start_column }, end: { line: pos.end_line, character: pos.end_column }, law_headings: pos.law_headings });
const identity = (pos: NativeOrigin) => JSON.stringify([pos.file, pos.line, pos.column, pos.endLine, pos.endColumn, pos.role]);
const xml = (text: string) => text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const within = (a: Position, b: Position) => a.file === b.file && (a.start.line > b.start.line || a.start.line === b.start.line && a.start.character >= b.start.character) && (a.start.line < b.end.line || a.start.line === b.end.line && a.start.character <= b.end.character);
const valueOf = (value: unknown): string => typeof value === 'boolean' ? value ? 'Vrai' : 'Faux' : typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? 'Indéterminé');

export function nativeExecution(data: NativeProvenance, files: Array<{ chemin: string; contenu?: string }>) {
  const variables: Array<{ id: string; name: string; file: string; scope: string; value: string; input: boolean; output: boolean; origins: NativeOrigin[] }> = [];
  const edges: Array<[string, string]> = [];
  const sources = new Map(files.map((file) => [file.chemin, file.contenu?.split(/\r?\n/)]));
  const argumentsToLink: Array<{ caller: Map<string, string>; name: string; input: string }> = [];
  const link = (from: string, to: string) => { if (from !== to && !edges.some(([a, b]) => a === from && b === to)) edges.push([from, to]); };
  const visit = (events: Event[], parent = '', caller?: Map<string, string>) => {
    for (const call of events) {
      if (call.element.kind !== 'scope_call') { visit(call.trace ?? [], parent, caller); continue; }
      const local = new Map<string, string>();
      const file = call.element.decl_pos?.file ?? call.pos.file;
      const scope = call.element.name ?? '';
      const { start, end } = call.pos;
      const lines = sources.get(call.pos.file)?.slice(start.line - 1, end.line) ?? [];
      const text = lines.map((line, index) => line.slice(index === 0 ? start.character - 1 : 0, index === lines.length - 1 ? end.character - 1 : undefined)).join('\n');
      const argumentsBlock = caller && text.match(/^(?:résultat de|output of)\s+[\p{L}\p{N}_.]+\s+(?:avec|with)\s*\{([^{}]*)\}$/u)?.[1];
      const args = new Map([...(argumentsBlock || '').matchAll(/--\s*([\p{L}\p{N}_]+)\s*:\s*([\p{L}\p{N}_]+)(?:\.[\p{L}\p{N}_]+)*\s*(?=--|$)/gu)].map(([, input, name]) => [input, name]));
      for (const event of call.trace ?? []) {
        if (event.element.kind !== 'scope_var') continue;
        const name = event.element.name ?? '';
        const id = `x${100000 + variables.length}`;
        local.set(name, id);
        const applied = (event.trace ?? []).filter((child) => child.element.kind === 'exception');
        const positions = applied.map((child) => child.pos);
        const trees = data.definitions.find((entry) => entry.fichier === file && entry.scope === scope && entry.variable === name)?.trees ?? [];
        const origins: NativeOrigin[] = trees.length ? [] : positions.map((pos) => origin(pos, 'definition'));
        if (!origins.length && !trees.length) origins.push(origin(event.element.decl_pos ?? event.pos, 'declaration'));
        const tree = (items: Tree[], overrides = '') => {
          for (const item of items) {
            let key = overrides;
            for (const rule of item.rules) {
              const pos = fromRule(rule.pos);
              const selected = positions.some((position) => within(position, pos) || (rule.condition_pos && within(position, fromRule(rule.condition_pos))));
              const definition = { ...origin(pos, 'definition', selected), label: item.label, overrides };
              key = identity(definition);
              origins.push(definition);
              if (rule.condition_pos) origins.push({ ...origin(fromRule(rule.condition_pos), 'condition', selected), label: item.label, expression: rule.condition_text ?? '', overrides: key });
            }
            tree(item.exceptions, key);
          }
        };
        tree(trees);
        const unique = origins.filter((entry, index) => origins.findIndex((other) => identity(other) === identity(entry)) === index);
        const input = event.element.input === 'only_input';
        variables.push({ id, name, file, scope, value: valueOf(event.value), input, output: Boolean(event.element.output), origins: unique });
        const argument = input && args.get(name);
        if (caller && argument) argumentsToLink.push({ caller, name: argument, input: id });
        if (parent && event.element.output) link(id, parent);
        visit(event.trace ?? [], id, local);
      }
      const dependencies = data.dependencies.find((entry) => entry.fichier === file)?.intra_scopes[scope];
      if (dependencies) for (const edge of dependencies.edges) {
        const from = local.get(dependencies.nodes[edge.from]);
        const to = local.get(dependencies.nodes[edge.to]);
        if (from && to) link(from, to);
      }
    }
  };
  visit(data.trace);
  for (const { caller, name, input } of argumentsToLink) {
    const argument = caller.get(name);
    if (argument) link(argument, input);
  }
  const nodes = variables.map((variable) => {
    const source = variable.origins.find((entry) => entry.selected && entry.role === 'definition') ?? variable.origins[0];
    const url = `${new URL(`file:///${source.file.replaceAll('\\', '/').replace(/^\/+/, '')}`).href}#L${source.line}`;
    return `${variable.id} [label=<<table><tr><td>${xml(variable.name)}</td></tr><tr><td>= ${xml(variable.value)}</td></tr></table>>, URL="${xml(url)}"];`;
  });
  return { variables, dot: `digraph G {\n${nodes.join('\n')}\nsubgraph cluster_inputs { ${variables.filter((variable) => variable.input).map((variable) => `${variable.id};`).join(' ')} }\n${edges.map(([from, to]) => `${from} -> ${to} [style="solid"];`).join('\n')}\n}` };
}
