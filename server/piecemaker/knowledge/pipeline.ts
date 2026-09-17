import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import { persistScanResult, scanResultOperations } from '../../../plugins/piecemaker-dossier/src/scan-result.js';
import type { GlinerDocument, GlinerMappingDocument, JsonData } from '../../../plugins/piecemaker-dossier/src/types.js';

import type { KnowledgeScanProgress } from './scan-jobs.js';

type ProjectLookup = {
  getProjectById(projectId: string): { project_id: string; project_path: string } | null;
};

type PipelineOptions = {
  applicationRoot: string;
  projects: ProjectLookup;
  store: KnowledgeStore;
  pythonPath?: string;
};

type OriginalFile = { path: string; resource?: boolean };

type OriginalsPipeline = {
  caseMappingFile(caseRoot: string): string;
  listOriginals(caseRoot: string): Promise<OriginalFile[]>;
  runManagedPythonJob(options: {
    action: 'convert' | 'anonymize';
    script: string;
    args: string[];
    onProgress?: (progress: KnowledgeScanProgress) => void;
    signal?: AbortSignal;
  }): Promise<unknown>;
  writeCaseMapping(caseRoot: string, document: GlinerMappingDocument): unknown;
};

const require = createRequire(import.meta.url);
const {
  caseMappingFile,
  listOriginals,
  runManagedPythonJob,
  writeCaseMapping,
} = require('../vendor/websocket-server/originals-pipeline.cjs') as OriginalsPipeline;

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.odt', '.rtf', '.txt', '.md', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp']);

function relativeKey(projectPath: string, filePath: string): string {
  const relative = path.relative(projectPath, filePath).split(path.sep).join('/').normalize('NFC');
  return crypto.createHash('sha256').update(relative).digest('hex');
}

/** Pièces scannées par défaut : même liste que l'administration, récursive, hors Markdown généré. */
export async function defaultScanFiles(projectPath: string): Promise<string[]> {
  const root = fs.realpathSync(projectPath);
  const originals = await listOriginals(root);
  return originals
    .filter((file) => !file.resource)
    .map((file) => path.resolve(root, file.path));
}

async function safeFiles(projectPath: string, requested: unknown): Promise<string[]> {
  const root = fs.realpathSync(projectPath);
  const candidates = Array.isArray(requested) && requested.length ? requested : await defaultScanFiles(root);
  return [...new Set(candidates.map((candidate) => {
    const raw = String(candidate || '');
    const resolved = path.resolve(root, raw);
    const real = fs.realpathSync(resolved);
    if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw new Error('File outside project.');
    if (!fs.statSync(real).isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(real).toLowerCase())) throw new Error('Unsupported file.');
    return real;
  }))];
}

function parseObject(filePath: string): JsonData {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid pipeline output.');
  return parsed as JsonData;
}

function readDocumentIndex(projectPath: string): JsonData {
  const indexPath = path.join(projectPath, '.piecemaker', 'document-index.json');
  if (!fs.existsSync(indexPath)) return { documents: {} };
  return parseObject(indexPath);
}

function documentsFromIndex(projectPath: string, files: string[], documentIndex: JsonData): GlinerDocument[] {
  const entries = documentIndex.documents && typeof documentIndex.documents === 'object' && !Array.isArray(documentIndex.documents)
    ? documentIndex.documents as Record<string, JsonData>
    : {};
  return files.map((filePath) => {
    const id = relativeKey(projectPath, filePath);
    const metadata = entries[id] && typeof entries[id] === 'object' ? entries[id] : {};
    const entityCodes = Array.isArray(metadata.personnes_visees)
      ? metadata.personnes_visees.filter((value): value is string => typeof value === 'string')
      : [];
    return { id, name: path.basename(filePath), path: filePath, metadata, entityCodes };
  });
}

function pythonExecutable(explicit: string | undefined): string {
  if (explicit) return explicit;
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  const home = process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker');
  const candidate = process.platform === 'win32'
    ? path.join(home, 'venv', 'Scripts', 'python.exe')
    : path.join(home, 'venv', 'bin', 'python');
  return fs.existsSync(candidate) ? candidate : 'python3';
}

