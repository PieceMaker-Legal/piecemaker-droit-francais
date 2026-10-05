import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ColumnAction, ColumnFormat, Template, TemplateColumn } from '../shared.js';
import { COLUMN_ACTIONS, COLUMN_FORMATS } from '../shared.js';
import { PLUGIN_HOME, UserError, writeFileAtomic } from './paths.js';

const TEMPLATES_FILE = path.join(PLUGIN_HOME, 'templates.json');
export const MAX_COLUMNS = 40;

type TemplateSeed = Omit<Template, 'id' | 'updatedAt'>;

const column = (name: string, prompt: string, format: ColumnFormat = 'text', tags?: string[]): TemplateColumn => ({ name, prompt, format, ...(tags ? { tags } : {}) });
const action = (name: string, prompt: string, kind: ColumnAction): TemplateColumn => ({ name, prompt, format: 'text', action: kind });

export const SORTING_TEMPLATE: TemplateSeed = {
  name: 'Tri des pièces',
  description: 'Renomme les pièces en AAAA-MM-JJ_titre et les range dans les sous-dossiers du dossier. Les colonnes « Nouveau nom » et « Dossier cible » s’appliquent avec « Appliquer » ; modifiez leurs consignes pour changer la règle.',
  columns: [
    column('Date', 'Quelle est la date de la pièce (date de l’acte, de la décision, du courrier) ?', 'date'),
    column('Type de pièce', 'Quel est le type de pièce (jugement, contrat, courrier, mise en demeure…) ?'),
    column('Parties', 'Quelles sont les parties concernées par la pièce ?', 'list'),
    action('Nouveau nom', 'Propose le nom de fichier de la pièce, sans extension, au format AAAA-MM-JJ_<type de pièce> <précisions utiles : juridiction, parties, objet>, par exemple « 2024-01-09_Jugement du Tribunal judiciaire de Paris - Société A c- Société B ». N’utilise aucun des caractères / \\ : * ? " < > | (écris « c- » pour « contre »). Réponds par le nom seul. Si la date de la pièce est introuvable, réponds « Non trouvé ».', 'rename'),
    action('Dossier cible', 'Dans quel sous-dossier du dossier faut-il ranger cette pièce ? Réponds par un chemin relatif seul, avec « / » entre les niveaux (par exemple « Procédure/Jugements »). Réponds « Non trouvé » si la pièce doit rester où elle est.', 'move'),
  ],
};

export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  {
    name: 'Analyse de contrat',
    description: 'Clauses essentielles d’un contrat commercial.',
    columns: [
      column('Parties', 'Identifie les parties au contrat et leur qualité.', 'list'),
      column('Objet', 'Résume l’objet du contrat en une phrase.'),
      column('Date de signature', 'Quelle est la date de signature ou d’entrée en vigueur ?', 'date'),
      column('Durée', 'Quelle est la durée du contrat et ses modalités de renouvellement ?'),
      column('Prix', 'Quel est le prix ou la rémunération prévue, et ses modalités de paiement ?', 'amount'),
      column('Résiliation', 'Quelles sont les conditions et le préavis de résiliation ?'),
      column('Responsabilité', 'Existe-t-il une clause limitative ou exclusive de responsabilité ? Précise le plafond.'),
      column('Confidentialité', 'Le contrat contient-il une clause de confidentialité ?', 'yes_no'),
      column('Loi et juridiction', 'Quelle est la loi applicable et la juridiction compétente (ou clause d’arbitrage) ?'),
    ],
  },
  {
    name: 'Jurisprudence',
    description: 'Fiche d’arrêt : faits, problème de droit, solution, portée.',
    columns: [
      column('Juridiction et date', 'Quelle juridiction a rendu la décision, à quelle date, et sous quel numéro ?'),
      column('Parties', 'Qui sont les parties (demandeur, défendeur) ?', 'list'),
      column('Faits', 'Résume les faits utiles en trois phrases au plus.'),
      column('Problème de droit', 'Formule le problème de droit tranché.'),
      column('Solution', 'Quelle est la solution retenue (rejet, cassation, confirmation, infirmation) et son dispositif ?'),
      column('Motifs clés', 'Quels sont les motifs déterminants de la décision ?', 'list'),
      column('Textes visés', 'Quels textes (articles de code, lois) sont visés ou appliqués ?', 'list'),
    ],
  },
  {
    name: 'Pièces et correspondances',
    description: 'Inventaire des pièces d’un dossier contentieux.',
    columns: [
      column('Date', 'Quelle est la date du document ?', 'date'),
      column('Nature', 'Quelle est la nature du document ?', 'tags', ['Courrier', 'Email', 'Mise en demeure', 'Contrat', 'Facture', 'Compte rendu', 'Acte de procédure', 'Autre']),
      column('Émetteur et destinataire', 'Qui émet le document et à qui est-il adressé ?'),
      column('Points clés', 'Quels sont les points essentiels du document ?', 'list'),
      column('Délais et échéances', 'Le document mentionne-t-il un délai, une échéance ou une date butoir ?'),
      column('Intérêt pour le dossier', 'Ce document est-il favorable ou défavorable à notre client, et pourquoi ?'),
    ],
  },
];

