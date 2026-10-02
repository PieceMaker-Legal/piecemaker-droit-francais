const test = require('node:test');
const assert = require('node:assert');

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { runManagedPythonJob } = require('./originals-pipeline.cjs');

test('la liste des pièces scannées annoncée par le pipeline remonte à l’appelant, sans passer par le journal', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-job-'));
  const script = path.join(directory, 'job.js');
  fs.writeFileSync(script, "console.log('OCR_REQUIRED:' + JSON.stringify({ files: ['scans/bail.pdf'] })); process.exit(3);\n");
  const previous = process.env.PYTHON_PATH;
  process.env.PYTHON_PATH = process.execPath;
  const announced = [];
  try {
    await assert.rejects(
      runManagedPythonJob({ action: 'anonymize', script, args: [], onOcrRequired: (payload) => announced.push(payload) }),
      /code 3/,
    );
    assert.deepStrictEqual(announced, [{ files: ['scans/bail.pdf'] }]);
  } finally {
    if (previous === undefined) delete process.env.PYTHON_PATH;
    else process.env.PYTHON_PATH = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('anonymisation : un traitement seul démarre, le suivant attend puis démarre', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'managed-job-'));
  const script = path.join(directory, 'job.js');
  fs.writeFileSync(script, "console.log('PROGRESS:SCAN:100:1:1');\n");
  const previous = process.env.PYTHON_PATH;
  process.env.PYTHON_PATH = process.execPath;
  const finished = [];
  try {
    const run = (name) => runManagedPythonJob({ action: 'anonymize', script, args: [] }).then(() => finished.push(name));
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('traitement bloqué en file')), 10_000).unref());
    await Promise.race([Promise.all([run('premier'), run('second')]), timeout]);
    assert.deepStrictEqual(finished, ['premier', 'second']);
  } finally {
    if (previous === undefined) delete process.env.PYTHON_PATH;
    else process.env.PYTHON_PATH = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
