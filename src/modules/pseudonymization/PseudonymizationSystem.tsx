import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Download, FileText, Loader2, Pause, ScanSearch, ShieldCheck } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle } from '@/shared/ui';
import { usePseudonymization } from '@/modules/pseudonymization/hooks/usePseudonymization';
import type { PseudonymizationModelId } from '@/shared/piecemaker/types';
import '@/modules/pseudonymization/pseudonymization.css';

const MODELS: { id: PseudonymizationModelId; name: string; label: string; description: string; icon: typeof FileText }[] = [
  {
    id: 'mineru', name: 'MinerU', label: 'Rendre vos documents lisibles', icon: FileText,
    description: 'Vos documents sont convertis en fichiers Markdown, un format texte facile à lire et à analyser. MinerU reconnaît le texte des scans et des photos, et restitue leur mise en page et leurs tableaux.',
  },
  {
    id: 'gliner', name: 'GLiNER', label: 'Repérer les informations sensibles', icon: ScanSearch,
    description: 'Un modèle local parcourt le texte pour détecter les noms, sociétés, adresses et autres informations sensibles. Ces repères permettent à PieceMaker de les remplacer par des pseudonymes dans les échanges avec l’IA.',
  },
];

export function PseudonymizationSystem({ buttonSlots }: { buttonSlots: HTMLElement[] }) {
  const [open, setOpen] = useState(false);
  const { models, jobs, error, paused, retry, pause, resume } = usePseudonymization();
  const running = jobs.some((job) => job.state === 'running');
  const loaded = MODELS.every(({ id }) => models[id]);
  const ready = !running && MODELS.every(({ id }) => models[id]?.installed);
  const failed = jobs.some((job) => job.state !== 'running' && job.state !== 'paused' && !models[job.component]?.installed);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('piecemaker:pseudonymization-open', show);
    return () => window.removeEventListener('piecemaker:pseudonymization-open', show);
  }, []);

  return <>
    {loaded && !ready && buttonSlots.map((slot, index) => createPortal(
      <button type="button" className="pm-pseudo-trigger" aria-label="Système de pseudonymisation" title="Système de pseudonymisation" onClick={() => setOpen(true)}>
        <ShieldCheck size={16} aria-hidden="true" />
        {running && <span className="pm-pseudo-dot" aria-hidden="true" />}
      </button>, slot, String(index),
    ))}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="pm-pseudo-dialog" aria-labelledby="pm-pseudo-title">
        <div className="pm-pseudo-heading">
          <span className="pm-pseudo-eyebrow">VOTRE ESPACE CONFIDENTIEL</span>
          <DialogTitle id="pm-pseudo-title" className="not-sr-only pm-pseudo-title">Système de pseudonymisation</DialogTitle>
          <p>Préparer vos documents et protéger les informations de vos dossiers, directement sur votre ordinateur.</p>
        </div>
        <div className="pm-pseudo-summary" role="status">
          {ready ? <Check size={16} /> : running ? <Loader2 size={16} className="animate-spin" /> : paused ? <Pause size={16} /> : <Download size={16} />}
          <div>
            <strong>{ready ? 'Votre système est prêt' : running ? 'Votre système se prépare en arrière-plan' : paused ? 'Préparation en pause' : failed || error ? 'La préparation nécessite votre attention' : 'Votre système se prépare en arrière-plan'}</strong>
            <p>{ready ? 'La conversion et la détection locale sont disponibles.' : paused ? 'Aucun téléchargement n’est en cours. La préparation reprendra lorsque vous cliquerez sur Reprendre.' : 'Les outils manquants se téléchargent automatiquement. Vous pouvez continuer à utiliser PieceMaker et fermer cette fenêtre.'}</p>
          </div>
        </div>
        <div className="pm-pseudo-steps">
          {MODELS.map(({ id, name, label, description, icon: Icon }, index) => {
            const job = jobs.filter((entry) => entry.component === id).slice(-1)[0];
            const installed = models[id]?.installed;
            const busy = job?.state === 'running';
            const interrupted = job && job.state !== 'running' && job.state !== 'paused';
            return <section key={id} className="pm-pseudo-step">
              <div className="pm-pseudo-step-header">
                <Icon size={18} aria-hidden="true" />
                <h3>{index + 1}. {label}</h3>
                <span>{name}</span>
              </div>
              <p>{description}</p>
              <div className="pm-pseudo-model-status" role="status">
                {installed ? <Check size={14} /> : busy ? <Loader2 size={14} className="animate-spin" /> : paused ? <Pause size={14} /> : <Download size={14} />}
                <span>{installed ? 'Installé sur cet ordinateur' : busy ? 'Téléchargement et installation en cours…' : paused ? 'En pause' : interrupted ? 'Installation à reprendre' : 'En attente de préparation'}</span>
              </div>
              {busy && <div className="pm-pseudo-progress" role="progressbar" aria-label={`Installation de ${name}`}><span /></div>}
              {busy && job.progress && <details className="pm-pseudo-details"><summary>Détail de la progression</summary><p>{job.progress}</p></details>}
              {!installed && interrupted && !paused && <p className="pm-pseudo-error">{job.error || 'La préparation n’est pas complète. Vous pouvez réessayer.'}</p>}
            </section>;
          })}
        </div>
        <div className="pm-pseudo-local"><ShieldCheck size={18} aria-hidden="true" /><p>Conçu pour fonctionner en toute autonomie sur votre ordinateur. Après le téléchargement initial, la conversion et la détection s’effectuent localement, sans envoyer vos documents à un service externe.</p></div>
        {error && <p className="pm-pseudo-error" role="alert">{error}</p>}
        <div className="pm-pseudo-actions">
          {running && <button type="button" className="piecemaker-button piecemaker-button--glass piecemaker-button--sm" onClick={() => void pause()}>Mettre en pause</button>}
          {paused && !running && !ready && <button type="button" className="piecemaker-button piecemaker-button--glass piecemaker-button--sm" onClick={() => void resume()}>Reprendre</button>}
          {(failed || error) && !running && !paused && <button type="button" className="piecemaker-button piecemaker-button--glass piecemaker-button--sm" onClick={retry}>Réessayer</button>}
          <button type="button" className="piecemaker-button piecemaker-button--black piecemaker-button--sm" onClick={() => setOpen(false)}>Compris</button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
