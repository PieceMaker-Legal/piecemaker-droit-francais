import fs from 'node:fs';
import path from 'node:path';

import { runCapture } from './exec.mjs';

function checked(command, args) {
  const result = runCapture(command, args);
  if (result.code !== 0) throw new Error(`Installation du bouton Relancer impossible : ${result.stderr || result.error || command}`);
}

export function installMacRelaunchHandler(command, directory) {
  const bundle = path.join(directory, 'PieceMaker Relance.app');
  const sourcePath = path.join(directory, 'relaunch.applescript');
  const quotedCommand = `'${command.replace(/'/g, `'"'"'`)}' --launch-only >/dev/null 2>&1 &`;
  const source = `on open location requestedURL
  if requestedURL is not "piecemaker-relaunch://start" then return
  do shell script ${JSON.stringify(quotedCommand)}
end open location
`;
  if (fs.existsSync(path.join(bundle, 'Contents', 'Info.plist')) && fs.existsSync(sourcePath) && fs.readFileSync(sourcePath, 'utf8') === source) return bundle;

  fs.mkdirSync(directory, { recursive: true });
  checked('/usr/bin/osacompile', ['-o', bundle, '-e', source]);
  const plist = path.join(bundle, 'Contents', 'Info.plist');
  const settings = {
    CFBundleIdentifier: 'legal.piecemaker.pwa.relaunch',
    CFBundleName: 'PieceMaker',
    CFBundleDisplayName: 'PieceMaker',
    LSUIElement: true,
    CFBundleURLTypes: [{ CFBundleURLName: 'PieceMaker', CFBundleURLSchemes: ['piecemaker-relaunch'], CFBundleTypeRole: 'Viewer' }],
  };
  for (const [key, value] of Object.entries(settings)) {
    checked('/usr/bin/plutil', ['-replace', key, '-json', JSON.stringify(value), plist]);
  }
  checked('/usr/bin/codesign', ['--force', '--sign', '-', bundle]);
  fs.writeFileSync(sourcePath, source, 'utf8');
  return bundle;
}
