/**
 * "Entités institutionnelles" card: the global list of names GLiNER must never
 * anonymize (courts, registries, official publications — see
 * `institutional-terms.cjs`). Kept as a searchable add/remove list rather than a
 * single textarea because production lists run into the hundreds of entries.
 * Changes are batched and sent as one `PUT /institutional-terms` on demand, matching
 * the backend, which always rewrites the whole list rather than patching one entry.
 */

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Landmark, Loader2, Plus, X } from 'lucide-react';

import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from '@/shared/ui';
import { pmGet, pmPut, PieceMakerApiError } from '@/piecemaker/dossier/api';

type InstitutionalTermsResponse = { file: string; terms: string[] };

/** Mirrors `normalizeForMatch` in `institutional-terms.cjs`: accent/case-insensitive comparison key. */
function normalizeForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['‘’ʼ´`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export default function ConfigurationInstitutionalTerms() {
  // Working copy the user edits; only sent to the server when "Enregistrer" is pressed.
  const [terms, setTerms] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // What was last loaded or saved, to know whether there is anything to save.
  const [baseline, setBaseline] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [newTerm, setNewTerm] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await pmGet<InstitutionalTermsResponse>('/institutional-terms');
        if (cancelled) return;
        setTerms(data.terms);
        setBaseline(data.terms);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!terms) return [];
    const needle = normalizeForMatch(search);
    if (!needle) return terms;
    return terms.filter((term) => normalizeForMatch(term).includes(needle));
  }, [terms, search]);

  const dirty = terms !== null && (terms.length !== baseline.length || terms.some((term, index) => term !== baseline[index]));

  const addTerm = () => {
    const clean = newTerm.replace(/\s+/g, ' ').trim();
    if (!clean || !terms) return;
    const key = normalizeForMatch(clean);
    if (terms.some((term) => normalizeForMatch(term) === key)) {
      setAddError(`« ${clean} » figure déjà dans la liste.`);
      return;
    }
    setAddError(null);
    setTerms([...terms, clean]);
    setNewTerm('');
  };

  const removeTerm = (term: string) => {
    if (!terms) return;
    setTerms(terms.filter((entry) => entry !== term));
  };

  const save = async () => {
    if (!terms) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const data = await pmPut<InstitutionalTermsResponse>('/institutional-terms', { terms });
      setTerms(data.terms);
      setBaseline(data.terms);
      setSaved(true);
    } catch (cause) {
      setSaveError(cause instanceof PieceMakerApiError ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <Landmark className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-base">Entités institutionnelles à ne jamais anonymiser</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Tribunaux, greffes, registres et publications officielles : ces noms ne sont pas des données
          personnelles et resteront en clair dans les pièces anonymisées.
        </p>

        {loading && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lecture de la liste…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Impossible de lire la liste : {error}
          </div>
        )}

        {terms && (
          <>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={newTerm}
                onChange={(event) => { setNewTerm(event.target.value); setAddError(null); }}
                onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTerm(); } }}
                placeholder="Ajouter une entité (ex. Tribunal de Commerce de Nanterre)"
              />
              <Button type="button" variant="outline" onClick={addTerm} disabled={!newTerm.trim()}>
                <Plus className="h-4 w-4" />
                Ajouter
              </Button>
            </div>
            {addError && <p className="text-xs text-destructive">{addError}</p>}

            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={`Rechercher parmi ${terms.length} entités…`}
              className="max-w-sm"
            />

            <div className="max-h-64 overflow-y-auto rounded-md border border-border/60 bg-muted/20 p-2">
              {filtered.length === 0 ? (
                <p className="p-2 text-sm text-muted-foreground">Aucune entité ne correspond à cette recherche.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {filtered.map((term) => (
                    <Badge key={term} variant="secondary" className="gap-1 py-1 pl-2.5 pr-1 font-normal">
                      {term}
                      <button
                        type="button"
                        onClick={() => removeTerm(term)}
                        aria-label={`Retirer ${term}`}
                        className="rounded-sm p-0.5 hover:bg-secondary-foreground/10"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {saveError && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                {saveError}
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button onClick={() => void save()} disabled={saving || !dirty}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                Enregistrer
              </Button>
              {dirty && !saving && <span className="text-sm text-muted-foreground">Modifications non enregistrées.</span>}
              {saved && !dirty && !saving && <span className="text-sm text-muted-foreground">Liste enregistrée.</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
