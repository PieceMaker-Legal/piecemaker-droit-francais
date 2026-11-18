import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { AiSettings, Playbook, Run } from '../shared.js';
import { findingsFrom, parseModelJson, PlaybookError, rulesFrom, text } from '../domain/model.js';
import { compilationPrompt, reviewPrompt, SYSTEM } from '../domain/prompts.js';
import { assertProxyOrigin, openSession, probeProxy, sessionEnvironment } from '../../../piecemaker-tabular-review/src/server/runtime.js';
import { readDocument } from './documents.js';
import { atomic, hash, PlaybookStore } from './store.js';

export type Generate = (settings: AiSettings, project: string, prompt: string, signal: AbortSignal) => Promise<string>;

export const generate: Generate = async (settings, project, prompt, signal) => {
  const origin = assertProxyOrigin(settings.proxyOrigin);
  await probeProxy(origin);
  const session = openSession({ provider: settings.provider, model: settings.model, mode: 'inline', system: SYSTEM,
    readableDirectory: project, environment: sessionEnvironment(origin), signal });
  try { return await session.send(prompt); } finally { session.close(); }
};

export class PlaybookJobs {
  private active = new Map<string, AbortController>();

  constructor(private readonly generate: Generate) {}

  recover(store: PlaybookStore): void { store.recover(new Set(this.active.keys())); }

  async start(store: PlaybookStore, kind: Run['kind'], sourcePath: string, settings: AiSettings, playbook: Playbook | null, mode: Run['mode']): Promise<Run> {
    if (kind === 'review' && !playbook?.validated) throw new PlaybookError('Validez les règles du playbook avant de lancer une revue.');
    if (this.active.size >= 2) throw new PlaybookError('Deux traitements sont déjà en cours. Attendez leur fin.', 409);
    const document = await readDocument(store.project, sourcePath);
    if (this.active.size >= 2) throw new PlaybookError('Deux traitements sont déjà en cours. Attendez leur fin.', 409);
    if (kind === 'import' && JSON.stringify(document.sources).length > 150000) throw new PlaybookError('Le guide dépasse 150 000 caractères structurés.');
    const now = new Date().toISOString();
    const run: Run = {
      id: randomUUID(), attempt: randomUUID(), kind, status: 'running', stage: 'prepared', error: null, playbook,
      sourcePath, sourceHash: hash(document.bytes), sourceText: document.text, sources: document.sources,
      documentType: document.type, mode, summary: '', findings: [], outputHash: null,
      settings: { provider: settings.provider, model: settings.model }, createdAt: now, updatedAt: now,
    };
    store.writeRun(run);
    if (document.type === '.docx') atomic(store.runFile(run.id, 'source.docx'), document.bytes);
    this.launch(store, run, settings);
    return run;
  }

  retry(store: PlaybookStore, key: string, settings: AiSettings): Run {
    const run = store.run(key);
    if (run.status === 'completed' || this.active.has(key)) throw new PlaybookError('Ce traitement ne peut pas être relancé.', 409);
    if (run.settings.provider !== settings.provider || run.settings.model !== settings.model) throw new PlaybookError('Conservez le fournisseur et le modèle de ce traitement pour le reprendre.');
    if (this.active.size >= 2) throw new PlaybookError('Deux traitements sont déjà en cours.', 409);
    run.status = 'running'; run.error = null; run.stage = 'prepared'; run.attempt = randomUUID();
    store.writeRun(run);
    this.launch(store, run, settings);
    return run;
  }

  cancel(store: PlaybookStore, key: string): Run {
    this.active.get(key)?.abort();
    const run = store.run(key);
    if (run.status === 'running') store.writeRun({ ...run, status: 'cancelled', stage: 'cancelled', error: 'Traitement arrêté. Les données sont conservées.' });
    return store.run(key);
  }

  close(): void { for (const controller of this.active.values()) controller.abort(); }

  private launch(store: PlaybookStore, run: Run, settings: AiSettings): void {
    const controller = new AbortController();
    void Promise.resolve().then(() => this.work(store, run, settings, controller.signal))
      .catch(() => undefined).finally(() => this.active.delete(run.id));
    this.active.set(run.id, controller);
  }

  private async work(store: PlaybookStore, run: Run, settings: AiSettings, signal: AbortSignal): Promise<void> {
    const attempt = run.attempt;
    const currentAttempt = () => {
      signal.throwIfAborted();
      const current = store.run(run.id);
      if (current.attempt !== attempt || current.status !== 'running') throw new PlaybookError('Ce traitement a été remplacé ou interrompu.', 409);
    };
    try {
      currentAttempt();
      run.stage = run.kind === 'import' ? 'compiling' : 'reviewing';
      store.writeRun(run);
      let prompt = run.kind === 'import' ? compilationPrompt(run.sources) : reviewPrompt(run.playbook!, run.sourceText, run.mode);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const output = await this.generate(settings, store.project, prompt, signal);
        currentAttempt();
        let data: Record<string, unknown>;
        try {
          data = parseModelJson(output);
          if (run.kind === 'import') rulesFrom(data.rules, run.sources);
          else findingsFrom(data.findings, run.playbook!.rules, run.sourceText);
        } catch (error) {
          if (attempt) throw error;
          run.stage = 'repairing'; store.writeRun(run);
          prompt += `\nLa réponse précédente a échoué : ${error instanceof PlaybookError ? error.message : 'format incorrect'}. Recommence avec un JSON complet et les références exactes.`;
          continue;
        }
        if (run.kind === 'import') {
          const previous = store.list().find((playbook) => playbook.id === run.id);
          run.playbook = store.save({ ...data, id: run.id, revision: previous?.revision, validated: false },
            { sources: run.sources, sourcePath: run.sourcePath, sourceHash: run.sourceHash });
          run.summary = 'Guide compilé. Vérifiez et validez les règles avant utilisation.';
        } else {
          run.summary = text(data.summary, 10000);
          run.findings = findingsFrom(data.findings, run.playbook!.rules, run.sourceText);
          if (run.documentType === '.docx') {
            const original = fs.readFileSync(store.runFile(run.id, 'source.docx'));
            atomic(store.runFile(run.id, 'document-revu.docx'), original);
            run.outputHash = hash(original);
          }
        }
        currentAttempt();
        run.status = 'completed'; run.stage = 'completed'; store.writeRun(run);
        return;
      }
    } catch (error) {
      const current = store.run(run.id);
      if (current.status !== 'running' || current.attempt !== attempt) return;
      const message = error instanceof PlaybookError ? error.message : signal.aborted
        ? 'Traitement interrompu. Vous pouvez le reprendre.'
        : settings.provider === 'claude' && error instanceof Error && /Failed to authenticate.*(?:time limit|cannot be renewed|expired)/i.test(error.message)
        ? 'La connexion Claude a expiré. Reconnectez votre compte Claude, puis reprenez ce traitement.'
        : 'La session IA n’a pas abouti. Vérifiez votre connexion et votre compte, puis reprenez le traitement.';
      store.writeRun({ ...current, status: signal.aborted ? 'interrupted' : 'failed', stage: 'failed', error: message });
    }
  }
}
