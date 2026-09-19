import { IS_MAC } from './paths.mjs';

const implementation = IS_MAC
  ? await import('./certificates-darwin.mjs')
  : await import('./certificates-win32.mjs');

export const { generateCertificates, isCaTrusted, trustCertificateAuthority, signApplication } = implementation;
