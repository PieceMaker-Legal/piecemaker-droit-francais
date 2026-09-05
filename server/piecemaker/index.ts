import { createRequire } from 'module';
import path from 'path';

import type { Router } from 'express';

import { findApplicationRoot, getModuleDirectory } from '@/shared/utils.js';

/**
 * Point d'entrée PieceMaker. Les modules repris de PieceMaker-Installer sont du
 * CommonJS vendorisé sous `server/piecemaker/vendor/` : `createRequire` les
 * charge tels quels, sans les convertir ni les faire passer par `tsc`.
 *
 * Le chemin est résolu depuis la racine applicative, pas depuis `__dirname` :
 * compilé, ce fichier vit sous `dist-server/server/piecemaker/`, alors que le
 * `vendor/` (CommonJS, Python, gabarits Markdown) reste dans l'arbre source.
 */
const applicationRoot = findApplicationRoot(getModuleDirectory(import.meta.url));
const routerPath = path.join(applicationRoot, 'server', 'piecemaker', 'router.cjs');

type PieceMakerRuntimeStatus = {
  port?: number | string;
  host?: string;
  libreOffice?: boolean;
};

type PieceMakerVendorModule = {
  createPieceMakerRouter(options?: { getRuntimeStatus?: () => PieceMakerRuntimeStatus }): Router;
  piecemakerHome(): string;
};

const vendor = createRequire(import.meta.url)(routerPath) as PieceMakerVendorModule;

export const { createPieceMakerRouter, piecemakerHome } = vendor;
export type { PieceMakerRuntimeStatus };
