import fs from 'node:fs/promises';
import path from 'node:path';
import { packGlinerCache } from './gliner-cache.mjs';

const output = path.resolve(process.argv[2] || 'dist');
await fs.mkdir(output, { recursive: true });
const packed = await packGlinerCache({ sourceDir: process.cwd(), outputDir: output });
console.log(JSON.stringify(packed));
