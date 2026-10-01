import { useEffect, useRef, useState } from 'react';
import { Loader2, ScanText } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { pmGet, pmPost } from '@/piecemaker/dossier/api';
import { OCR_DECISION_EVENT, startAnonymization } from '@/piecemaker/dossier/anonymizationJobsCache';
import type { OcrDecisionRequest, OcrMissingChoice } from '@/piecemaker/dossier/anonymizationJobsCache';

type InstallJob = {
  id: string;
  state: 'running' | 'done' | 'failed';
  progress: string;
  error: string;
};

type Installation =
  | { phase: 'idle' }
  | { phase: 'running'; progress: string }
  | { phase: 'failed'; error: string };

const INSTALL_POLL_INTERVAL_MS = 1_500;
const LISTED_FILES = 6;

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function installMineru(onProgress: (progress: string) => void): Promise<void> {
  let { job } = await pmPost<{ job: InstallJob }>('/configuration/install', { component: 'mineru' });
  while (job.state === 'running') {
    onProgress(job.progress);
    await new Promise((resolve) => window.setTimeout(resolve, INSTALL_POLL_INTERVAL_MS));
    ({ job } = await pmGet<{ job: InstallJob }>('/configuration/install', { id: job.id }));
  }
  if (job.state === 'failed') throw new Error(job.error || 'installation interrompue');
}

function withRequest(requests: OcrDecisionRequest[], request: OcrDecisionRequest): OcrDecisionRequest[] {
  return [...requests.filter((current) => current.projectId !== request.projectId), request];
}

export function OcrDecisionDialog() {
  const [requests, setRequests] = useState<OcrDecisionRequest[]>([]);
  const [open, setOpen] = useState(false);
  const [installation, setInstallation] = useState<Installation>({ phase: 'idle' });
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const requestsRef = useRef<OcrDecisionRequest[]>([]);
  const installingRef = useRef(false);

  const replaceRequests = (next: OcrDecisionRequest[]) => {
    requestsRef.current = next;
    setRequests(next);
  };

  useEffect(() => {
    const receive = (event: Event) => {
      const request = (event as CustomEvent<OcrDecisionRequest>).detail;
      if (!request?.projectId) return;
      replaceRequests(withRequest(requestsRef.current, request));
      if (!installingRef.current) setOpen(true);
    };
    window.addEventListener(OCR_DECISION_EVENT, receive);
    return () => window.removeEventListener(OCR_DECISION_EVENT, receive);
  }, []);

  const relaunch = async (ocrMissing: OcrMissingChoice) => {
    const pending = requestsRef.current;
    replaceRequests([]);
    setLaunching(true);
    const failed: OcrDecisionRequest[] = [];
    const failures: string[] = [];
    for (const request of pending) {
      try {
        await startAnonymization(request, ocrMissing);
      } catch (cause) {
        failed.push(request);
        failures.push(`${request.projectName} : ${errorMessage(cause)}`);
      }
    }
    setLaunching(false);
    if (failed.length) {
      replaceRequests([...failed, ...requestsRef.current]);
      setLaunchError(`Relance impossible — ${failures.join(' · ')}`);
      setOpen(true);
      return;
    }
    setLaunchError(null);
    if (!requestsRef.current.length) setOpen(false);
  };

  const continueWithoutOcr = async () => {
    setInstallation({ phase: 'idle' });
    await relaunch('continue');
  };

  const installAndResume = async () => {
    setLaunchError(null);
    installingRef.current = true;
    setInstallation({ phase: 'running', progress: 'Démarrage de l’installation…' });
    try {
      await installMineru((progress) => setInstallation({ phase: 'running', progress }));
    } catch (cause) {
      setInstallation({ phase: 'failed', error: errorMessage(cause) });
      setOpen(true);
      return;
    } finally {
      installingRef.current = false;
    }
    setInstallation({ phase: 'idle' });
    await relaunch('ask');
  };

  const files = requests.flatMap((request) => request.files);
  const listedFiles = files.slice(0, LISTED_FILES);
  const projectNames = requests.map((request) => `« ${request.projectName} »`).join(', ');
  const plural = files.length > 1;
  const installing = installation.phase === 'running';

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && installing) setOpen(false); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg p-0">
        <DialogTitle>Pièces scannées</DialogTitle>
        <div className="border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2">
            <ScanText className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold">Pièces scannées : installer l’OCR ?</h2>
          </div>
        </div>
        {installing ? (
          <div className="space-y-2 px-5 py-4 text-sm">
            <p className="flex items-center gap-2 font-medium">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Installation de MinerU…
            </p>
            <p className="truncate text-xs text-muted-foreground" title={installation.progress}>{installation.progress}</p>
            <p className="text-xs text-muted-foreground">
              Vous pouvez masquer cette fenêtre : l’installation continue, et l’anonymisation reprendra d’elle-même à la fin.
            </p>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4 text-sm">
            <p>
              {files.length} pièce{plural ? 's' : ''} de {projectNames} {plural ? 'sont des scans' : 'est un scan'} : le texte
              n’y est qu’une image (PDF sans texte ou photo). Pour le lire, PieceMaker utilise MinerU, un moteur de
              reconnaissance de caractères (OCR) qui fonctionne entièrement sur ce poste. MinerU n’est pas installé.
            </p>
            <ul className="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-border/60 px-3 py-2 text-xs text-muted-foreground">
              {listedFiles.map((file) => <li key={file} className="truncate" title={file}>{file}</li>)}
              {files.length > listedFiles.length && <li>… et {files.length - listedFiles.length} autre(s)</li>}
            </ul>
            <div className="space-y-1">
              <p className="font-medium">Installer MinerU</p>
              <p className="text-xs text-muted-foreground">
                Téléchargement de plusieurs Go (bibliothèques et modèles) : de quelques minutes à une demi-heure selon
                la connexion. L’anonymisation reprend ensuite d’elle-même, avec la lecture des scans.
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-medium">Continuer sans OCR</p>
              <p className="text-xs text-muted-foreground">
                Les pièces scannées sont converties avec l’outil standard (MarkItDown), qui ne lit que le texte déjà
                présent dans un fichier. Pour un scan, le résultat est vide ou presque : l’IA ne pourra pas lire ces
                pièces et l’anonymisation n’y trouvera rien à masquer. Les autres pièces sont traitées normalement. Si
                MinerU est installé plus tard, ces pièces seront reconverties à la prochaine anonymisation.
              </p>
            </div>
            {installation.phase === 'failed' && (
              <p className="text-xs text-destructive" role="alert">L’installation de MinerU a échoué : {installation.error}</p>
            )}
            {launchError && <p className="text-xs text-destructive" role="alert">{launchError}</p>}
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-3">
          {installing ? (
            <Button variant="ghost" onClick={() => setOpen(false)}>Masquer</Button>
          ) : (
            <>
              <Button variant="ghost" disabled={launching} onClick={() => void continueWithoutOcr()}>Continuer sans OCR</Button>
              <Button disabled={launching} onClick={() => void installAndResume()}>
                {launching && <Loader2 className="h-4 w-4 animate-spin" />}
                {installation.phase === 'failed' ? 'Réessayer l’installation' : 'Installer MinerU'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
