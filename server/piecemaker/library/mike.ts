import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import express from 'express';

import { parseFrontMatter } from '@/shared/frontmatter.js';

import type { createLibraryStore } from './store.js';

type RunCommand = (command: string, args: string[], timeout?: number) => { ok: boolean; output: string; status: number | null };

type MikeWorkflow = {
  id: string;
  name: string;
  description: string;
  directory: string;
};

const MIKE_MARKETPLACE = 'mike-workflows';
const MIKE_REPOSITORY = 'https://github.com/Open-Legal-Products/mike-workflows.git';
const MIKE_COLLECTIONS = { skill: 'assistant-workflows', tabular: 'tabular-review-workflows' } as const;
const MIKE_NAME = /^[a-z0-9][a-z0-9-]{0,79}$/;
const TABULAR_FORMATS: Record<string, string> = {
  text: 'text',
  date: 'date',
  monetary_amount: 'amount',
  percentage: 'text',
  bulleted_list: 'list',
  yes_no: 'yes_no',
  tag: 'tags',
};

const defaultRun: RunCommand = (command, args, timeout = 120000) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
  return { ok: result.status === 0, output: `${result.stdout || ''}${result.stderr || ''}`, status: result.status };
};

function isDirectory(target: string) {
  try { return fs.lstatSync(target).isDirectory(); } catch { return false; }
}

function isFile(target: string) {
  try { return fs.lstatSync(target).isFile(); } catch { return false; }
}

function workflowAt(directory: string): MikeWorkflow | null {
  const file = path.join(directory, 'SKILL.md');
  if (!isFile(file)) return null;
  const { data } = parseFrontMatter(fs.readFileSync(file, 'utf8'));
  const name = String(data.name || path.basename(directory));
  if (!MIKE_NAME.test(name)) return null;
  return {
    id: `${name}@${MIKE_MARKETPLACE}`,
    name: String(data.metadata?.['mike-display-name'] || name),
    description: typeof data.description === 'string' ? data.description : '',
    directory,
  };
}

export function listMikeWorkflows(repository: string, kind: keyof typeof MIKE_COLLECTIONS) {
  const collection = path.join(repository, MIKE_COLLECTIONS[kind]);
  if (!isDirectory(collection)) return [];
  const workflows: MikeWorkflow[] = [];
  for (const child of fs.readdirSync(collection, { withFileTypes: true })) {
    if (!child.isDirectory() || child.name.startsWith('.')) continue;
    const directory = path.join(collection, child.name);
    const direct = workflowAt(directory);
    if (direct) { workflows.push(direct); continue; }
    for (const nested of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!nested.isDirectory() || nested.name.startsWith('.')) continue;
      const workflow = workflowAt(path.join(directory, nested.name));
      if (workflow) workflows.push(workflow);
    }
  }
  return workflows.sort((left, right) => left.name.localeCompare(right.name));
}

export function mikeTabularTemplate(workflow: MikeWorkflow) {
  const raw = fs.readFileSync(path.join(workflow.directory, 'table-columns.yaml'), 'utf8');
  const parsed = parseFrontMatter(`---\n${raw}\n---\n`).data as { columns?: unknown };
  if (!Array.isArray(parsed.columns) || !parsed.columns.length) throw new Error(`Colonnes absentes : ${workflow.name}`);
  const columns = [...parsed.columns]
    .sort((left, right) => Number(left?.index ?? 0) - Number(right?.index ?? 0))
    .map((column) => {
      const format = TABULAR_FORMATS[String(column?.format)] || 'text';
      const tags = Array.isArray(column?.tags) ? column.tags.map(String) : [];
      return {
        name: String(column?.name || '').trim(),
        prompt: String(column?.prompt || '').trim(),
        format,
        ...(format === 'tags' && tags.length ? { tags } : {}),
      };
    });
  return {
    id: `mike-${workflow.id.split('@')[0]}`,
    name: workflow.name,
    description: workflow.description,
    columns,
    source: MIKE_MARKETPLACE,
    updatedAt: new Date().toISOString(),
  };
}

