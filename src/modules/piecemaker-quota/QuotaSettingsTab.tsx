import { ArrowDown, ArrowUp, Layers, X } from 'lucide-react';

import { LLMProviderLogo } from '@/shared/ui';
import { ProviderModelList } from '@/modules/piecemaker-quota/ProviderModelList';
import { useProviderCatalogs } from '@/modules/piecemaker-quota/hooks/useProviderCatalogs';
import { useQuotaPreferences } from '@/modules/piecemaker-quota/hooks/useQuotaPreferences';
import { PROVIDER_NAMES } from '@/modules/piecemaker-quota/utils/quotaResume';
import type { QuotaChainEntry, QuotaResumeMode } from '@/modules/piecemaker-quota/utils/quotaResume';

const MODES: Array<{ value: QuotaResumeMode; label: string; hint: string }> = [
  { value: 'off', label: 'Me demander', hint: 'La carte de limite atteinte propose de reprendre plus tard ou avec un autre modèle ; rien ne part sans votre clic.' },
  { value: 'wait', label: 'Attendre la levée et reprendre', hint: 'La reprise est programmée dans la même session dès que la limite est levée (30 min plus tard quand le fournisseur ne donne pas d’heure).' },
  { value: 'chain', label: 'Basculer sur le modèle suivant de la chaîne', hint: 'Une nouvelle session s’ouvre aussitôt avec le premier modèle de la chaîne d’un autre fournisseur, et reçoit la fin de la conversation.' },
];

const sameEntry = (left: QuotaChainEntry, right: QuotaChainEntry) => left.provider === right.provider && left.model === right.model;

export function QuotaSettingsTab() {
  const { preferences, save } = useQuotaPreferences();
  const catalogs = useProviderCatalogs();
  const chain = preferences?.chain ?? [];
  const mode = preferences?.mode ?? 'off';

  const setChain = (next: QuotaChainEntry[]) => save({ mode, chain: next });
  const toggle = (entry: QuotaChainEntry) => setChain(chain.some((item) => sameEntry(item, entry)) ? chain.filter((item) => !sameEntry(item, entry)) : [...chain, entry]);
  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= chain.length) return;
    const next = [...chain];
    [next[index], next[target]] = [next[target], next[index]];
    setChain(next);
  };
  const label = (entry: QuotaChainEntry) => catalogs?.[entry.provider]?.OPTIONS.find((option) => option.value === entry.model)?.label || entry.model;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <Layers className="h-5 w-5 text-foreground" />
          <h3 className="text-lg font-medium text-foreground">Modèles et reprise</h3>
        </div>
        <p className="text-sm text-muted-foreground">Quand un fournisseur atteint sa limite d’utilisation, le chat affiche une carte pour reprendre le travail. Réglez ici ce qui se passe par défaut et l’ordre des modèles de secours.</p>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-foreground">Reprise automatique</h4>
        <div className="space-y-2" role="radiogroup" aria-label="Reprise automatique">
          {MODES.map((option) => (
            <label key={option.value} className={`flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 ${mode === option.value ? 'border-primary bg-primary/5' : 'border-border/60'}`}>
              <input type="radio" name="quota-resume-mode" className="mt-1" checked={mode === option.value} disabled={!preferences} onChange={() => save({ mode: option.value, chain })} />
              <span>
                <span className="block text-sm font-medium text-foreground">{option.label}</span>
                <span className="block text-xs text-muted-foreground">{option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-foreground">Chaîne de priorité</h4>
        <p className="text-xs text-muted-foreground">Le premier modèle d’un autre fournisseur que celui qui a atteint sa limite est proposé en premier, et utilisé par la bascule automatique.</p>
        {chain.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/60 px-4 py-3 text-sm text-muted-foreground">Aucun modèle dans la chaîne : cliquez sur un modèle ci-dessous pour l’ajouter.</p>
        ) : (
          <ol className="space-y-1.5">
            {chain.map((entry, index) => (
              <li key={`${entry.provider}:${entry.model}`} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2 text-sm">
                <span className="w-5 text-xs text-muted-foreground">{index + 1}.</span>
                <LLMProviderLogo provider={entry.provider} className="h-4 w-4" />
                <span className="min-w-0 flex-1 truncate text-foreground">{PROVIDER_NAMES[entry.provider]} · {label(entry)}</span>
                <button type="button" aria-label="Monter" disabled={index === 0} onClick={() => move(index, -1)} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label="Descendre" disabled={index === chain.length - 1} onClick={() => move(index, 1)} className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label="Retirer" onClick={() => toggle(entry)} className="rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-3.5 w-3.5" /></button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold text-foreground">Modèles disponibles</h4>
        <p className="text-xs text-muted-foreground">Les modèles de chaque fournisseur connecté. Cliquez pour ajouter un modèle à la chaîne ou l’en retirer.</p>
        <ProviderModelList catalogs={catalogs} disabled={!preferences} isSelected={(entry) => chain.some((item) => sameEntry(item, entry))} onSelect={toggle} />
      </section>
    </div>
  );
}
