/** Legal-case folders: every CloudCLI project, as published by the PieceMaker server. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PROJECTS_FILE = 'projects.json';

function piecemakerHome() {
  return process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker');
}

function projectsFile() {
  return path.join(piecemakerHome(), PROJECTS_FILE);
}

function realDirectory(value) {
  const requested = String(value || '').trim();
  if (!requested || !path.isAbsolute(requested)) return null;
  try {
    const resolved = fs.realpathSync(path.resolve(requested));
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function isInsideOrEqualPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function excludedRoots() {
  return [os.tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders']
    .map(realDirectory)
    .filter(Boolean);
}

function isEligibleProjectFolder(folder) {
  const home = realDirectory(os.homedir());
  if (home && isInsideOrEqualPath(folder, home)) return false;
  return !excludedRoots().some((root) => isInsideOrEqualPath(root, folder));
}

function readProjectSources() {
  try {
    const parsed = JSON.parse(fs.readFileSync(projectsFile(), 'utf8'));
    return parsed?.sources && typeof parsed.sources === 'object' && !Array.isArray(parsed.sources) ? parsed.sources : {};
  } catch {
    return {};
  }
}

/** Absolute, existing and de-duplicated project folders, across every publishing server. */
function registeredProjectFolders() {
  const folders = Object.values(readProjectSources()).flatMap((list) => (Array.isArray(list) ? list : []));
  return [...new Set(folders.map(realDirectory).filter(Boolean))].filter(isEligibleProjectFolder);
}

function publishProjectSource(sourceId, folders) {
  const file = projectsFile();
  const sources = readProjectSources();
  if (folders === null) delete sources[sourceId];
  else sources[sourceId] = [...new Set(folders.map((folder) => path.resolve(String(folder))))].sort();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporaryFile = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, `${JSON.stringify({ version: 1, sources }, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryFile, file);
  } catch (error) {
    fs.rmSync(temporaryFile, { force: true });
    throw error;
  }
}

function resolveTarget(target) {
  try {
    return fs.realpathSync(path.resolve(String(target)));
  } catch {
    // Write/Edit may target a file that does not exist yet. Resolve its nearest
    // existing parent, then append the missing tail without following links.
    let current = path.resolve(String(target));
    const tail = [];
    while (path.dirname(current) !== current) {
      try {
        return path.join(fs.realpathSync(current), ...tail);
      } catch {
        tail.unshift(path.basename(current));
        current = path.dirname(current);
      }
    }
    return null;
  }
}

/** Locate a target inside one of the project folders; a nested project wins over its parent. */
function locateProjectCase(target) {
  if (!target) return null;
  const absolute = resolveTarget(target);
  if (!absolute) return null;
  const roots = registeredProjectFolders().sort((a, b) => b.length - a.length);
  for (const caseRoot of roots) {
    if (!isInsideOrEqualPath(caseRoot, absolute)) continue;
    return {
      casesRoot: path.dirname(caseRoot),
      caseName: path.basename(caseRoot),
      caseRoot,
      absolute,
      relative: path.relative(caseRoot, absolute).split(path.sep).join('/'),
      registered: true,
    };
  }
  return null;
}

module.exports = {
  locateProjectCase,
  publishProjectSource,
  registeredProjectFolders,
};
