import fs from 'node:fs';
import path from 'node:path';

export function addEmbeddedNode({ resourcesPath = process.resourcesPath, environment = process.env, exists = fs.existsSync } = {}) {
  if (!resourcesPath) return false;
  const directory = path.join(resourcesPath, 'node-shim');
  if (!exists(path.join(directory, 'node.cmd'))) return false;
  environment.PATH = environment.PATH ? `${environment.PATH}${path.delimiter}${directory}` : directory;
  return true;
}