export function legacyExclusions(projectPath: string): string[] {
  const candidate = path.join(projectPath, 'Fichiers convertis PieceMaker', 'mapping_default.json');
  if (!fs.existsSync(candidate)) return [];
  try {
    const document = parseObject(candidate);
    return Array.isArray(document.ignored) ? document.ignored.map(textValue).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function mappingSeed(projectId: string, projectPath: string, store: KnowledgeStore): GlinerMappingDocument {
  const snapshot = store.snapshot(projectId);
  const mapping: Record<string, string> = {};
  const reverseMapping: Record<string, string[]> = {};
  const extractedData: Record<string, Record<string, JsonData>> = {};
  for (const entry of snapshot.mappings) {
    mapping[entry.real] = entry.masked;
    reverseMapping[entry.masked] = [...new Set([...(reverseMapping[entry.masked] || []), entry.real])];
  }
  for (const node of snapshot.nodes) {
    if (node.kind === 'document') continue;
    const code = textValue(node.data.code);
    const category = textValue(node.data.category) || 'autres';
    if (!code) continue;
    extractedData[category] ||= {};
    extractedData[category][code] = node.data;
  }
  const ignored = snapshot.exclusionsInitialized ? snapshot.exclusions || [] : legacyExclusions(projectPath);
  return { mapping, reverse_mapping: reverseMapping, extracted_data: extractedData, ignored };
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function withPythonPath<T>(pythonPath: string, run: () => Promise<T>): Promise<T> {
  const previous = process.env.PYTHON_PATH;
  process.env.PYTHON_PATH = pythonPath;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.PYTHON_PATH;
    else process.env.PYTHON_PATH = previous;
  }
}

export function createKnowledgePipeline(options: PipelineOptions) {
  const script = path.join(options.applicationRoot, 'server', 'piecemaker', 'vendor', 'websocket-server', 'scripts', 'convert_and_scan_pipeline.py');
  return {
    async scan(projectId: string, requestedFiles?: unknown, onProgress?: (progress: KnowledgeScanProgress) => void, signal?: AbortSignal) {
      const project = options.projects.getProjectById(projectId);
      if (!project) throw new Error('Project not found.');
      const projectPath = fs.realpathSync(project.project_path);
      const explicitFiles = Array.isArray(requestedFiles) && requestedFiles.length > 0;
      const files = await safeFiles(projectPath, requestedFiles);
      if (!files.length) throw new Error('No supported file to scan.');
      const mappingFile = caseMappingFile(projectPath);
      const stateFile = path.join(projectPath, '.piecemaker', 'anonymization-state.json');
      const outputDirectory = path.join(projectPath, 'Fichiers convertis PieceMaker');
      fs.mkdirSync(path.dirname(mappingFile), { recursive: true });
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.mkdirSync(outputDirectory, { recursive: true });
      fs.writeFileSync(mappingFile, JSON.stringify(mappingSeed(projectId, projectPath, options.store)), { mode: 0o600 });
      const args = [
        ...files,
        '-o',
        outputDirectory,
        '--mapping-file',
        mappingFile,
        '--case-root',
        projectPath,
        '--state-file',
        stateFile,
      ];
      if (!explicitFiles) args.push('--skip-existing');
      await withPythonPath(pythonExecutable(options.pythonPath), () => runManagedPythonJob({
        action: 'anonymize',
        script,
        args,
        onProgress,
        signal,
      }));
      const mapping = parseObject(mappingFile) as GlinerMappingDocument;
      writeCaseMapping(projectPath, mapping);
      const documents = documentsFromIndex(projectPath, files, readDocumentIndex(projectPath));
      const scanResult = { projectId, mapping, documents };
      const result = explicitFiles
        ? options.store.update({ projectId, operations: scanResultOperations(scanResult) })
        : persistScanResult(scanResult, options.store);
      return { ...result, documents: documents.length };
    },
  };
}
