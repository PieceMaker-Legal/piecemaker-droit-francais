import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';

import SettingsCard from '@/modules/settings/SettingsCard';
import SettingsSection from '@/modules/settings/SettingsSection';
import { authenticatedFetch } from '@/shared/api';
import { Button } from '@/shared/ui';

type Rappels = { actif: boolean; heure: string | null; destination: string | null };

async function read(response: Response): Promise<Rappels> {
  const payload = await response.json().catch(() => null) as (Rappels & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error || 'Rappels indisponibles.');
  return payload;
}

/** Daily deadline reminders of every dossier, sent by Hermes to the phone. */
export default function RappelsSection() {
  const [rappels, setRappels] = useState<Rappels | null>(null);
  const [heure, setHeure] = useState('08:00');
  const [destination, setDestination] = useState('telegram');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    authenticatedFetch('/api/piecemaker/hermes/rappels').then(read).then((value) => {
      setRappels(value);
      if (value.heure) setHeure(value.heure);
      if (value.destination) setDestination(value.destination);
    }, (failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
  }, []);

  const save = async (actif: boolean) => {
    setBusy(true);
    setError(null);
    try {
      setRappels(await read(await authenticatedFetch('/api/piecemaker/hermes/rappels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actif, heure, destination }),
      })));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      title="Rappels d’échéances"
      description="Chaque jour, Hermes envoie sur votre téléphone les échéances en retard et celles des 7 prochains jours, pour tous les dossiers. Aucun modèle n’est appelé. La passerelle doit être démarrée."
    >
      <SettingsCard>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <BellRing className="mb-2 h-4 w-4 text-muted-foreground" />
            <label className="flex flex-col gap-1 text-muted-foreground">
              Heure
              <input type="time" value={heure} onChange={(event) => setHeure(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-foreground" />
            </label>
            <label className="flex flex-col gap-1 text-muted-foreground">
              Destination
              <input value={destination} onChange={(event) => setDestination(event.target.value)} className="w-40 rounded-md border border-border bg-background px-2 py-1 font-mono text-foreground" />
            </label>
            <span className="mb-1 text-muted-foreground">
              {rappels?.actif ? `Actifs à ${rappels.heure ?? heure}, vers ${rappels.destination ?? destination}.` : 'Inactifs.'}
            </span>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={() => void save(true)}>
              {rappels?.actif ? 'Mettre à jour' : 'Activer'}
            </Button>
            {rappels?.actif && (
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void save(false)}>
                Désactiver
              </Button>
            )}
          </div>
        </div>
        {error && <div className="border-t border-border px-4 py-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
      </SettingsCard>
    </SettingsSection>
  );
}
