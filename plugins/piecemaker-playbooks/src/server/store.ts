import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { Playbook, Run } from '../shared.js';
import { PlaybookError, record, rulesFrom, text } from '../domain/model.js';
import { safePath } from './documents.js';

export function hash(bytes: Buffer | string): string { return createHash('sha256').update(bytes).digest('hex'); }

function id(value: string): string {
  if (!/^[a-f0-9-]{36}$/.test(value)) throw new PlaybookError('Identifiant invalide.');
  return value;
}

export function atomic(file: string, bytes: string | Buffer): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temporary, bytes, { flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

export class PlaybookStore {
  constructor(readonly project: string) {}

  file(relative: string, exists = false): string { return safePath(this.project, relative, exists); }

  list(): Playbook[] {
    const directory = this.file('Playbooks');
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((file) => /^[a-f0-9-]{36}\.json$/.test(file)).map((file) => this.get(file.slice(0, -5)));
  }

  get(key: string): Playbook { return JSON.parse(fs.readFileSync(this.file(`Playbooks/${id(key)}.json`, true), 'utf8')); }

  save(raw: unknown, imported?: Pick<Playbook, 'sources' | 'sourcePath' | 'sourceHash'>): Playbook {
    const data = record(raw);
    const key = typeof data.id === 'string' ? id(data.id) : randomUUID();
    const previous = data.id && fs.existsSync(this.file(`Playbooks/${key}.json`)) ? this.get(key) : null;
    if (data.id && !previous && !imported) throw new PlaybookError('Playbook introuvable.', 404);
    if (previous && previous.revision !== data.revision) throw new PlaybookError('Le guide a changé. Rechargez-le avant de sauvegarder.', 409);
    const name = text(data.name, 200);
    if (!name) throw new PlaybookError('Donnez un nom au playbook.');
    const sources = imported?.sources ?? previous?.sources ?? [];
    const rules = rulesFrom(data.rules, imported?.sources);
    if (rules.some((rule) => rule.sourceRefs.some((ref) => !sources.some((source) => source.id === ref)))) throw new PlaybookError('Référence de source inconnue.');
    if (JSON.stringify(rules).length > 100000) throw new PlaybookError('Les règles dépassent 100 000 caractères.');
    const now = new Date().toISOString();
    const playbook: Playbook = {
      id: key, revision: randomUUID(), name, representedParty: text(data.representedParty, 300), rules,
      sources, sourcePath: imported?.sourcePath ?? previous?.sourcePath ?? null,
      sourceHash: imported?.sourceHash ?? previous?.sourceHash ?? null,
      validated: data.validated === true, createdAt: previous?.createdAt ?? now, updatedAt: now,
    };
    atomic(this.file(`Playbooks/${key}.json`), JSON.stringify(playbook, null, 2));
    return playbook;
  }

  remove(key: string): void { fs.unlinkSync(this.file(`Playbooks/${id(key)}.json`, true)); }

  runFile(key: string, filename = 'run.json'): string {
    if (!['run.json', 'source.docx', 'document-revu.docx', 'publication.json'].includes(filename)) throw new PlaybookError('Fichier de revue invalide.');
    return this.file(`Revues contractuelles/${id(key)}/${filename}`);
  }

  runs(): Run[] {
    const directory = this.file('Revues contractuelles');
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).filter((name) => /^[a-f0-9-]{36}$/.test(name))
      .filter((name) => fs.existsSync(this.runFile(name))).map((name) => this.run(name)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  run(key: string): Run {
    const file = this.runFile(key);
    if (!fs.existsSync(file)) throw new PlaybookError('Revue introuvable.', 404);
    const run = JSON.parse(fs.readFileSync(file, 'utf8')) as Run;
    const receipt = this.runFile(key, 'publication.json');
    if (fs.existsSync(receipt)) {
      const pending = JSON.parse(fs.readFileSync(receipt, 'utf8')) as { previousHash: string; nextHash: string; findingId: string | null };
      const documentHash = hash(fs.readFileSync(this.runFile(key, 'document-revu.docx')));
      if (documentHash === pending.nextHash) {
        run.outputHash = pending.nextHash;
        if (pending.findingId) {
          const finding = run.findings.find((entry) => entry.id === pending.findingId);
          if (finding) finding.applied = true;
        }
        this.writeRun(run);
      } else if (documentHash !== pending.previousHash) throw new PlaybookError('La copie Word a changé pendant une sauvegarde interrompue.', 409);
      fs.unlinkSync(receipt);
    }
    return run;
  }

  writeRun(run: Run): Run {
    run.updatedAt = new Date().toISOString();
    atomic(this.runFile(run.id), JSON.stringify(run, null, 2));
    return run;
  }

  recover(active: Set<string>): void {
    for (const run of this.runs()) {
      if (run.status === 'running' && !active.has(run.id)) {
        this.writeRun({ ...run, status: 'interrupted', stage: 'interrupted', error: 'Traitement interrompu. Vous pouvez le reprendre.' });
      }
    }
  }
}
