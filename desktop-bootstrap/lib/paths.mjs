import os from 'node:os';
import path from 'node:path';

export const IS_MAC = process.platform === 'darwin';
export const IS_WINDOWS = process.platform === 'win32';

export const PRODUCT_NAME = 'PieceMaker';
export const CA_COMMON_NAME = 'PieceMaker Local CA';
export const TLS_COMMON_NAME = 'localhost';
export const SIGNING_COMMON_NAME = 'PieceMaker Local Signing';

export const dataHome = process.env.PIECEMAKER_HOME || path.join(os.homedir(), '.piecemaker');
export const certsDir = path.join(dataHome, 'certs');
export const bootstrapHome = process.env.PIECEMAKER_BOOTSTRAP_HOME || path.join(dataHome, 'bootstrap');
export const sourceDir = process.env.PIECEMAKER_SRC_DIR || '';
export const releaseTag = process.env.PIECEMAKER_TAG || 'inconnu';

export const caCertPath = path.join(certsDir, 'piecemaker-ca.crt');
export const caKeyPath = path.join(certsDir, 'piecemaker-ca.key');
export const tlsCertPath = path.join(certsDir, 'localhost.crt');
export const tlsKeyPath = path.join(certsDir, 'localhost.key');
export const signingCertPath = path.join(certsDir, 'piecemaker-signing.crt');
export const signingKeyPath = path.join(certsDir, 'piecemaker-signing.key');
export const signingBundlePath = path.join(certsDir, 'piecemaker-signing.p12');
export const signingSecretPath = path.join(certsDir, 'signing-keychain.secret');
export const trustMarkerPath = path.join(certsDir, 'trusted.json');

export function installTargetCandidates() {
  if (IS_MAC) {
    return ['/Applications', path.join(os.homedir(), 'Applications')];
  }
  return [path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs')];
}
