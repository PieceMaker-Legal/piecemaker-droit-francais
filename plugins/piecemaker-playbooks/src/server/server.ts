import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createHandler } from './api.js';
import { generate, PlaybookJobs } from './jobs.js';
import { PlaybookError } from '../domain/model.js';
import { assertProject, protectedProjects } from '../../../piecemaker-tabular-review/src/server/runtime.js';

const runtime = JSON.parse(fs.readFileSync(new URL('../runtime.json', import.meta.url), 'utf8')) as { applicationRoot: string; secret: string };
if (!runtime.secret || runtime.secret.length < 32) throw new Error('Configuration du plugin Playbooks invalide.');
const require = createRequire(path.join(runtime.applicationRoot, 'package.json'));
const jobs = new PlaybookJobs(generate);
const server = http.createServer(createHandler({ secret: runtime.secret, jobs,
  project: (value) => {
    try { return assertProject(value); }
    catch { throw new PlaybookError('Le dossier est invalide ou n’est pas enregistré dans PieceMaker.', 403); }
  },
  protected: (project) => protectedProjects().includes(project),
  editorStyle: () => fs.readFileSync(require.resolve('@eigenpal/docx-editor-react/styles.css'), 'utf8') }));
server.listen(Number(process.env.PORT || 0), '127.0.0.1', () => {
  const address = server.address();
  if (address && typeof address === 'object') console.log(JSON.stringify({ ready: true, port: address.port }));
});
const close = () => { jobs.close(); server.close(() => process.exit(0)); };
process.on('SIGTERM', close);
process.on('SIGINT', close);
