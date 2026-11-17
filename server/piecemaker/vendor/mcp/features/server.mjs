#!/usr/bin/env node
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { featureNamed, listFeatures, readFeature, readReference } from './catalogue.mjs';
import { openComments, openStore } from './store.mjs';
import { pmArgv } from '../../piecemaker-plugin/scripts/lib/herisson.mjs';

export const PM_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills', 'Skill-PieceMaker', 'scripts', 'pm.mjs');
const PM_TIMEOUT_MS = 10 * 60 * 1000;
const CHECK_LINES = 40;

export const INTENTS = { case: 'case', index: 'index', review: 'tabular_review', stamp: 'exhibits', reasoning: 'reasoning', deadlines: 'deadlines', catala: 'catala', draft: 'projects', other: 'case' };

export function runPmScript(args, cwd) {
  return new Promise((resolve) => {
    execFile(process.execPath, [PM_SCRIPT, ...args], { cwd, timeout: PM_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout), stderr: String(stderr || (error && !stdout ? error.message : '')) });
    });
  });
}

const text = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }], isError });
const failure = (error) => text(`${error.code ? `${error.code}: ` : ''}${error.message}`, true);
const pmResult = (result) => text([result.stdout, result.stderr].map((part) => String(part || '').trim()).filter(Boolean).join('\n') || `exit code ${result.code}`, result.code !== 0);

function required(value, name, action) {
  if (value === undefined || value === null || value === '') throw Object.assign(new Error(`${action} needs "${name}".`), { code: 'invalid_argument' });
  return value;
}

function featureText(name) {
  const feature = readFeature(name);
  return [
    `# Feature ${feature.name} — ${feature.title}`,
    feature.description,
    feature.tab ? `Tab: open it with Feature open ${feature.name}.` : 'No tab of its own: Feature open needs a file.',
    ...(feature.commands.length ? ['\n## Commands (Feature run name=' + feature.name + ' command=<name> args={...})\n', ...feature.commands.map((command) => `- ${command.name}(${command.parameters.join(', ')}): ${command.role} [pm ${command.pm}]`)] : []),
    ...feature.skills.flatMap((skill) => [
      `\n## Skill ${skill.name}\n`,
      skill.instructions.trim(),
      ...(skill.references.length ? [`\nReferences (Feature read ${feature.name} path=<reference>):`, ...skill.references.map((reference) => `- ${reference}`)] : []),
    ]),
  ].join('\n');
}

