import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { prepareWorkspaceInstallation } from './library/workspace-installation.js';

const SLUG = 'docx-cli';
const VARIANT = { skipClaude: false, claudeOnly: false };
const LINK_PROVIDERS = ['.claude', '.cursor', '.opencode', '.grok'];
const MARKER = '.piecemaker/bundled-skills.json';

function skillSource() {
  return path.join(findApplicationRoot(getModuleDirectory(import.meta.url)), 'server', 'piecemaker', 'vendor', 'skills', SLUG);
}

function digest(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function walkFiles(root: string): Record<string, Buffer> {
  const files: Record<string, Buffer> = {};
  const visit = (relative: string) => {
    const directory = relative ? path.join(root, relative) : root;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(child);
      else files[child] = fs.readFileSync(path.join(root, child));
    }
  };
  visit('');
  return files;
}

function workspaceHashes(files: Record<string, Buffer>) {
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [`.agents/skills/${SLUG}/${name}`, digest(bytes)]));
}

function readMarker(workspace: string) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(workspace, MARKER), 'utf8'));
    const files = value?.[SLUG];
    return files && typeof files === 'object' && !Array.isArray(files) ? files as Record<string, string> : null;
  } catch {
    return null;
  }
}

function writeMarker(workspace: string, files: Record<string, string>) {
  const filename = path.join(workspace, MARKER);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const current = (() => {
    try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { return {}; }
  })();
  const next = { ...(current && typeof current === 'object' ? current : {}), [SLUG]: files };
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filename);
}

function hashesEqual(left: Record<string, string>, right: Record<string, string>) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function linksReady(workspace: string) {
  const root = path.join(workspace, '.agents', 'skills', SLUG);
  try {
    if (!fs.statSync(root).isDirectory()) return false;
    const resolved = fs.realpathSync(root);
    return LINK_PROVIDERS.every((provider) => {
      try { return fs.realpathSync(path.join(workspace, provider, 'skills', SLUG)) === resolved; }
      catch { return false; }
    });
  } catch {
    return false;
  }
}

export function declareDocxCliSkill(workspace: string): void {
  try {
    const source = skillSource();
    if (!fs.existsSync(source)) return;
    const files = walkFiles(source);
    const hashes = workspaceHashes(files);
    const dest = path.join(workspace, '.agents', 'skills', SLUG);
    const destExists = fs.existsSync(dest);
    const destHashes = destExists ? workspaceHashes(walkFiles(dest)) : null;
    const destMatches = Boolean(destHashes && hashesEqual(hashes, destHashes));
    if (destMatches && linksReady(workspace)) {
      writeMarker(workspace, hashes);
      return;
    }
    const previousFiles = destMatches && destHashes ? destHashes : readMarker(workspace);
    if (destExists && !previousFiles) return;
    const previous = previousFiles
      ? { id: `bundled:${SLUG}`, kind: 'skill' as const, name: SLUG, slug: SLUG, files: previousFiles, skipClaude: false }
      : undefined;
    const installation = prepareWorkspaceInstallation(workspace, previous, {
      component: { kind: 'skill', slug: SLUG, files },
      variant: VARIANT,
    });
    installation.commit();
    writeMarker(workspace, hashes);
  } catch (error) {
    console.warn(`[piecemaker] déclaration du skill docx-cli impossible dans ${workspace} : ${error instanceof Error ? error.message : String(error)}`);
  }
}
