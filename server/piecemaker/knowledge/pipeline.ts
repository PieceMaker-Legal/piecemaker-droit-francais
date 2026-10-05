import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { findApplicationRoot, getModuleDirectory } from '../../shared/utils.js';
import { resolveKnowledgeDatabasePath } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import type { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import { persistScanResult, scanResultOperations } from '../../../plugins/piecemaker-dossier/src/scan-result.js';
import type { GlinerDocument, GlinerMappingDocument, JsonData } from '../../../plugins/piecemaker-dossier/src/types.js';

import { OcrRequiredError } from './scan-jobs.js';
import type { KnowledgeScanProgress, OcrMissingChoice } from './scan-jobs.js';

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

type RenamedPiece = { previous: string; current: string; markdown: string | null };

type CasePiece = { path: string; status: string; markdown: string | null };

type OriginalsPipeline = {
  listOriginals(caseRoot: string): Promise<Array<OriginalFile & { status: string }>>;
  runManagedPythonJob(options: {
    action: 'convert' | 'anonymize';
    script: string;
    args: string[];
    onProgress?: (progress: KnowledgeScanProgress) => void;
    signal?: AbortSignal;
    input?: string;
    onMapping?: (mapping: unknown) => void;
    onOcrRequired?: (payload: unknown) => void;
  }): Promise<unknown>;
};

const require = createRequire(import.meta.url);
const {
  listOriginals,
  runManagedPythonJob,
} = require(path.join(
  findApplicationRoot(getModuleDirectory(import.meta.url)),
  'server',
  'piecemaker',
  'vendor',
  'websocket-server',
  'originals-pipeline.cjs',
)) as OriginalsPipeline;
const { renamePiece } = require(path.join(
  findApplicationRoot(getModuleDirectory(import.meta.url)),
  'server',
  'piecemaker',
  'vendor',
  'websocket-server',
  'renamed-originals.cjs',
)) as { renamePiece(caseRoot: string, piecePath: string, name: unknown, directory?: unknown): Promise<RenamedPiece> };
const { invalidateOriginals } = require(path.join(
  findApplicationRoot(getModuleDirectory(import.meta.url)),
  'server',
  'piecemaker',
  'originals-cache.cjs',
)) as { invalidateOriginals(caseRoot: string): void };
const { markdownCounterpart } = require(path.join(
  findApplicationRoot(getModuleDirectory(import.meta.url)),
  'server',
  'piecemaker',
  'vendor',
  'piecemaker-plugin',
  'scripts',
  'lib',
  'protection.cjs',
)) as { markdownCounterpart(filePath: string, caseRoot: string): { path: string; exists: boolean } };

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

function mappingSeed(projectId: string, store: KnowledgeStore): GlinerMappingDocument {
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
  const ignored = snapshot.exclusions || [];
  return { mapping, reverse_mapping: reverseMapping, extracted_data: extractedData, ignored };
}

function textValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function ocrRequiredFiles(payload: unknown): string[] {
  const files = payload && typeof payload === 'object' ? (payload as { files?: unknown }).files : null;
  return Array.isArray(files) ? files.filter((file): file is string => typeof file === 'string') : [];
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
    async scan(
      projectId: string,
      requestedFiles?: unknown,
      onProgress?: (progress: KnowledgeScanProgress) => void,
      signal?: AbortSignal,
      ocrMissing: OcrMissingChoice = 'continue',
    ) {
      const project = options.projects.getProjectById(projectId);
      if (!project) throw new Error('Project not found.');
      const projectPath = fs.realpathSync(project.project_path);
      const explicitFiles = Array.isArray(requestedFiles) && requestedFiles.length > 0;
      const files = await safeFiles(projectPath, requestedFiles);
      if (!files.length) throw new Error('No supported file to scan.');
      const stateFile = path.join(projectPath, '.piecemaker', 'anonymization-state.json');
      const outputDirectory = path.join(projectPath, 'Fichiers convertis PieceMaker');
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      fs.mkdirSync(outputDirectory, { recursive: true });
      const seed = mappingSeed(projectId, options.store);
      const args = [
        ...files,
        '-o',
        outputDirectory,
        '--database',
        resolveKnowledgeDatabasePath(),
        '--case-root',
        projectPath,
        '--state-file',
        stateFile,
        '--ocr-missing',
        ocrMissing,
      ];
      if (!explicitFiles) args.push('--skip-existing');
      let received: GlinerMappingDocument | null = null;
      let ocrRequired: string[] | null = null;
      try {
        await withPythonPath(pythonExecutable(options.pythonPath), () => runManagedPythonJob({
          action: 'anonymize',
          script,
          args,
          onProgress,
          signal,
          input: JSON.stringify(seed),
          onMapping: (value) => { received = value as GlinerMappingDocument; },
          onOcrRequired: (value) => { ocrRequired = ocrRequiredFiles(value); },
        }));
      } catch (error) {
        if (ocrRequired) throw new OcrRequiredError(ocrRequired);
        if (received) options.store.update({ projectId, operations: scanResultOperations({ projectId, mapping: received, documents: [] }) });
        throw error;
      }
      const mapping: GlinerMappingDocument = received || seed;
      const documents = documentsFromIndex(projectPath, files, readDocumentIndex(projectPath));
      const scanResult = { projectId, mapping, documents };
      const result = explicitFiles
        ? options.store.update({ projectId, operations: scanResultOperations(scanResult) })
        : persistScanResult(scanResult, options.store);
      return { ...result, documents: documents.length };
    },

    /** Pièces originales du dossier, avec leur statut et leur Markdown converti. */
    async pieces(projectId: string): Promise<CasePiece[]> {
      const project = options.projects.getProjectById(projectId);
      if (!project) throw new Error('Project not found.');
      const projectPath = fs.realpathSync(project.project_path);
      return (await listOriginals(projectPath)).map((file) => {
        const markdown = markdownCounterpart(path.join(projectPath, file.path), projectPath);
        return { path: file.path, status: file.status, markdown: markdown.exists ? path.relative(projectPath, markdown.path).split(path.sep).join('/') : null };
      });
    },

    /** Renomme et/ou range une pièce avec son Markdown, puis reporte le nouveau chemin sur son nœud document. */
    async rename(projectId: string, piecePath: unknown, name: unknown, directory?: unknown): Promise<RenamedPiece> {
      const project = options.projects.getProjectById(projectId);
      if (!project) throw new Error('Project not found.');
      const projectPath = fs.realpathSync(project.project_path);
      const renamed = await renamePiece(projectPath, String(piecePath ?? ''), name, directory);
      if (renamed.current === renamed.previous) return renamed;
      invalidateOriginals(projectPath);
      const fromNodeId = `document:${relativeKey(projectPath, path.join(projectPath, renamed.previous))}`;
      const node = options.store.snapshot(projectId).nodes.find((candidate) => candidate.id === fromNodeId);
      if (!node) return renamed;
      const currentPath = path.join(projectPath, renamed.current);
      const toNodeId = `document:${relativeKey(projectPath, currentPath)}`;
      options.store.update({
        projectId,
        operations: [
          { op: 'renameNode', rename: { fromNodeId, toNodeId } },
          { op: 'upsertNode', node: { id: toNodeId, kind: 'document', label: path.basename(currentPath), aliases: node.aliases, data: { ...node.data, path: currentPath } } },
        ],
      });
      return renamed;
    },
  };
}
