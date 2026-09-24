type PiecemakerDesktopBridge = {
  uninstall: () => Promise<unknown>;
};

export function desktopUninstallBridge(): PiecemakerDesktopBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = (window as Window & { piecemakerDesktop?: PiecemakerDesktopBridge }).piecemakerDesktop;
  return typeof bridge?.uninstall === 'function' ? bridge : null;
}

export function hasDesktopUninstall(): boolean {
  return desktopUninstallBridge() !== null;
}
