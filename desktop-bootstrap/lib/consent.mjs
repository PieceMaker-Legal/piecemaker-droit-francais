import { capture, osascript } from './shell.mjs';
import { IS_MAC, PRODUCT_NAME } from './paths.mjs';

const TITLE = `${PRODUCT_NAME} — autorisation requise`;

const EXPLANATION = [
  `${PRODUCT_NAME} fonctionne entièrement sur votre ordinateur.`,
  '',
  "Pour que le poste reconnaisse l'application et son serveur local comme fiables,",
  "l'installation doit enregistrer un certificat auto-signé propre à cette machine.",
  '',
  'Ce certificat :',
  '• est généré ici, à l\'instant, et ne quitte jamais votre ordinateur ;',
  '• sert uniquement à sécuriser https://localhost et à signer l\'application installée ;',
  '• peut être retiré à tout moment (procédure indiquée dans la documentation).',
  '',
  'Autoriser son enregistrement ?',
].join('\n');

function escapeForAppleScript(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function escapeForPowerShell(value) {
  return value.replace(/'/g, "''");
}

function askOnMac() {
  const script = `display dialog "${escapeForAppleScript(EXPLANATION)}" with title "${escapeForAppleScript(TITLE)}" buttons {"Annuler", "Autoriser"} default button "Autoriser" cancel button "Annuler" with icon note`;
  const result = osascript(script);
  return result.code === 0 && result.stdout.includes('Autoriser');
}

function askOnWindows() {
  const script = [
    'Add-Type -AssemblyName PresentationFramework;',
    `[System.Windows.MessageBox]::Show('${escapeForPowerShell(EXPLANATION)}', '${escapeForPowerShell(TITLE)}', 'OKCancel', 'Information')`,
  ].join(' ');
  const result = capture('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-Command', script,
  ]);
  return result.code === 0 && result.stdout.trim() === 'OK';
}

export function askCertificateConsent() {
  return IS_MAC ? askOnMac() : askOnWindows();
}