export function createServer({ root = process.cwd(), pm = runPmScript } = {}) {
  const server = new McpServer({ name: 'features', version: '0.1.0' });
  const store = openStore(root);
  const comments = openComments(root);
  const caseArgs = (args) => [...args, '--dossier', root];

  server.registerTool('Feature', {
    description: 'PieceMaker features: the tabs of the case. For new work, call quickstart first: it returns the feature, its skills, its commands, the case state and the first calls. Otherwise list, then read a feature before you work with it. run executes a command of the feature (instead of the pm shell command); open and close show or hide its tab.',
    inputSchema: {
      action: z.enum(['quickstart', 'list', 'read', 'run', 'open', 'close']),
      intent: z.enum(Object.keys(INTENTS)).optional().describe('quickstart: what the lawyer asks for (review = tabular review, stamp = exhibits, draft = write a document).'),
      request: z.string().optional().describe('quickstart: the request in one sentence.'),
      name: z.string().optional().describe('Feature name, from list.'),
      path: z.string().optional().describe('read: one reference of the feature, as listed by read.'),
      command: z.string().optional().describe('run: command name, as listed by read.'),
      args: z.record(z.string(), z.any()).optional().describe('run: parameters of the command, by name.'),
      file: z.string().optional().describe('open, close: a file of the case, relative to the case folder.'),
    },
  }, async ({ action, intent, request, name, path: reference, command, args, file }) => {
    try {
      if (action === 'list') return text(listFeatures());
      if (action === 'quickstart') {
        const feature = INTENTS[required(intent, 'intent', action)];
        const check = await pm(caseArgs(['check']), root);
        const lines = String(check.stdout || check.stderr).trim().split('\n');
        return text([
          ...(request ? [`Request: ${request}`] : []),
          featureText(feature),
          `\n## Case state (pm check)\n`,
          ...lines.slice(0, CHECK_LINES), ...(lines.length > CHECK_LINES ? [`… ${lines.length - CHECK_LINES} more line(s): Feature run case check_case.`] : []),
          `\n## First calls\n`,
          ...readFeature(feature).start.map((call, index) => `${index + 1}. ${call}`),
        ].join('\n'));
      }
      required(name, 'name', action);
      if (action === 'read') return text(reference ? readReference(name, reference) : featureText(name));
      if (action === 'run') return pmResult(await pm(caseArgs(pmArgv(name, required(command, 'command', action), args ?? {})), root));
      const feature = featureNamed(name);
      const target = file && feature.volet === 'tabular_review' ? ['tabular_review', file] : file || !feature.volet ? ['fichier', required(file, 'file', action)] : [feature.volet];
      return pmResult(await pm(caseArgs(['tab', action === 'open' ? 'afficher' : 'fermer', ...target]), root));
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool('FeatureData', {
    description: 'Data store of a feature, one JSON document per path (collection/doc, odd segments = collection). set replaces, update merges fields (dotted paths, {"__delete__": true} removes a field) and needs an existing document, if_version guards against a concurrent write, batch is all or nothing. Feature case also reads okf, deadlines and memories of the case (read-only).',
    inputSchema: {
      action: z.enum(['get', 'list', 'query', 'set', 'update', 'str_replace', 'delete', 'batch']),
      feature: z.string().describe('Feature name, from Feature list.'),
      path: z.string().optional().describe('Document path (get, set, update, str_replace, delete) or collection path (list, query).'),
      data: z.record(z.string(), z.any()).optional(),
      if_version: z.number().int().optional().describe('Write only if the document has this version (0 = must not exist).'),
      field: z.string().optional().describe('str_replace: dotted path of a string field.'),
      old_str: z.string().optional(),
      new_str: z.string().optional(),
      where: z.array(z.tuple([z.string(), z.string(), z.any()])).optional().describe('query: [field, operator, value] clauses; operators ==, !=, <, <=, >, >=, in, not-in, array-contains, array-contains-any.'),
      orderBy: z.union([z.string(), z.tuple([z.string(), z.enum(['asc', 'desc'])])]).optional(),
      limit: z.number().int().positive().optional(),
      after: z.string().optional().describe('list: the "next" id of the previous page.'),
      operations: z.array(z.object({
        op: z.enum(['set', 'update', 'str_replace', 'delete']),
        path: z.string(),
        data: z.record(z.string(), z.any()).optional(),
        if_version: z.number().int().optional(),
        field: z.string().optional(),
        old_str: z.string().optional(),
        new_str: z.string().optional(),
      })).optional(),
    },
  }, async (input) => {
    const { action, feature, path: docPath } = input;
    const options = input.if_version === undefined ? {} : { if_version: input.if_version };
    try {
      if (action !== 'batch') required(docPath, 'path', action);
      switch (action) {
        case 'get': return text(store.get(feature, docPath));
        case 'list': return text(store.list(feature, docPath, { limit: input.limit, after: input.after }));
        case 'query': return text(store.query(feature, docPath, { where: input.where, orderBy: input.orderBy, limit: input.limit }));
        case 'set': return text(await store.set(feature, docPath, required(input.data, 'data', action), options));
        case 'update': return text(await store.update(feature, docPath, required(input.data, 'data', action), options));
        case 'str_replace': return text(await store.strReplace(feature, docPath, required(input.field, 'field', action), required(input.old_str, 'old_str', action), input.new_str ?? '', options));
        case 'delete': return text(await store.delete(feature, docPath, options));
        default: return text(await store.batch(feature, required(input.operations, 'operations', action)));
      }
    } catch (error) {
      return failure(error);
    }
  });

  server.registerTool('FeatureComments', {
    description: 'Comments of the lawyer on elements of a feature tab. read returns the open threads with their anchor (tab, file, lines); reply answers a thread; resolve closes it once the request is done.',
    inputSchema: {
      action: z.enum(['read', 'reply', 'resolve']),
      feature: z.string().describe('Feature name, from Feature list.'),
      id: z.string().optional().describe('Thread id (reply, resolve).'),
      text: z.string().optional().describe('reply: the answer.'),
      resolved: z.boolean().optional().describe('read: include resolved threads.'),
    },
  }, async ({ action, feature, id, text: answer, resolved }) => {
    try {
      featureNamed(feature);
      if (action === 'read') return text(comments.read(feature, { resolved }));
      required(id, 'id', action);
      if (action === 'reply') return text(await comments.reply(feature, id, required(answer, 'text', action)));
      return text(await comments.resolve(feature, id));
    } catch (error) {
      return failure(error);
    }
  });

  return server;
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) await createServer().connect(new StdioServerTransport());
