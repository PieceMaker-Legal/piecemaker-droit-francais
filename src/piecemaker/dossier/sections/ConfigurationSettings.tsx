/**
 * "Réglages" card of the Configuration section: `GET`/`PUT /settings`, restricted
 * to the fields the backend handler (`server/piecemaker/vendor/websocket-server/admin-routes.cjs`,
 * `router.put('/settings', ...)`) actually reads from `req.body`. It also accepts
 * `PIECEMAKER_USER_NAME` (git commit identity) and `config.port`/`config.adminTheme` —
 * left out here on purpose: the first belongs to the excluded "commits" scope, the
 * second two are the standalone admin server's own port and the standalone page's
 * own theme, neither meaningful once PieceMaker runs embedded under CloudCLI.
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, Loader2, SlidersHorizontal, Trash2 } from 'lucide-react';

import { Button, Card, CardContent, CardHeader, CardTitle, Collapsible, CollapsibleContent, CollapsibleTrigger, Input } from '@/shared/ui';
import { pmGet, pmPut, PieceMakerApiError } from '@/piecemaker/dossier/api';

type SecretStatus = { configured: boolean; hint: string };

/** The 11 configurable segment names of a case's folder tree (`case-folder-structure.cjs`). */
type CaseFolderStructure = {
  administrative: string;
  correspondence: string;
  correspondenceClient: string;
  correspondenceOpposingCounsel: string;
  correspondenceThirdParties: string;
  correspondenceMarkdown: string;
  dataRoom: string;
  dataRoomMarkdown: string;
  drafts: string;
  notesAndResearch: string;
  procedure: string;
};

type SettingsResponse = {
  config: { pythonPath: string | null; venvPath: string; caseFolderStructure: CaseFolderStructure };
  env: { PYTHON_PATH?: string; LEGIFRANCE_ENV?: string; SMART_CONVERTER_PATH?: string };
  secrets: { LEGIFRANCE_CLIENT_ID: SecretStatus; LEGIFRANCE_CLIENT_SECRET: SecretStatus };
};

const CASE_FOLDER_FIELDS: { key: keyof CaseFolderStructure; label: string }[] = [
  { key: 'administrative', label: 'Administratif et facturation' },
  { key: 'correspondence', label: 'Correspondance (dossier racine)' },
  { key: 'correspondenceClient', label: 'Correspondance — Client' },
  { key: 'correspondenceOpposingCounsel', label: 'Correspondance — Avocats adverses' },
  { key: 'correspondenceThirdParties', label: 'Correspondance — Tiers' },
  { key: 'correspondenceMarkdown', label: 'Correspondance — Emails convertis (Markdown)' },
  { key: 'dataRoom', label: 'Data room (pièces)' },
  { key: 'dataRoomMarkdown', label: 'Data room — Pièces converties (Markdown)' },
  { key: 'drafts', label: 'Projets / brouillons' },
  { key: 'notesAndResearch', label: 'Notes et recherches' },
  { key: 'procedure', label: 'Procédure' },
];

