import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const sharedPythonRequirements = fileURLToPath(new URL('./windows-requirements.txt', import.meta.url));
export const sharedPythonMarker = '.piecemaker-shared-python.json';
export const sharedPythonProbe = 'import importlib; [importlib.import_module(name) for name in ["markitdown", "pypdf", "torch", "gliner2", "mineru", "mineru_llama_cpp", "onnxruntime", "requests", "dotenv", "truststore"]]';
export const sharedPythonEntrypoints = `
import os,stat,sys
from pathlib import Path
from importlib.metadata import distributions
from pip._vendor.distlib.scripts import ScriptMaker
from pip._vendor.distlib.util import FileOperator

class ChangedFiles(FileOperator):
    def write_binary_file(self,path,data):
        try:
            if Path(path).read_bytes() == data:
                return
        except FileNotFoundError:
            pass
        super().write_binary_file(path,data)

    def set_executable_mode(self,files):
        super().set_executable_mode([name for name in files if stat.S_IMODE(os.stat(name).st_mode) & 0o555 != 0o555])

os.environ["SOURCE_DATE_EPOCH"] = "315532800"
maker = ScriptMaker(None,os.path.join(sys.prefix,"Scripts" if os.name == "nt" else "bin"),fileop=ChangedFiles())
maker.clobber = True
maker.variants = {""}
for dist in distributions():
    for ep in dist.entry_points:
        if ep.group == "console_scripts":
            maker.make(ep.name + "=" + ep.value)
`;

export function requirementsForPlatform(platform = 'win32', arch = 'x64') {
  if (platform === 'win32' && arch === 'x64') return sharedPythonRequirements;
  if (platform === 'darwin' && arch === 'arm64') return fileURLToPath(new URL('./macos-arm64-requirements.txt', import.meta.url));
  throw new Error(`Environnement Python commun indisponible : ${platform}/${arch}.`);
}

export async function sharedPythonFingerprint(platform = 'win32', arch = 'x64') {
  return crypto.createHash('sha256').update(await fs.readFile(requirementsForPlatform(platform, arch))).digest('hex');
}

export async function sharedPythonReady(host, python, fingerprint) {
  try {
    const marker = JSON.parse(await host.readFile(path.join(path.dirname(python), sharedPythonMarker)));
    return marker.format === 1 && marker.requirementsSha256 === fingerprint;
  } catch {
    return false;
  }
}
