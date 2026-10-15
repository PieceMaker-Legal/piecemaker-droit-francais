export function configureWindowsUpdates(manifest, repository, signed, icon) {
  const [owner, repo] = repository.split('/');
  manifest.build.publish = [{ provider: 'github', owner, repo, releaseType: 'release' }];
  manifest.build.win = { ...manifest.build.win, verifyUpdateCodeSignature: signed };
  manifest.build.nsis = {
    ...manifest.build.nsis,
    installerIcon: icon,
    uninstallerIcon: icon,
    oneClick: true,
    perMachine: false,
    allowElevation: false,
    runAfterFinish: false,
    createDesktopShortcut: true,
  };
}