export default function ConfigurationSettings() {
  // Read-only snapshot the form was initialized from; kept only to display `venvPath`
  // (not editable — the backend never accepts it in a PUT).
  const [loaded, setLoaded] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Editable fields, seeded from `loaded` once it arrives.
  const [pythonPath, setPythonPath] = useState('');
  const [legifranceEnv, setLegifranceEnv] = useState('production');
  const [smartConverterPath, setSmartConverterPath] = useState('');
  const [folders, setFolders] = useState<CaseFolderStructure | null>(null);
  // Secret inputs never round-trip the real value: they start empty, and a non-empty
  // value here is only sent to the server if the user actually typed one.
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  // Marks a configured secret for deletion via `clearSecrets`; mutually exclusive
  // with typing a replacement in the same field.
  const [clearedSecrets, setClearedSecrets] = useState<Set<'LEGIFRANCE_CLIENT_ID' | 'LEGIFRANCE_CLIENT_SECRET'>>(new Set());

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await pmGet<SettingsResponse>('/settings');
        if (cancelled) return;
        setLoaded(data);
        setPythonPath(data.env.PYTHON_PATH || '');
        setLegifranceEnv(data.env.LEGIFRANCE_ENV || 'production');
        setSmartConverterPath(data.env.SMART_CONVERTER_PATH || '');
        setFolders(data.config.caseFolderStructure);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const toggleClearSecret = (key: 'LEGIFRANCE_CLIENT_ID' | 'LEGIFRANCE_CLIENT_SECRET') => {
    setClearedSecrets((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const save = async () => {
    if (!folders) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const env: Record<string, string> = {
        // Omitting a key entirely leaves the corresponding .env line untouched
        // (`updateEnvFile` only rewrites the keys present in this object).
        PYTHON_PATH: pythonPath.trim(),
        LEGIFRANCE_ENV: legifranceEnv.trim(),
        SMART_CONVERTER_PATH: smartConverterPath.trim(),
      };
      if (clientId.trim()) env.LEGIFRANCE_CLIENT_ID = clientId.trim();
      if (clientSecret.trim()) env.LEGIFRANCE_CLIENT_SECRET = clientSecret.trim();

      await pmPut<{ ok: boolean }>('/settings', {
        config: { caseFolderStructure: folders },
        env,
        clearSecrets: Array.from(clearedSecrets),
      });
      setClientId('');
      setClientSecret('');
      setClearedSecrets(new Set());
      setSaved(true);
      // Refresh secret hints (e.g. new last-4 digits) without a full reload flash.
      const refreshed = await pmGet<SettingsResponse>('/settings');
      setLoaded(refreshed);
    } catch (cause) {
      setSaveError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-base">Réglages</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lecture des réglages…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Impossible de lire les réglages : {error}
          </div>
        )}

        {loaded && folders && (
          <>
            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Moteur Python</h3>
              <label className="block space-y-1">
                <span className="text-sm text-foreground">Interpréteur Python</span>
                <Input
                  value={pythonPath}
                  onChange={(event) => setPythonPath(event.target.value)}
                  placeholder="python3"
                />
                <span className="block text-xs text-muted-foreground">
                  Utilisé pour la conversion des pièces et l’anonymisation GLiNER. Laisser vide pour utiliser « python3 » du système.
                </span>
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-foreground">Environnement virtuel (venv)</span>
                <Input value={loaded.config.venvPath} readOnly disabled />
                <span className="block text-xs text-muted-foreground">Emplacement géré par l’installateur, non modifiable ici.</span>
              </label>
              <label className="block space-y-1">
                <span className="text-sm text-foreground">Convertisseur externe (optionnel)</span>
                <Input
                  value={smartConverterPath}
                  onChange={(event) => setSmartConverterPath(event.target.value)}
                  placeholder="Chemin de l’exécutable"
                />
              </label>
            </section>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Légifrance (API PISTE)</h3>
              {(['LEGIFRANCE_CLIENT_ID', 'LEGIFRANCE_CLIENT_SECRET'] as const).map((key) => {
                const status = loaded.secrets[key];
                const value = key === 'LEGIFRANCE_CLIENT_ID' ? clientId : clientSecret;
                const setValue = key === 'LEGIFRANCE_CLIENT_ID' ? setClientId : setClientSecret;
                const cleared = clearedSecrets.has(key);
                return (
                  <label key={key} className="block space-y-1">
                    <span className="text-sm text-foreground">{key === 'LEGIFRANCE_CLIENT_ID' ? 'Identifiant client' : 'Secret client'}</span>
                    <div className="flex items-center gap-2">
                      <Input
                        type="password"
                        value={value}
                        onChange={(event) => setValue(event.target.value)}
                        disabled={cleared}
                        placeholder={status.configured ? `Configuré (${status.hint})` : 'Non configuré'}
                      />
                      {status.configured && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Effacer cet identifiant"
                          onClick={() => toggleClearSecret(key)}
                        >
                          <Trash2 className={cleared ? 'h-4 w-4 text-destructive' : 'h-4 w-4'} />
                        </Button>
                      )}
                    </div>
                    {cleared && <span className="block text-xs text-destructive">Sera supprimé à l’enregistrement.</span>}
                  </label>
                );
              })}
              <label className="block space-y-1">
                <span className="text-sm text-foreground">Environnement PISTE</span>
                <Input value={legifranceEnv} onChange={(event) => setLegifranceEnv(event.target.value)} placeholder="production" />
              </label>
            </section>

            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-left">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Structure des dossiers de dossier</span>
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-transform data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid grid-cols-1 gap-2 pt-2 sm:grid-cols-2">
                  {CASE_FOLDER_FIELDS.map(({ key, label }) => (
                    <label key={key} className="block space-y-1">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <Input
                        value={folders[key]}
                        onChange={(event) => setFolders({ ...folders, [key]: event.target.value })}
                      />
                    </label>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {saveError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {saveError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={() => void save()} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Enregistrer
              </Button>
              {saved && !saving && <span className="text-sm text-muted-foreground">Réglages enregistrés.</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
