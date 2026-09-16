import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

import type { KnowledgeStore } from '../../../plugins/piecemaker-dossier/src/knowledge.js';
import type { GlinerDocument, GlinerMappingDocument, JsonData } from '../../../plugins/piecemaker-dossier/src/types.js';
import { persistScanResult, scanResultOperations } from '../../../plugins/piecemaker-dossier/src/scan-result.js';
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

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.doc', '.odt', '.rtf', '.txt', '.md', '.png', '.jpg', '.jpeg', '.tif', '.tiff', '.bmp']);

function relativeKey(projectPath: string, filePath: string): string {
  const relative = path.relative(projectPath, filePath).split(path.sep).join('/').normalize('NFC');
  return crypto.createHash('sha256').update(relative).digest('hex');
}

function listedFiles(projectPath: string): string[] {
  return fs.readdirSync(projectPath, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(projectPath, entry.name));
}

function safeFiles(projectPath: string, requested: unknown): string[] {
  const root = fs.realpathSync(projectPath);
  const candidates = Array.isArray(requested) && requested.length ? requested : listedFiles(root);
  return [...new Set(candidates.map((candidate) => {
    const raw = String(candidate || '');
    const resolved = path.resolve(root, raw);
    const real = fs.realpathSync(resolved);
    if (real !== root && !real.startsWith(`${root}${path.sep}`)) throw new Error('File outside project.');
    if (!fs.statSync(real).isFile() || !SUPPORTED_EXTENSIONS.has(path.extname(real).toLowerCase())) throw new Error('Unsupported file.');
    return real;
  }))];
}

/**
 * `convert_and_scan_pipeline.py` chains CONVERT (markitdown) then SCAN/CHUNKS
 * (GLiNER) in one call, each with its own 0-100. The two shares below keep the
 * reported percentage monotonic across that handover, with the same weighting
 * as `originals-pipeline.cjs` — GLiNER dominates markitdown in duration.
 */
const CONVERT_SUBPHASE_SHARE = 0.25;

function progressFromLine(line: string): KnowledgeScanProgress | null {
  const matched = /^PROGRESS:([A-Z]+):(\d+):(\d+):(\d+)/.exec(line.trim());
  if (!matched) return null;
  const [, marker, percentage, current, total] = matched;
  const phase = marker === 'CONVERT' ? 'convert' : 'scan';
  const subPercent = Math.min(100, Number(percentage) || 0);
  return {
    phase,
    percent: phase === 'convert'
      ? subPercent * CONVERT_SUBPHASE_SHARE
      : CONVERT_SUBPHASE_SHARE * 100 + subPercent * (1 - CONVERT_SUBPHASE_SHARE),
    processed: Number(current) || 0,
    total: Number(total) || 0,
  };
}

function runProcess(executable: string, args: string[], cwd: string, onProgress?: (progress: KnowledgeScanProgress) => void, signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: { ...process.env, PYTHONUNBUFFERED: '1' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pendingLine = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!onProgress) return;
      const lines = (pendingLine + chunk).split(/\r?\n/);
      pendingLine = lines.pop() || '';
      for (const line of lines) {
        const progress = progressFromLine(line);
        if (progress) onProgress(progress);
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const abort = () => { child.kill('SIGTERM'); };
    if (signal?.aborted) abort();
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', reject);
    child.once('close', (code) => {
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) { reject(new Error('Analyse interrompue.')); return; }
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `Pipeline failed with code ${code ?? 1}.`));
    });
  });
}

function parseObject(filePath: string): JsonData {
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, '')) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid pipeline output.');
  return parsed as JsonData;
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

export function createKnowledgePipeline(options: PipelineOptions) {
  const script = path.join(options.applicationRoot, 'server', 'piecemaker', 'vendor', 'websocket-server', 'scripts', 'convert_and_scan_pipeline.py');
  return {
    async scan(projectId: string, requestedFiles?: unknown, onProgress?: (progress: KnowledgeScanProgress) => void, signal?: AbortSignal) {
      const project = options.projects.getProjectById(projectId);
      if (!project) throw new Error('Project not found.');
      const projectPath = fs.realpathSync(project.project_path);
      const files = safeFiles(projectPath, requestedFiles);
      if (!files.length) throw new Error('No supported file to scan.');
      const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'piecemaker-knowledge-'));
      const mappingFile = path.join(temporaryRoot, 'mapping.json');
      const stateFile = path.join(temporaryRoot, 'state.json');
      const outputDirectory = path.join(projectPath, 'Fichiers convertis PieceMaker');
      fs.mkdirSync(outputDirectory, { recursive: true });
      try {
        fs.writeFileSync(mappingFile, JSON.stringify(mappingSeed(projectId, projectPath, options.store)), { mode: 0o600 });
        const args = [
          script,
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
        const processResult = await runProcess(pythonExecutable(options.pythonPath), args, projectPath, onProgress, signal);
        const mapping = parseObject(mappingFile) as GlinerMappingDocument;
        const documentIndex = parseObject(path.join(temporaryRoot, 'document-index.json'));
        const documents = documentsFromIndex(projectPath, files, documentIndex);
        const scanResult = { projectId, mapping, documents };
        const result = Array.isArray(requestedFiles) && requestedFiles.length
          ? options.store.update({ projectId, operations: scanResultOperations(scanResult) })
          : persistScanResult(scanResult, options.store);
        return { ...result, documents: documents.length, stdout: processResult.stdout.trim(), stderr: processResult.stderr.trim() };
      } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
      }
    },
  };
}