// Modèles ajoutés après la première installation : proposés une seule fois,
// puis libres d'être modifiés ou supprimés.
const LATER_SEEDS: Record<string, TemplateSeed> = { 'tri-pieces': SORTING_TEMPLATE };

function seeded(seeds: TemplateSeed[]): Template[] {
  const now = new Date().toISOString();
  return seeds.map((template) => ({ ...template, id: randomUUID(), updatedAt: now }));
}

export function readTemplates(): Template[] {
  if (!fs.existsSync(TEMPLATES_FILE)) {
    const templates = seeded([...DEFAULT_TEMPLATES, ...Object.values(LATER_SEEDS)]);
    saveTemplates(templates, Object.keys(LATER_SEEDS));
    return templates;
  }
  let parsed: { templates?: unknown; seeds?: unknown };
  try {
    parsed = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')) as { templates?: unknown; seeds?: unknown };
  } catch {
    throw new UserError(`Fichier de modèles illisible : ${TEMPLATES_FILE}`);
  }
  const templates = Array.isArray(parsed.templates) ? parsed.templates.map(normalizeTemplate) : [];
  const seeds = Array.isArray(parsed.seeds) ? parsed.seeds.filter((seed): seed is string => typeof seed === 'string') : [];
  const missing = Object.keys(LATER_SEEDS).filter((seed) => !seeds.includes(seed));
  if (!missing.length) return templates;
  const next = [...templates, ...seeded(missing.map((seed) => LATER_SEEDS[seed]))];
  saveTemplates(next, [...seeds, ...missing]);
  return next;
}

function savedSeeds(): string[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')) as { seeds?: unknown };
    return Array.isArray(parsed.seeds) ? parsed.seeds.filter((seed): seed is string => typeof seed === 'string') : [];
  } catch {
    return [];
  }
}

function saveTemplates(templates: Template[], seeds = savedSeeds()): void {
  writeFileAtomic(TEMPLATES_FILE, `${JSON.stringify({ version: 1, seeds, templates }, null, 2)}\n`);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function normalizeColumn(value: unknown): TemplateColumn {
  const input = (value ?? {}) as Record<string, unknown>;
  const name = text(input.name, 120);
  const prompt = text(input.prompt, 4000);
  if (!name || !prompt) throw new UserError('Chaque question doit avoir un titre et une consigne.');
  const format = COLUMN_FORMATS.some((entry) => entry.value === input.format) ? input.format as ColumnFormat : 'text';
  const tags = Array.isArray(input.tags) ? input.tags.map((tag) => text(tag, 60)).filter(Boolean).slice(0, 30) : [];
  const action = COLUMN_ACTIONS.some((entry) => entry.value === input.action) ? input.action as ColumnAction : undefined;
  return { name, prompt, format, ...(format === 'tags' && tags.length ? { tags } : {}), ...(action ? { action } : {}) };
}

export function normalizeTemplate(value: unknown): Template {
  const input = (value ?? {}) as Record<string, unknown>;
  const name = text(input.name, 120);
  if (!name) throw new UserError('Le modèle doit avoir un nom.');
  const columns = Array.isArray(input.columns) ? input.columns.map(normalizeColumn) : [];
  if (!columns.length) throw new UserError('Le modèle doit contenir au moins une question.');
  if (columns.length > MAX_COLUMNS) throw new UserError(`Un modèle contient au plus ${MAX_COLUMNS} questions.`);
  for (const { value, label } of COLUMN_ACTIONS) {
    if (columns.filter((entry) => entry.action === value).length > 1) throw new UserError(`Une seule question peut porter l’action « ${label} ».`);
  }
  const id = typeof input.id === 'string' && /^[\w-]{1,80}$/.test(input.id) ? input.id : randomUUID();
  return { id, name, description: text(input.description, 500), columns, updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString() };
}

export function upsertTemplate(value: unknown): Template[] {
  const template = { ...normalizeTemplate(value), updatedAt: new Date().toISOString() };
  const templates = readTemplates();
  const index = templates.findIndex((entry) => entry.id === template.id);
  if (index >= 0) templates[index] = template;
  else templates.push(template);
  saveTemplates(templates);
  return templates;
}

export function deleteTemplate(id: unknown): Template[] {
  const templates = readTemplates().filter((entry) => entry.id !== id);
  saveTemplates(templates);
  return templates;
}

export function findTemplate(id: unknown): Template {
  const template = readTemplates().find((entry) => entry.id === id);
  if (!template) throw new UserError('Modèle introuvable.');
  return template;
}
