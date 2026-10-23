import { capture } from './shell.mjs';
import { IS_MAC, PRODUCT_NAME } from './paths.mjs';

export const CONSENT_TITLE = `${PRODUCT_NAME} — autorisation requise`;

export const CONSENT_EXPLANATION = [
  `${PRODUCT_NAME} fonctionne entièrement sur votre ordinateur.`,
  '',
  "Pour sécuriser https://localhost (proxy d'anonymisation),",
  "l'installation enregistre une autorité de certification générée sur cet ordinateur.",
  '',
  'Cette autorité :',
  '• est créée ici, à l\'instant, et ne quitte jamais votre ordinateur ;',
  IS_MAC
    ? '• sécurise le serveur local et certifie une identité locale pour signer l’application ;'
    : '• sert uniquement au serveur local, pas à signer l\'application ;',
  '• est enregistrée pour votre seul compte, sans privilège administrateur ;',
  '• peut être retirée à tout moment (procédure indiquée dans la documentation).',
  '',
  'Autoriser son enregistrement ?',
].join('\n');

function escapeForPowerShell(value) {
  return value.replace(/'/g, "''");
}

export function askCertificateConsent() {
  const script = [
    'Add-Type -AssemblyName PresentationFramework;',
    `[System.Windows.MessageBox]::Show('${escapeForPowerShell(CONSENT_EXPLANATION)}', '${escapeForPowerShell(CONSENT_TITLE)}', 'OKCancel', 'Information')`,
  ].join(' ');
  const result = capture('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command', script,
  ]);
  return result.code === 0 && result.stdout.trim() === 'OK';
}
