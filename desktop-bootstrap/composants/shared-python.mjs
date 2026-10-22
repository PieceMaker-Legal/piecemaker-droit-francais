import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const sharedPythonRequirements = fileURLToPath(new URL('./windows-requirements.txt', import.meta.url));
export const sharedPythonMarker = '.piecemaker-shared-python.json';
export const sharedPythonProbe = 'import importlib; [importlib.import_module(name) for name in ["markitdown", "pypdf", "torch", "gliner2", "mineru", "mineru_llama_cpp", "onnxruntime", "vibe.cli.programmatic", "requests", "dotenv", "truststore"]]';
export const sharedPythonEntrypoints = 'import os,sys; from importlib.metadata import distributions; from pip._vendor.distlib.scripts import ScriptMaker; maker=ScriptMaker(None,os.path.join(sys.prefix,"Scripts")); maker.executable=sys.executable; maker.clobber=True; maker.variants={""}; [maker.make(ep.name+"="+ep.value) for dist in distributions() for ep in dist.entry_points if ep.group=="console_scripts"]';

export async function sharedPythonFingerprint() {
  return crypto.createHash('sha256').update(await fs.readFile(sharedPythonRequirements)).digest('hex');
}

export async function sharedPythonReady(host, python, fingerprint) {
  try {
    const marker = JSON.parse(await host.readFile(path.join(path.dirname(python), sharedPythonMarker)));
    return marker.format === 1 && marker.requirementsSha256 === fingerprint;
  } catch {
    return false;
  }
}
