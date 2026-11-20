import { pathToFileURL } from 'node:url';

try {
  const { binding, cwd, outil, arguments: positional = [], options = {} } = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
  if (!binding || !cwd || typeof outil !== 'string' || !Array.isArray(positional)
    || positional.some((value) => typeof value !== 'string' || value.startsWith('--')) || !options || Array.isArray(options) || typeof options !== 'object') {
    throw new Error('Commande PieceMaker invalide.');
  }
  const args = [outil, ...positional];
  for (const [name, value] of Object.entries(options)) {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || name === 'dossier') throw new Error('Option PieceMaker invalide.');
    if (value === false || value == null) continue;
    args.push(value === true ? `--${name}` : `--${name}=${typeof value === 'object' ? JSON.stringify(value) : value}`);
  }
  process.env.CLOUDCLI_HOME = binding.home;
  process.env.PIECEMAKER_APP_PORT = String(binding.port);
  process.env.PIECEMAKER_DOSSIER = cwd;
  const { run } = await import(pathToFileURL(binding.cli).href);
  const result = await run(args, { cwd });
  let parsed = result;
  if (typeof result === 'string') {
    try { parsed = JSON.parse(result); } catch {}
  }
  process.stdout.write(JSON.stringify({ ok: true, result: parsed ?? null }));
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
}
