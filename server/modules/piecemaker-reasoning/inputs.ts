import type Database from 'better-sqlite3';

import type { ReasoningProgram } from '../../../shared/piecemaker-reasoning.js';

export function resolveInputs(db: Database.Database, projectId: string, program: ReasoningProgram): ReasoningProgram {
  return { ...program, nodes: program.nodes.map((node) => {
    if (!node.input) return node;
    const { input } = node;
    let inputIssue: string | undefined;
    try {
      const columns = db.prepare(`PRAGMA table_info("${input.table}")`).all() as Array<{ name: string }>;
      if (![input.column, ...Object.keys(input.where)].every((column) => columns.some((entry) => entry.name === column))) throw new TypeError('Table ou colonne absente.');
      const entries = Object.entries(input.where);
      const selected = input.path ? `json_extract("${input.column}", ?)` : `"${input.column}"`;
      const values = entries.map(([, value]) => typeof value === 'boolean' ? Number(value) : value);
      const rows = db.prepare(`SELECT ${selected} AS value FROM "${input.table}" WHERE project_id=? AND ${entries.map(([key]) => `"${key}" IS ?`).join(' AND ')} LIMIT 2`).all(...(input.path ? [input.path] : []), projectId, ...values) as Array<{ value: unknown }>;
      if (rows.length !== 1) throw new TypeError('La liaison SQL doit désigner exactement une ligne.');
      const actual = rows[0].value;
      if (actual !== null && !['string', 'number'].includes(typeof actual)) throw new TypeError('Valeur SQL non scalaire.');
      if (actual !== (typeof node.value === 'boolean' ? Number(node.value) : node.value)) throw new TypeError('La valeur SQL diffère de la proposition sourcée : réexaminer la proposition et ses citations.');
    } catch (error) { inputIssue = `Entrée SQL ${node.id} : ${error instanceof Error ? error.message : 'lecture impossible'}`; }
    return { ...node, inputIssue };
  }) };
}
