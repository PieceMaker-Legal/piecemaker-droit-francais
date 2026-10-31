import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

import { prepareWorkspaceInstallation } from './library/workspace-installation.js';

const VARIANT = { skipClaude: false, claudeOnly: false };
const LINK_PROVIDERS = ['.claude', '.cursor', '.opencode', '.grok'];
const MARKER = '.piecemaker/bundled-skills.json';

const BUNDLED_SKILLS = [
  { slug: 'docx-cli', segments: ['vendor', 'skills', 'docx-cli'] },
  { slug: 'style-redaction-cabinet', segments: ['vendor', 'piecemaker-plugin', 'skills', 'style-redaction-cabinet'] },
  { slug: 'Skill-PieceMaker', segments: ['vendor', 'skills', 'Skill-PieceMaker'] },
] as const;

const RETIRED_BUNDLED_SKILLS = ['redaction-juridique'];

type BundledSkill = (typeof BUNDLED_SKILLS)[number];

function skillSource(skill: BundledSkill) {
  return path.join(findApplicationRoot(getModuleDirectory(import.meta.url)), 'server', 'piecemaker', ...skill.segments);
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

function workspaceHashes(slug: string, files: Record<string, Buffer>) {
  return Object.fromEntries(Object.entries(files).map(([name, bytes]) => [`.agents/skills/${slug}/${name}`, digest(bytes)]));
}

function readMarker(workspace: string, slug: string) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(workspace, MARKER), 'utf8'));
    const files = value?.[slug];
    return files && typeof files === 'object' && !Array.isArray(files) ? files as Record<string, string> : null;
  } catch {
    return null;
  }
}

function writeMarker(workspace: string, slug: string, files: Record<string, string>) {
  const filename = path.join(workspace, MARKER);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  const current = (() => {
    try { return JSON.parse(fs.readFileSync(filename, 'utf8')); } catch { return {}; }
  })();
  const next = { ...(current && typeof current === 'object' ? current : {}), [slug]: files };
  const temporary = `${filename}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filename);
}

function removeFromMarker(workspace: string, slug: string) {
  const filename = path.join(workspace, MARKER);
  const { [slug]: _removed, ...next } = JSON.parse(fs.readFileSync(filename, 'utf8'));
  fs.writeFileSync(filename, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
}

function hashesEqual(left: Record<string, string>, right: Record<string, string>) {
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key]);
}

function linksReady(workspace: string, slug: string) {
  const root = path.join(workspace, '.agents', 'skills', slug);
  try {
    if (!fs.statSync(root).isDirectory()) return false;
    const resolved = fs.realpathSync(root);
    return LINK_PROVIDERS.every((provider) => {
      try { return fs.realpathSync(path.join(workspace, provider, 'skills', slug)) === resolved; }
      catch { return false; }
    });
  } catch {
    return false;
  }
}

function ensureExecutableCli(dest: string) {
  const script = path.join(dest, 'scripts', 'pm');
  if (fs.existsSync(script)) fs.chmodSync(script, 0o755);
}

function declareSkill(workspace: string, skill: BundledSkill): void {
  const source = skillSource(skill);
  if (!fs.existsSync(source)) return;
  const files = walkFiles(source);
  const hashes = workspaceHashes(skill.slug, files);
  const dest = path.join(workspace, '.agents', 'skills', skill.slug);
  const destExists = fs.existsSync(dest);
  const destHashes = destExists ? workspaceHashes(skill.slug, walkFiles(dest)) : null;
  const destMatches = Boolean(destHashes && hashesEqual(hashes, destHashes));
  if (destMatches && linksReady(workspace, skill.slug)) {
    writeMarker(workspace, skill.slug, hashes);
    ensureExecutableCli(dest);
    return;
  }
  const previousFiles = destMatches && destHashes ? destHashes : readMarker(workspace, skill.slug);
  if (destExists && !previousFiles) return;
  const previous = previousFiles
    ? { id: `bundled:${skill.slug}`, kind: 'skill' as const, name: skill.slug, slug: skill.slug, files: previousFiles, skipClaude: false }
    : undefined;
  const installation = prepareWorkspaceInstallation(workspace, previous, {
    component: { kind: 'skill', slug: skill.slug, files },
    variant: VARIANT,
  });
  installation.commit();
  writeMarker(workspace, skill.slug, hashes);
  ensureExecutableCli(dest);
}

function retireSkill(workspace: string, slug: string): void {
  const previousFiles = readMarker(workspace, slug);
  if (!previousFiles) return;
  const dest = path.join(workspace, '.agents', 'skills', slug);
  const unchanged = fs.existsSync(dest) && hashesEqual(previousFiles, workspaceHashes(slug, walkFiles(dest)));
  if (unchanged) {
    prepareWorkspaceInstallation(workspace, { id: `bundled:${slug}`, kind: 'skill', name: slug, slug, files: previousFiles, skipClaude: false }, null).commit();
  }
  removeFromMarker(workspace, slug);
}

export function declareBundledSkills(workspace: string): void {
  for (const slug of RETIRED_BUNDLED_SKILLS) {
    try {
      retireSkill(workspace, slug);
    } catch (error) {
      console.warn(`[piecemaker] retrait du skill ${slug} impossible dans ${workspace} : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  for (const skill of BUNDLED_SKILLS) {
    try {
      declareSkill(workspace, skill);
    } catch (error) {
      console.warn(`[piecemaker] déclaration du skill ${skill.slug} impossible dans ${workspace} : ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
