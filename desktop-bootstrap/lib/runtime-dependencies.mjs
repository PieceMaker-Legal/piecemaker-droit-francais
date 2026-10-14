import fs from 'node:fs';
import path from 'node:path';

const SOURCE_EXTENSIONS = new Set(['.ts', '.js', '.mjs', '.cjs']);
const EXCLUDED_DIRECTORIES = new Set(['test', 'tests', '__tests__']);
const EXCLUDED_FILE_PATTERN = /\.(?:test|spec)\.[^.]+$/i;
const EXPLICIT_DEPENDENCIES = ['@openai/codex', '@vscode/ripgrep', 'mime'];

function sourceFiles(root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return EXCLUDED_DIRECTORIES.has(entry.name.toLowerCase()) ? [] : sourceFiles(target);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !EXCLUDED_FILE_PATTERN.test(entry.name) ? [target] : [];
  });
}

function pluginServerSources(sourceDir) {
  const pluginsDir = path.join(sourceDir, 'plugins');
  let entries;
  try {
    entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const pluginDir = path.join(pluginsDir, entry.name);
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(pluginDir, 'manifest.json'), 'utf8'));
      const serverSource = manifest.piecemakerSources?.server;
      if (typeof serverSource !== 'string') return [];
      const source = path.resolve(pluginDir, serverSource);
      return source.startsWith(`${pluginDir}${path.sep}`) && fs.existsSync(source) ? sourceFiles(path.dirname(source)) : [];
    } catch {
      return [];
    }
  });
}

function packageLiteralPattern(name) {
  const escaped = Array.from(name, (character) => '\\^$.*+?()[]{}|'.includes(character) ? `\\${character}` : character).join('');
  return new RegExp(`['"]${escaped}(?:/[^'"]*)?['"]`);
}

export function selectRuntimeDependencies(sourceDir, manifest, { sourceRoots = ['server', 'electron', 'shared', 'desktop-bootstrap/overlay'], includePluginServers = true } = {}) {
  const roots = sourceRoots
    .map((relative) => path.join(sourceDir, relative));
  const files = [...new Set([...roots.flatMap(sourceFiles), ...(includePluginServers ? pluginServerSources(sourceDir) : [])])];
  const source = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  const runtimeNames = new Set([
    ...Object.keys(manifest.dependencies || {}).filter((name) => packageLiteralPattern(name).test(source)),
    ...EXPLICIT_DEPENDENCIES.filter((name) => name in (manifest.dependencies || {})),
  ]);
  const dependencies = Object.fromEntries([...runtimeNames].sort().map((name) => [name, manifest.dependencies[name]]));
  return {
    dependencies,
    optionalDependencies: { ...(manifest.optionalDependencies || {}) },
  };
}
