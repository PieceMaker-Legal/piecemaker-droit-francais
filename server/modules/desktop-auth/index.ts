import { getConnection } from '@/modules/database/index.js';

import { createDesktopAuthService } from './desktop-auth.service.js';
import { createDesktopAuthRouter } from './desktop-auth.routes.js';

const secret = process.env.PIECEMAKER_DESKTOP_AUTH_SECRET;
delete process.env.PIECEMAKER_DESKTOP_AUTH_SECRET;

export function desktopAuthRoutes() {
  return createDesktopAuthRouter(createDesktopAuthService(getConnection()), secret);
}
