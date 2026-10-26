const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPTS_DIR = path.join(__dirname, 'scripts');

const HARNESS = `
import json, os, sys
from pathlib import Path
scripts, mineru_state = sys.argv[1], sys.argv[2]
sys.path.insert(0, scripts)
import convert_and_scan_pipeline as pipeline
pipeline.mineru_available = lambda: mineru_state == "present"
pipeline.start_scanner_worker = lambda: None
pipeline.wait_for_worker_ready = lambda *args, **kwargs: True
converted, scanned = [], []
def convert(input_file, output_dir, engine=None, mode=None, lang=None, output_name=None):
    converted.append([Path(input_file).name, engine])
    if Path(input_file).name in os.environ.get("PM_FAIL_FILES", "").split(","):
        return False, None, "MinerU failed with exit code 1 : Conversion arrêtée : fictif"
    target = Path(output_dir) / f"{output_name or Path(input_file).stem}.md"
    target.write_text(f"converti par {engine}", encoding="utf-8")
    return True, str(target), None
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

function runPipeline(python, folder, mineruState, extraArgs, failingFiles = []) {
  const files = ['scanne.pdf', 'texte.pdf', path.join('photos', 'recu.png')].map((name) => path.join(folder.root, name));
  const result = spawnSync(python, [
    folder.harness, SCRIPTS_DIR, mineruState,
    ...files,
    '-o', folder.output,
    '--database', path.join(folder.root, 'auth.db'),
    '--case-root', folder.root,
    '--state-file', folder.stateFile,
    ...extraArgs,
  ], {
    cwd: SCRIPTS_DIR,
    encoding: 'utf8',
    input: '',
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', PM_FAIL_FILES: failingFiles.join(',') },
  });
  const lines = result.stdout.split(/\r?\n/);
  const marker = (prefix) => {
    const line = lines.find((candidate) => candidate.startsWith(prefix));
    return line ? JSON.parse(line.slice(prefix.length)) : null;
  };
  assert.ok(marker('RESULT:'), result.stderr);
  const failed = lines
    .filter((candidate) => candidate.startsWith('CONVERSION_FAILED:'))
    .map((candidate) => JSON.parse(candidate.slice('CONVERSION_FAILED:'.length)));
  return { ...marker('RESULT:'), ocrRequired: marker('OCR_REQUIRED:'), failed, stderr: result.stderr };
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
    assert.equal(installed.scanned.length, 2);
    assert.match(installed.scanned[0], /^scanne-[0-9a-f]{16}\.md$/);
    assert.match(installed.scanned[1], /^recu-[0-9a-f]{16}\.md$/);
    assert.deepEqual(convertedEntries(folder).map((entry) => entry.ocr || null), [null, null, null]);
  } finally {
    fs.rmSync(folder.root, { recursive: true, force: true });
  }
});

test('un document qui ne se convertit pas est signalé, sans interrompre le traitement des autres', { skip: !python && 'Python avec pypdf introuvable' }, () => {
  const folder = caseFolder();
  try {
    const run = runPipeline(python, folder, 'present', ['--ocr-missing', 'continue'], ['scanne.pdf']);
    assert.equal(run.code, 0);
    assert.deepEqual(run.failed, [{ file: 'scanne.pdf', reason: 'MinerU failed with exit code 1 : Conversion arrêtée : fictif' }]);
    assert.equal(run.converted.length, 3);
    assert.equal(run.scanned.length, 2);
    assert.match(run.scanned[0], /^texte-[0-9a-f]{16}\.md$/);
    assert.match(run.scanned[1], /^recu-[0-9a-f]{16}\.md$/);
    assert.doesNotMatch(run.stderr, /All conversions failed/);
  } finally {
    fs.rmSync(folder.root, { recursive: true, force: true });
  }
});

test('si aucun document ne se convertit, le pipeline se termine normalement et liste chaque échec', { skip: !python && 'Python avec pypdf introuvable' }, () => {
  const folder = caseFolder();
  try {
    const run = runPipeline(python, folder, 'present', ['--ocr-missing', 'continue'], ['scanne.pdf', 'texte.pdf', 'recu.png']);
    assert.equal(run.code, 0);
    assert.equal(run.failed.length, 3);
    assert.deepEqual(run.failed.map((failure) => failure.file).sort(), ['photos/recu.png', 'scanne.pdf', 'texte.pdf'].sort());
    assert.deepEqual(run.scanned, []);
    assert.doesNotMatch(run.stderr, /All conversions failed|pipeline aborted/);
  } finally {
    fs.rmSync(folder.root, { recursive: true, force: true });
  }
});
