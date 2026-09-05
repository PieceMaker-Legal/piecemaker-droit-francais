/**
 * Carte « Anonymisation » de la section Configuration : l'état du proxy PII qui
 * remplace LiteLLM.
 *
 * Elle répond aux trois seules questions que l'utilisateur se pose avant de
 * confier un dossier à l'IA : est-ce que les noms sont bien remplacés avant de
 * partir, combien d'identités sont couvertes, et quels clients IA sont
 * réellement filtrés. Le fichier de mapping n'est jamais affiché — seulement
 * son décompte et sa date.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, ShieldCheck, ShieldOff } from 'lucide-react';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@/shared/ui';
import { pmGet, pmPost, PieceMakerApiError } from '@/piecemaker/dossier/api';

/**
 * `filtered` : le client passe par le proxy. `blocked` : il ne peut pas être
 * filtré et est donc empêché de s'exécuter. `unconfigured` : son câblage a
 * échoué — c'est le seul état qui demande une action.
 */
type CoverageState = 'filtered' | 'blocked' | 'unconfigured';

type Coverage = Record<string, { state: CoverageState; detail: string | null }>;

const COVERAGE_LABELS: Record<CoverageState, string> = {
  filtered: 'filtré',
  blocked: 'bloqué',
  unconfigured: 'non filtré',
};

const CLIENT_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  opencode: 'opencode',
};

type AnonymizerStatus = {
  enabled: boolean;
  reason: string;
  origin: string | null;
  upstream: string | null;
  dictionary: {
    exists: boolean;
    entityCount: number;
    codeCount: number;
    updatedAt: string | null;
    empty: boolean;
  };
  coverage: Coverage;
  stats: { requests: number; anonymized: number; deanonymized: number; failures: number } | null;
};

function formatDate(value: string | null): string {
  if (!value) return 'jamais';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('fr-FR');
}

export default function ConfigurationAnonymizer() {
  const [status, setStatus] = useState<AnonymizerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (refresh = false) => {
    setBusy(true);
    setError(null);
    try {
      const payload = refresh
        ? await pmPost<AnonymizerStatus>('/anonymizer/refresh')
        : await pmGet<AnonymizerStatus>('/anonymizer/status');
      setStatus(payload);
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : 'Statut indisponible.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = Boolean(status?.enabled);
  const covered = status?.dictionary.entityCount ?? 0;
  const clients = Object.entries(status?.coverage ?? {});
  const uncovered = clients.filter(([, value]) => value.state === 'unconfigured');

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          {active ? (
            <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <ShieldOff className="h-4 w-4 text-muted-foreground" />
          )}
          <CardTitle className="text-base">Anonymisation</CardTitle>
          <Badge variant={active ? 'default' : 'secondary'}>{active ? 'Active' : 'Inactive'}</Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load(true)} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        </Button>
      </CardHeader>

      <CardContent className="space-y-3 text-sm">
        {error && (
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-muted-foreground">
          Les noms des parties sont remplacés par un code avant tout envoi à l’IA, puis rétablis dans la réponse.
          Ce qui a voyagé sous un code apparaît{' '}
          <span className="rounded-[2px] bg-orange-500/[0.18] px-0.5">surligné en orange</span> dans le chat.
        </p>

        {status && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-muted-foreground">
            <dt>Identités couvertes</dt>
            <dd className="text-foreground">{covered}</dd>
            <dt>Mapping mis à jour</dt>
            <dd className="text-foreground">{formatDate(status.dictionary.updatedAt)}</dd>
            {active && status.upstream && (
              <>
                <dt>Relais</dt>
                <dd className="text-foreground">{status.upstream}</dd>
              </>
            )}
            {!active && (
              <>
                <dt>Motif</dt>
                <dd className="text-foreground">{status.reason}</dd>
              </>
            )}
          </dl>
        )}

        {clients.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Clients IA</p>
            <ul className="space-y-1">
              {clients.map(([name, value]) => (
                <li key={name} className="flex items-center gap-2">
                  <Badge
                    variant={value.state === 'filtered' ? 'default' : value.state === 'blocked' ? 'secondary' : 'destructive'}
                  >
                    {COVERAGE_LABELS[value.state]}
                  </Badge>
                  <span className="text-foreground">{CLIENT_LABELS[name] ?? name}</span>
                  {value.detail && <span className="text-xs text-muted-foreground">{value.detail}</span>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Cursor n’accepte aucun relais : son protocole ignore toute base d’URL. Il est bloqué tant qu’un mapping
              existe, plutôt que d’envoyer les noms en clair.
            </p>
          </div>
        )}

        {uncovered.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Câblage incomplet : {uncovered.map(([name]) => CLIENT_LABELS[name] ?? name).join(', ')} peut encore
              contacter son fournisseur sans passer par le filtre.
            </span>
          </div>
        )}

        {status && status.dictionary.empty && (
          <p className="text-muted-foreground">
            Aucun mapping pour l’instant : le relais laisse passer les échanges tels quels. Lancez la conversion des
            pièces d’un dossier pour peupler le mapping.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
