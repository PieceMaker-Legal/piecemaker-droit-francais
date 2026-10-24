import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installRuntimeComponents, createHost, scriptsDirectory } from './install.mjs';
import { sharedPythonProbe } from './shared-python.mjs';

export async function verifyPythonRuntime(sourceDir, assetsDir) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pm-python-relocated-'));
  const source = path.join(root, 'source');
  const scripts = scriptsDirectory(source);
  await fs.mkdir(scripts, { recursive: true });
  await fs.cp(scriptsDirectory(sourceDir), scripts, { recursive: true, filter: async target => {
    if (['__pycache__', 'node_modules', 'eval', 'tests'].includes(path.basename(target))) return false;
    return (await fs.stat(target)).isDirectory() || /\.(py|txt|json)$/.test(target);
  } });
  await fs.copyFile(path.join(assetsDir, 'python-runtime.json'), path.join(source, 'python-runtime.json'));
  const env = { ...process.env, PIECEMAKER_HOME: path.join(root, 'home with spaces'), PIECEMAKER_PREBUILT_ASSET_DIR: assetsDir };
  delete env.PIECEMAKER_COMPONENTS_HOME;
  const host = createHost();
  const run = host.run;
  host.run = (command, args, options = {}) => {
    if (args.includes('pip')) throw new Error('Python installation invoked pip on the destination machine.');
    return run(command, args, { ...options, env: { ...env, ...options.env } });
  };
  const started = performance.now();
  await installRuntimeComponents({ sourceDir: source, env, host, requirePrebuilt: true });
  const installMs = Math.round(performance.now() - started);
  const config = JSON.parse(await fs.readFile(path.join(env.PIECEMAKER_HOME, 'config.json'), 'utf8'));
  if (config.pythonRuntime?.kind === 'shared') {
    const shared = await host.run(config.pythonPath, ['-c', sharedPythonProbe], { capture: true, timeoutMs: 300_000 });
    if (shared.code !== 0) throw new Error(`Shared Python imports failed: ${shared.stderr}`);
    const vibe = await host.run(process.platform === 'win32' ? path.join(path.dirname(config.pythonPath), 'Scripts', 'vibe.exe') : path.join(path.dirname(config.pythonPath), 'vibe'), ['--version'], { capture: true, timeoutMs: 30_000 });
    if (vibe.code !== 0) throw new Error(`Relocated Vibe launcher failed: ${vibe.stderr}`);
  }
  const probe = await host.run(config.pythonPath, ['-c', "import io,zipfile,numpy,pandas,pypdf; from markitdown import MarkItDown; data=io.BytesIO(); z=zipfile.ZipFile(data,'w'); z.writestr('[Content_Types].xml','<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/></Types>'); z.writestr('_rels/.rels','<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/></Relationships>'); z.writestr('word/document.xml','<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>PieceMaker sample</w:t></w:r></w:p></w:body></w:document>'); z.close(); data.seek(0); assert 'PieceMaker sample' in MarkItDown().convert_stream(data,file_extension='.docx').text_content; print('python-runtime-ok')"], { capture: true });
  if (probe.code !== 0 || !probe.stdout.includes('python-runtime-ok')) throw new Error(`Relocated Python failed: ${probe.stderr}`);
  const reused = performance.now();
  host.fetch = () => { throw new Error('Python cache reuse downloaded an asset.'); };
  await installRuntimeComponents({ sourceDir: source, env, host, requirePrebuilt: true });
  return { root, installMs, cacheReuseMs: Math.round(performance.now() - reused), docxConversion: true, nativePythonImports: true };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await verifyPythonRuntime(process.cwd(), path.resolve(process.argv[2]))));
}