export function readLibraryTabularTemplates(directory: string) {
  if (!isDirectory(directory)) return [];
  const templates: Array<{ id: string; name: string; description: string; columns: unknown[] }> = [];
  for (const child of fs.readdirSync(directory)) {
    if (!child.endsWith('.json')) continue;
    try {
      const template = JSON.parse(fs.readFileSync(path.join(directory, child), 'utf8'));
      if (typeof template?.id === 'string' && `${template.id}.json` === child) templates.push(template);
    } catch {}
  }
  return templates.sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

export function createMikeRouter(store: ReturnType<typeof createLibraryStore>, userHome: string, run: RunCommand = defaultRun) {
  const repository = path.join(store.directory, MIKE_MARKETPLACE);
  const tabularDirectory = path.join(userHome, '.piecemaker', 'tabular-review', 'library');
  const router = express.Router();
  const registered = () => isDirectory(path.join(repository, '.git'));
  const importedSkillSources = () => new Set(store.list().flatMap((entry) => entry.sources));
  const workflow = (kind: keyof typeof MIKE_COLLECTIONS, id: unknown) => {
    const found = listMikeWorkflows(repository, kind).find((entry) => entry.id === id);
    if (!found) throw new Error('Élément absent du catalogue.');
    return found;
  };

  router.get('/plugin/marketplace', (req, res, next) => {
    if (req.query.scope !== 'mike') { next(); return; }
    const kind = String(req.query.kind);
    const base = { scope: 'mike', marketplaceName: MIKE_MARKETPLACE, registered: registered(), kind };
    if (kind !== 'skill' && kind !== 'tabular') { res.json({ ...base, plugins: [] }); return; }
    try {
      const imported = kind === 'skill' ? importedSkillSources() : new Set<string>();
      const templates = new Set(readLibraryTabularTemplates(tabularDirectory).map((template) => template.id));
      const plugins = listMikeWorkflows(repository, kind).map((entry) => ({
        id: entry.id,
        name: entry.name,
        description: entry.description,
        installed: kind === 'skill'
          ? imported.has(fs.realpathSync(path.join(entry.directory, 'SKILL.md')))
          : templates.has(`mike-${entry.id.split('@')[0]}`),
      }));
      res.json({ ...base, plugins });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });

  router.post('/plugin/marketplace/register', (req, res, next) => {
    if (req.body?.source || req.body?.scope !== 'mike') { next(); return; }
    const already = registered();
    const result = already
      ? run('git', ['-C', repository, 'pull', '--ff-only', '--quiet'])
      : run('git', ['clone', '--depth', '1', '--quiet', MIKE_REPOSITORY, repository]);
    if (!result.ok) {
      res.json({ ok: false, alreadyRegistered: already, name: MIKE_MARKETPLACE, reason: result.output || 'Téléchargement du catalogue Mike impossible.' });
      return;
    }
    res.json({ ok: true, alreadyRegistered: already, name: MIKE_MARKETPLACE });
  });

  router.post('/plugin/marketplace/acquire', (req, res, next) => {
    if (req.body?.scope !== 'mike') { next(); return; }
    try {
      if (req.body?.kind === 'tabular') {
        const template = mikeTabularTemplate(workflow('tabular', req.body?.id));
        fs.mkdirSync(tabularDirectory, { recursive: true });
        const file = path.join(tabularDirectory, `${template.id}.json`);
        const temporary = `${file}.tmp`;
        fs.writeFileSync(temporary, `${JSON.stringify(template, null, 2)}\n`);
        fs.renameSync(temporary, file);
        res.json({ ok: true });
        return;
      }
      const source = path.join(workflow('skill', req.body?.id).directory, 'SKILL.md');
      if (!store.importFile(source, 'skill', true)) throw new Error('Ce skill a été supprimé de la Bibliothèque.');
      res.json({ ok: true, enabled: false });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });

  router.get('/tabular', (_req, res) => {
    try { res.json({ templates: readLibraryTabularTemplates(tabularDirectory) }); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });

  router.delete('/tabular/:id', (req, res) => {
    const id = String(req.params.id);
    if (!/^[\w-]{1,80}$/.test(id)) { res.status(400).json({ error: 'Modèle invalide.' }); return; }
    try {
      fs.rmSync(path.join(tabularDirectory, `${id}.json`), { force: true });
      res.json({ templates: readLibraryTabularTemplates(tabularDirectory) });
    } catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });

  return router;
}
