import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import express from 'express';
import type { ChatCompletionRequest } from '@mistralai/mistralai/models/components';

import { getConnection, projectsDb } from '@/modules/database/index.js';
import { AppError, asyncHandler } from '@/shared/utils.js';

import { isLoopback } from '../knowledge/local-routes.js';

import { mistralSdkAuth } from './auth.service.js';

export function createMistralTabularBridge(options: {
  ensureProxy(): void;
  runInProject<T>(projectId: string, run: () => T): T;
  projects?: typeof projectsDb.getProjectPaths;
  localUserIds?(): number[];
  authenticate?: typeof mistralSdkAuth.createClient;
}) {
  const projects = options.projects ?? (() => projectsDb.getProjectPaths());
  const authenticate = options.authenticate ?? ((userId: number) => mistralSdkAuth.createClient(userId));
  const localUserIds = options.localUserIds ?? (() => (getConnection().prepare("SELECT DISTINCT user_id FROM user_credentials WHERE credential_type = 'mistral_sdk' AND is_active = 1 LIMIT 2").all() as { user_id: number }[]).map(row => row.user_id));
  const capabilities = new Map<string, { userId: number; project: string; expires: number }>();
  const origin = () => `http://127.0.0.1:${process.env.SERVER_PORT || process.env.PORT || 3002}/api/piecemaker/local/mistral-sdk/tabular`;
  const delegation = (userId: number, project: string) => {
    const registered = projects().filter(row => path.resolve(project) === path.resolve(row.project_path) || path.resolve(project).startsWith(path.resolve(row.project_path) + path.sep)).sort((a, b) => b.project_path.length - a.project_path.length)[0];
    if (!registered) throw new AppError('Dossier PieceMaker non enregistré.', { statusCode: 400 });
    for (const [token, cap] of capabilities) {
      if (cap.expires < Date.now()) capabilities.delete(token);
      else if (cap.userId === userId && cap.project === registered.project_path) return { token, origin: origin() };
    }
    const token = randomBytes(32).toString('hex');
    capabilities.set(token, { userId, project: registered.project_path, expires: Date.now() + 8 * 60 * 60 * 1000 });
    return { token, origin: origin() };
  };
  const localRouter = express.Router();
  const localDelegation = (project: string) => {
    const users = localUserIds();
    if (users.length !== 1) throw new AppError('Un seul compte Mistral connecté doit être disponible pour l’analyse tabulaire locale.', { statusCode: 409 });
    return delegation(users[0], project);
  };
  localRouter.post('/mistral-sdk/delegation', asyncHandler(async (request, response) => {
    if (!isLoopback(request)) throw new AppError('Accès réservé à la boucle locale.', { statusCode: 403 });
    response.json(localDelegation(String(request.body.project || '')));
  }));
  localRouter.post('/mistral-sdk/tabular', asyncHandler(async (request, response) => {
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const cap = capabilities.get(token);
    if (!isLoopback(request) || !cap || cap.expires < Date.now()) throw new AppError('Autorisation Mistral expirée. Relancez l’analyse depuis PieceMaker.', { statusCode: 401 });
    const body = request.body as Record<string, unknown>;
    if (!Array.isArray(body.messages) || body.messages.length > 200 || body.messages.some(message => !message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string')) {
      throw new AppError('Conversation Mistral invalide.', { statusCode: 400 });
    }
    if (typeof body.model !== 'string' || typeof body.system !== 'string' || !['inline', 'path'].includes(String(body.mode))) throw new AppError('Demande Mistral invalide.', { statusCode: 400 });
    const project = projects().find(row => row.project_path === cap.project);
    if (!project) throw new AppError('Dossier PieceMaker indisponible.', { statusCode: 400 });
    const controller = new AbortController();
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    const result = await options.runInProject(project.project_id, async () => {
      options.ensureProxy();
      const connection = authenticate(cap.userId);
      try {
        const model = ({ 'mistral-small': 'mistral-small-latest', 'mistral-medium-3.5': 'mistral-medium-latest', 'glm-5.3': 'zai-glm-5-3', 'glm-5.2': 'zai-glm-5-2' } as Record<string, string>)[body.model as string] || body.model as string;
        const messages: ChatCompletionRequest['messages'] = [{ role: 'system', content: body.system as string }, ...body.messages as ChatCompletionRequest['messages']];
        const projectRoot = await fs.realpath(cap.project);
        const directory = body.mode === 'path' ? await fs.realpath(String(body.readableDirectory || '')) : null;
        if (directory && directory !== projectRoot && !directory.startsWith(projectRoot + path.sep)) throw new Error('Lecture hors du dossier refusée.');
        for (let turn = 0; turn < 30; turn++) {
          const completion = await connection.client.chat.complete({
            model, messages, temperature: 0,
            ...(directory ? { tools: [{ type: 'function' as const, function: { name: 'Read', description: 'Lire un document Markdown du corpus autorisé.', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } }] } : {}),
          }, { signal: controller.signal });
          const answer = completion.choices?.[0]?.message;
          if (!answer) throw new Error('Réponse Mistral absente.');
          messages.push({ role: 'assistant', content: answer.content, ...(answer.toolCalls?.length ? { toolCalls: answer.toolCalls } : {}) });
          if (!answer.toolCalls?.length) return typeof answer.content === 'string' ? answer.content : answer.content?.filter(chunk => chunk.type === 'text').map(chunk => chunk.type === 'text' ? chunk.text : '').join('') || '';
          for (const call of answer.toolCalls) {
            let content: string;
            try {
              if (!directory || call.function.name !== 'Read') throw new Error('Outil de lecture indisponible.');
              const input = typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
              const file = await fs.realpath(path.resolve(directory, String(input.file_path || '')));
              if (!file.startsWith(directory + path.sep) || !/\.md$/i.test(file) || (await fs.stat(file)).size > 2000000) throw new Error('Lecture limitée aux Markdown du corpus autorisé.');
              content = await fs.readFile(file, 'utf8');
            } catch (error) { content = `Erreur de lecture : ${error instanceof Error ? error.message : String(error)}`; }
            messages.push({ role: 'tool', name: call.function.name, toolCallId: call.id, content });
          }
        }
        throw new Error('Limite de lectures atteinte pour cette cellule.');
      } finally { await connection.close(); }
    });
    response.json({ response: result });
  }));
  return localRouter;
}
