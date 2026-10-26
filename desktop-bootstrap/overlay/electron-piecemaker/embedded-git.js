import fs from 'node:fs';
import path from 'node:path';

export function addEmbeddedGit({ resourcesPath = process.resourcesPath, environment = process.env, exists = fs.existsSync } = {}) {
  if (!resourcesPath) return false;
  const directory = path.join(resourcesPath, 'mingit', 'cmd');
  if (!exists(path.join(directory, 'git.exe'))) return false;
  environment.PATH = environment.PATH ? `${directory}${path.delimiter}${environment.PATH}` : directory;
  return true;
}
