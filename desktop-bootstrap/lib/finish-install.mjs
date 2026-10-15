import { finishProgress, openProgressWindow, settleProgressWindow } from './progress.mjs';
import { launchApplication } from './place.mjs';
import { PRODUCT_NAME, releaseTag } from './paths.mjs';

const installedPath = process.argv[2];
if (!installedPath) {
  console.error("Le dossier d'installation est absent.");
  process.exit(1);
}

await openProgressWindow({ version: releaseTag, offerPiste: true });
finishProgress({ ok: true, message: `${PRODUCT_NAME} est installé.` });
await settleProgressWindow({
  launch: () => launchApplication(installedPath),
});
