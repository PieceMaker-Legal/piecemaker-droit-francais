import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { query } from '@anthropic-ai/claude-agent-sdk';

import type { ReviewInvocation } from '../modules/piecemaker-reasoning/citation-review-model.js';
import { resolveClaudeCodeExecutablePath } from '../shared/claude-cli-path.js';

import type { mistralSdkAuth } from './mistral-sdk/auth.service.js';

export function createCitationTransport(options: {
  runInCase<T>(cwd: string, run: () => Promise<T>): Promise<T>;
  ensureProxy(): void;
  authenticate: typeof mistralSdkAuth.createClient;
}) {
  return (request: ReviewInvocation) => options.runInCase(request.cwd, async () => {
    options.ensureProxy();
    const controller = new AbortController();
    const directory = await mkdtemp(path.join(tmpdir(), 'piecemaker-citations-'));
    const timer = setTimeout(() => controller.abort(), 240_000);
    try {
      if (request.provider === 'mistral') {
        const connection = options.authenticate(request.userId);
        try {
          const completion = await connection.client.chat.complete({
            model: request.model, temperature: 0, maxTokens: 16000,
            messages: [{ role: 'system', content: request.prompt }, { role: 'user', content: request.payload }],
            responseFormat: { type: 'json_schema', jsonSchema: { name: 'citation_review', schemaDefinition: request.schema, strict: true } },
          }, { signal: controller.signal });
          const answer = completion.choices?.[0]?.message;
          if (answer?.toolCalls?.length) throw new Error('Outil inattendu pendant la vérification.');
          const content = typeof answer?.content === 'string' ? answer.content : answer?.content?.filter((part) => part.type === 'text').map((part) => part.type === 'text' ? part.text : '').join('');
          if (!content) throw new Error('Réponse Mistral absente.');
          return JSON.parse(content);
        } finally { await connection.close(); }
      }
      if (request.provider === 'claude') {
        let result: unknown;
        let completed = false;
        for await (const message of query({ prompt: request.payload, options: {
          model: request.model, systemPrompt: request.prompt, cwd: directory,
          pathToClaudeCodeExecutable: resolveClaudeCodeExecutablePath(),
          tools: [], mcpServers: {}, settingSources: [], persistSession: false, maxTurns: 2,
          outputFormat: { type: 'json_schema', schema: request.schema }, abortController: controller,
          env: { ...process.env, CLAUDECODE: undefined },
        } })) {
          if (message.type === 'result') {
            if ('api_error_status' in message && message.api_error_status === 429) throw new TypeError('Quota Claude atteint : réessayez après sa réinitialisation.');
            if (message.subtype !== 'success' || message.is_error) throw new Error(`Session Haiku indisponible ou incomplète (${message.subtype}).`, { cause: message });
            result = message.structured_output ?? JSON.parse(message.result);
            completed = true;
          }
        }
        if (!completed) throw new Error('Réponse Haiku absente.');
        return result;
      }
      if (request.provider !== 'codex') throw new Error('Fournisseur de vérification indisponible.');
      await writeFile(path.join(directory, 'instructions.md'), request.prompt);
      await writeFile(path.join(directory, 'schema.json'), JSON.stringify(request.schema));
      const launcher = createRequire(import.meta.url).resolve('@openai/codex/bin/codex.js');
      const child = spawn(process.execPath, [launcher, 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '-C', directory, '-s', 'read-only', '-m', request.model, '-c', 'model_reasoning_effort="high"', '-c', 'service_tier="default"', '-c', `model_instructions_file=${JSON.stringify(path.join(directory, 'instructions.md'))}`, '--json', '--output-schema', path.join(directory, 'schema.json'), '-'], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'], signal: controller.signal,
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-1000); });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
        child.stdin.on('error', reject);
        child.stdin.end(request.payload);
      });
      if (code !== 0) throw new Error(`Codex indisponible : ${stderr.trim().split('\n').at(-1) || `sortie ${code}`}`);
      const events = stdout.trim().split('\n').map((line) => JSON.parse(line));
      const items = events.filter((event) => event.type === 'item.completed').map((event) => event.item);
      if (events.some((event) => ['error', 'turn.failed'].includes(event.type)) || events.filter((event) => event.type === 'turn.completed').length !== 1 || items.some((item) => !['agent_message', 'reasoning'].includes(item.type))) throw new Error('Session de vérification invalide.');
      const messages = items.filter((item) => item.type === 'agent_message');
      if (messages.length !== 1) throw new Error('Réponse Codex absente.');
      return JSON.parse(messages[0].text);
    } finally {
      clearTimeout(timer);
      await rm(directory, { recursive: true, force: true });
    }
  });
}
