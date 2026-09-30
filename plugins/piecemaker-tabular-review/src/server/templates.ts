import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import type { ColumnFormat, Template, TemplateColumn } from '../shared.js';
import { COLUMN_FORMATS } from '../shared.js';
import { PLUGIN_HOME, UserError, writeFileAtomic } from './paths.js';

const TEMPLATES_FILE = path.join(PLUGIN_HOME, 'templates.json');
const MAX_COLUMNS = 40;

type TemplateSeed = Omit<Template, 'id' | 'updatedAt'>;

const column = (name: string, prompt: string, format: ColumnFormat = 'text', tags?: string[]): TemplateColumn => ({ name, prompt, format, ...(tags ? { tags } : {}) });

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

function seeded(): Template[] {
  const now = new Date().toISOString();
  return DEFAULT_TEMPLATES.map((template) => ({ ...template, id: randomUUID(), updatedAt: now }));
}

export function readTemplates(): Template[] {
  if (!fs.existsSync(TEMPLATES_FILE)) {
    const templates = seeded();
    saveTemplates(templates);
    return templates;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(TEMPLATES_FILE, 'utf8')) as { templates?: unknown };
    return Array.isArray(parsed.templates) ? parsed.templates.map(normalizeTemplate) : [];
  } catch {
    throw new UserError(`Fichier de modèles illisible : ${TEMPLATES_FILE}`);
  }
}

function saveTemplates(templates: Template[]): void {
  writeFileAtomic(TEMPLATES_FILE, `${JSON.stringify({ version: 1, templates }, null, 2)}\n`);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeColumn(value: unknown): TemplateColumn {
  const input = (value ?? {}) as Record<string, unknown>;
  const name = text(input.name, 120);
  const prompt = text(input.prompt, 4000);
  if (!name || !prompt) throw new UserError('Chaque question doit avoir un titre et une consigne.');
  const format = COLUMN_FORMATS.some((entry) => entry.value === input.format) ? input.format as ColumnFormat : 'text';
  const tags = Array.isArray(input.tags) ? input.tags.map((tag) => text(tag, 60)).filter(Boolean).slice(0, 30) : [];
  return { name, prompt, format, ...(format === 'tags' && tags.length ? { tags } : {}) };
}

export function normalizeTemplate(value: unknown): Template {
  const input = (value ?? {}) as Record<string, unknown>;
  const name = text(input.name, 120);
  if (!name) throw new UserError('Le modèle doit avoir un nom.');
  const columns = Array.isArray(input.columns) ? input.columns.map(normalizeColumn) : [];
  if (!columns.length) throw new UserError('Le modèle doit contenir au moins une question.');
  if (columns.length > MAX_COLUMNS) throw new UserError(`Un modèle contient au plus ${MAX_COLUMNS} questions.`);
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
