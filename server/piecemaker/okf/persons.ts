import fs from 'node:fs';
import path from 'node:path';

import { stringify } from 'yaml';

import type { KnowledgeLink, KnowledgeNode, KnowledgeSnapshot } from '../../../plugins/piecemaker-dossier/src/types.js';

import { bundleRoot, text } from './bundle.js';

export const PERSONS = 'persons';
export const PERSON_TYPES: Record<string, string> = { person: 'Personne', company: 'Organisation' };
const CCO: Record<string, string> = { person: 'Person', company: 'Organization' };

const STATUS: Record<string, string> = { human: 'Validé', agent: 'À vérifier', gliner: 'À trier' };
const ORDER = ['gliner', 'agent', 'human'];
const MENTIONS = 'mentions';

const authorOf = (data: Record<string, unknown> | undefined): string => ORDER.includes(text(data?.auteur)) ? text(data?.auteur) : 'gliner';
const isParty = (node: KnowledgeNode | undefined): boolean => Boolean(node && PERSON_TYPES[node.kind] && !node.id.startsWith('system:'));
const compare = (left: string, right: string): number => left.localeCompare(right, 'fr', { sensitivity: 'base' });

export const personFile = (node: Pick<KnowledgeNode, 'id'>): string => `${node.id.replace(/^entity:/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'sans-code'}.md`;
export const personId = (node: Pick<KnowledgeNode, 'id'>): string => `/${PERSONS}/${personFile(node)}`;

export function renderPersons(snapshot: KnowledgeSnapshot): Map<string, string> {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const parties = snapshot.nodes.filter(isParty).sort((left, right) => compare(left.label, right.label) || compare(left.id, right.id));
  const pathOf = (id: string): string => text(nodes.get(id)?.data.path);
  const evidence = (link: KnowledgeLink): string => snapshot.citations
    .filter((citation) => citation.fromNodeId === link.fromNodeId && citation.toNodeId === link.toNodeId && citation.relation === link.relation)
    .map((citation) => ` — « ${citation.texte.replace(/\s+/g, ' ').trim()} » (${citation.pieceId ? `\`${pathOf(citation.pieceId) || nodes.get(citation.pieceId)?.label || citation.pieceId}\`` : citation.source})`)
    .join('');
  const linked = new Set(snapshot.links.filter((link) => link.relation !== MENTIONS).flatMap((link) => isParty(nodes.get(link.fromNodeId)) ? [link.toNodeId] : isParty(nodes.get(link.toNodeId)) ? [link.fromNodeId] : []));

  const fiche = (node: KnowledgeNode): string => {
    const author = authorOf(node.data);
    const side = text(node.data.partySide) || 'tiers';
    const frontmatter = { type: PERSON_TYPES[node.kind], title: node.label, description: `${PERSON_TYPES[node.kind]} · ${STATUS[author]}`, cco: CCO[node.kind], code: text(node.data.code), side, position: text(node.data.position), auteur: author };
    const own = snapshot.links.filter((link) => link.relation !== MENTIONS && (link.fromNodeId === node.id || link.toNodeId === node.id));
    const line = (link: KnowledgeLink): string => {
      const otherId = link.fromNodeId === node.id ? link.toNodeId : link.fromNodeId;
      const other = nodes.get(otherId);
      const target = other && isParty(other) ? `[${other.label}](${personId(other)})` : other?.label || otherId;
      const label = link.fromNodeId === node.id ? `${link.relation} → ${target}` : `${target} → ${link.relation}`;
      return `- ${label} — ${STATUS[authorOf(link.data)]}${evidence(link)}`;
    };
    const pieces = [...new Set(snapshot.links.filter((link) => link.relation === MENTIONS && link.toNodeId === node.id).map((link) => pathOf(link.fromNodeId)).filter(Boolean))].sort(compare);
    const designation = [
      `- Statut : ${STATUS[author]} (auteur : ${author})`,
      ...(frontmatter.code ? [`- Code : ${frontmatter.code}`] : []),
      `- Côté : ${side}`,
      ...(frontmatter.position ? [`- Position : ${frontmatter.position}`] : []),
      ...(text(node.data.legalForm) ? [`- Forme sociale : ${text(node.data.legalForm)}`] : []),
      ...(node.aliases.length ? [`- Variantes : ${[...node.aliases].sort(compare).join(' ; ')}`] : []),
    ];
    return [
      `---\n${stringify(frontmatter).trim()}\n---`,
      `# ${node.label}`,
      `## Désignation\n\n${designation.join('\n')}`,
      `## Liens\n\n${own.length ? own.map(line).sort(compare).join('\n') : 'Aucun lien.'}`,
      `## Pièces qui la mentionnent\n\n${pieces.length ? pieces.map((piece) => `- \`${piece}\``).join('\n') : 'Aucune.'}`,
    ].join('\n\n') + '\n';
  };

  const section = (author: string): string => {
    const entries = parties.filter((node) => authorOf(node.data) === author);
    return `## ${STATUS[author]}\n\n${entries.length ? entries.map((node) => `- [${node.label}](${personId(node)}) — ${PERSON_TYPES[node.kind]}`).join('\n') : 'Aucune fiche.'}`;
  };
  const loose = snapshot.nodes
    .filter((node) => node.kind !== 'document' && !isParty(node) && !node.id.startsWith('system:') && !linked.has(node.id))
    .sort((left, right) => compare(left.kind, right.kind) || compare(left.label, right.label));
  const index = [
    '# Personnes et organisations',
    'Fiches générées depuis la base du dossier. Ne les modifiez pas ici : écrivez dans la base.',
    ...ORDER.map(section),
    `## Éléments non rattachés\n\n${loose.length ? loose.map((node) => `- ${node.kind} : ${node.label}`).join('\n') : 'Aucun.'}`,
  ].join('\n\n') + '\n';

  return new Map([['index.md', index], ...parties.map((node): [string, string] => [personFile(node), fiche(node)])]);
}

export function writePersons(projectPath: string, snapshot: KnowledgeSnapshot): void {
  const root = bundleRoot(projectPath);
  if (!fs.existsSync(path.join(root, 'index.md'))) return;
  const folder = path.join(root, PERSONS);
  const files = renderPersons(snapshot);
  fs.mkdirSync(folder, { recursive: true });
  for (const name of fs.readdirSync(folder)) if (name.endsWith('.md') && !files.has(name)) fs.rmSync(path.join(folder, name), { force: true });
  for (const [name, content] of files) {
    const file = path.join(folder, name);
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content) fs.writeFileSync(file, content);
  }
}
