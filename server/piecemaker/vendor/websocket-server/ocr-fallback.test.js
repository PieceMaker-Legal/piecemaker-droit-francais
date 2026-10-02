const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPTS_DIR = path.join(__dirname, 'scripts');

const HARNESS = `
import json, sys
from pathlib import Path
scripts, mineru_state = sys.argv[1], sys.argv[2]
sys.path.insert(0, scripts)
import convert_and_scan_pipeline as pipeline
pipeline.mineru_available = lambda: mineru_state == "present"
pipeline.start_scanner_worker = lambda: None
pipeline.wait_for_worker_ready = lambda *args, **kwargs: True
converted, scanned = [], []
def convert(input_file, output_dir, engine=None, mode=None, lang=None):
    converted.append([Path(input_file).name, engine])
    target = Path(output_dir) / f"{Path(input_file).stem}.md"
    target.write_text(f"converti par {engine}", encoding="utf-8")
    return True, str(target)
def scan(worker, md_file, output_dir, *rest):
    scanned.append(Path(md_file).name)
    (Path(output_dir) / f"{Path(md_file).stem}_sensitive_map.json").write_text('{"entities": {}}', encoding="utf-8")
    return True
pipeline.convert_file = convert
pipeline.scan_file_via_worker = scan
sys.argv = ["convert_and_scan_pipeline.py", *sys.argv[3:]]
resources = pipeline.PipelineResources()
try:
    code = pipeline.run_pipeline(resources)
finally:
    resources.close()
print("RESULT:" + json.dumps({"code": code, "converted": converted, "scanned": scanned}))
`;

function venvPython() {
  if (process.env.PYTHON_PATH) return process.env.PYTHON_PATH;
  const venv = path.join(os.homedir(), '.piecemaker', 'venv');
  return process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
}

function pythonWithPypdf() {
  const python = venvPython();
  const probe = spawnSync(python, ['-c', 'import pypdf'], { encoding: 'utf8' });
  return probe.status === 0 ? python : null;
}

function pdf(pageContent) {
  const stream = pageContent ? `BT /F1 12 Tf 72 720 Td (${pageContent}) Tj ET` : '';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = body.length;
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}

function caseFolder() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-ocr-')));
  fs.writeFileSync(path.join(root, 'scanne.pdf'), pdf(''));
  fs.writeFileSync(path.join(root, 'texte.pdf'), pdf('Contrat de bail commercial conclu entre les parties soussignees le premier janvier'));
  fs.mkdirSync(path.join(root, 'photos'));
  fs.writeFileSync(path.join(root, 'photos', 'recu.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  fs.writeFileSync(path.join(root, 'auth.db'), '');
  const harness = path.join(root, 'harness.py');
  fs.writeFileSync(harness, HARNESS);
  return {
    root,
    output: path.join(root, 'Fichiers convertis PieceMaker'),
    stateFile: path.join(root, '.piecemaker', 'anonymization-state.json'),
    harness,
  };
}

function runPipeline(python, folder, mineruState, extraArgs) {
  const files = ['scanne.pdf', 'texte.pdf', path.join('photos', 'recu.png')].map((name) => path.join(folder.root, name));
  const result = spawnSync(python, [
    folder.harness, SCRIPTS_DIR, mineruState,
    ...files,
    '-o', folder.output,
    '--database', path.join(folder.root, 'auth.db'),
    '--case-root', folder.root,
    '--state-file', folder.stateFile,
    ...extraArgs,
  ], { cwd: SCRIPTS_DIR, encoding: 'utf8', input: '', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  const lines = result.stdout.split(/\r?\n/);
  const marker = (prefix) => {
    const line = lines.find((candidate) => candidate.startsWith(prefix));
    return line ? JSON.parse(line.slice(prefix.length)) : null;
  };
  assert.ok(marker('RESULT:'), result.stderr);
  return { ...marker('RESULT:'), ocrRequired: marker('OCR_REQUIRED:') };
}

function convertedEntries(folder) {
  return Object.values(JSON.parse(fs.readFileSync(folder.stateFile, 'utf8')).files).map((entry) => entry.converted);
}

const python = pythonWithPypdf();

test('sans MinerU, le mode « ask » s’arrête avant toute conversion et nomme les seules pièces scannées', { skip: !python && 'Python avec pypdf introuvable' }, () => {
  const folder = caseFolder();
  try {
    const run = runPipeline(python, folder, 'absent', ['--ocr-missing', 'ask']);
    assert.equal(run.code, 3);
    assert.deepEqual(run.ocrRequired, { files: ['photos/recu.png', 'scanne.pdf'] });
    assert.deepEqual(run.converted, []);
    assert.equal(fs.existsSync(folder.stateFile), false);
  } finally {
    fs.rmSync(folder.root, { recursive: true, force: true });
  }
});

test('refusé, les scans passent par l’outil standard puis sont reconvertis et réanalysés une fois MinerU installé', { skip: !python && 'Python avec pypdf introuvable' }, () => {
  const folder = caseFolder();
  try {
    const refused = runPipeline(python, folder, 'absent', ['--ocr-missing', 'continue', '--skip-existing']);
    assert.equal(refused.code, 0);
    assert.equal(refused.ocrRequired, null);
    assert.deepEqual(refused.converted, [['scanne.pdf', 'markitdown'], ['texte.pdf', 'auto'], ['recu.png', 'markitdown']]);
    assert.deepEqual(convertedEntries(folder).map((entry) => entry.ocr || null).sort(), ['missing', 'missing', null]);

    const stillAbsent = runPipeline(python, folder, 'absent', ['--ocr-missing', 'ask', '--skip-existing']);
    assert.equal(stillAbsent.ocrRequired, null);
    assert.deepEqual(stillAbsent.converted, []);

    const installed = runPipeline(python, folder, 'present', ['--ocr-missing', 'ask', '--skip-existing']);
    assert.equal(installed.code, 0);
    assert.deepEqual(installed.converted, [['scanne.pdf', 'auto'], ['recu.png', 'auto']]);
    assert.deepEqual(installed.scanned, ['scanne.md', 'recu.md']);
    assert.deepEqual(convertedEntries(folder).map((entry) => entry.ocr || null), [null, null, null]);
  } finally {
    fs.rmSync(folder.root, { recursive: true, force: true });
  }
});
