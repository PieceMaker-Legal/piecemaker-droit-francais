import { capture } from './shell.mjs';
import { PRODUCT_NAME } from './paths.mjs';

export const CONSENT_TITLE = `${PRODUCT_NAME} — autorisation requise`;

export const CONSENT_EXPLANATION = [
  `${PRODUCT_NAME} fonctionne entièrement sur votre ordinateur.`,
  '',
  "Pour que le poste reconnaisse l'application et son serveur local comme fiables,",
  "l'installation doit enregistrer un certificat auto-signé propre à cette machine.",
  '',
  'Ce certificat :',
  '• est généré ici, à l\'instant, et ne quitte jamais votre ordinateur ;',
  '• sert uniquement à sécuriser https://localhost et à signer l\'application installée ;',
  '• est enregistré pour votre seul compte, sans privilège administrateur ;',
  '• peut être retiré à tout moment (procédure indiquée dans la documentation).',
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
