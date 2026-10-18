import { app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = path.join(os.homedir(), '.piecemaker-validation');
fs.mkdirSync(directory, { recursive: true });
process.env.CLOUDCLI_HOME = path.join(directory, 'app-data');
process.env.DATABASE_PATH = path.join(directory, 'app-data', 'auth.db');
process.env.PIECEMAKER_HOME = path.join(directory, 'components');
process.env.PIECEMAKER_RUNTIME_CACHE_ROOT = path.join(directory, 'runtime-components');
process.env.PIECEMAKER_PREBUILT_ASSET_DIR = path.join(path.dirname(app.getPath('exe')), 'resources', 'validation-assets');
process.env.PIECEMAKER_ANONYMIZER = 'on';
app.setPath('userData', path.join(directory, 'browser-profile'));
await import('./main.js');
