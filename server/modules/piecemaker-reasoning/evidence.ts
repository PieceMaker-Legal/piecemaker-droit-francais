import type Database from 'better-sqlite3';

import type { ReasoningEvidenceCandidate, ReasoningProgram } from '../../../shared/piecemaker-reasoning.js';

export function resolveEvidence(db: Database.Database, projectId: string, program: ReasoningProgram): ReasoningProgram {
  return { ...program, nodes: program.nodes.map((node) => {
    const { evidenceCandidates: _candidates, evidenceIssue: _issue, ...rest } = node;
    if (!node.evidence) return rest;
    const evidence = node.evidence;
    try {
      const natures = (evidence.nature ?? []).map((nature) => nature.toLowerCase());
      const clauses = [
        "n.project_id=?", "n.kind='document'",
        ...(natures.length ? [`lower(json_extract(n.data_json,'$.nature')) IN (${natures.map(() => '?').join(',')})`] : []),
        ...(evidence.from ? ['n.doc_date>=?'] : []),
        ...(evidence.to ? ['n.doc_date<?'] : []),
        ...(evidence.mentions ?? []).map(() => "EXISTS (SELECT 1 FROM piecemaker_links l WHERE l.project_id=n.project_id AND l.from_node_id=n.id AND l.to_node_id=? AND l.relation='mentions')"),
      ];
      const rows = db.prepare(`SELECT n.id, n.label, n.doc_date AS date, json_extract(n.data_json,'$.nature') AS nature FROM piecemaker_nodes n WHERE ${clauses.join(' AND ')} ORDER BY n.doc_date, n.id LIMIT 20`)
        .all(projectId, ...natures, ...(evidence.from ? [evidence.from] : []), ...(evidence.to ? [evidence.to] : []), ...(evidence.mentions ?? [])) as ReasoningEvidenceCandidate[];
      return rows.length ? { ...rest, evidenceCandidates: rows } : rest;
    } catch (error) {
      return { ...rest, evidenceIssue: `Recherche de preuve ${node.id} impossible : ${error instanceof Error ? error.message : 'lecture impossible'}.` };
    }
  }) };
}
