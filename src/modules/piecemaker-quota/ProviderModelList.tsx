import { Check, Loader2 } from 'lucide-react';

import { LLMProviderLogo } from '@/shared/ui';
import type { LLMProvider } from '@/shared/types';
import { PROVIDER_NAMES, QUOTA_PROVIDERS } from '@/modules/piecemaker-quota/utils/quotaResume';
import type { QuotaChainEntry } from '@/modules/piecemaker-quota/utils/quotaResume';
import type { ProviderCatalogs } from '@/modules/piecemaker-quota/hooks/useProviderCatalogs';

type ProviderModelListProps = {
  catalogs: ProviderCatalogs | null;
  onSelect: (entry: QuotaChainEntry) => void;
  isSelected?: (entry: QuotaChainEntry) => boolean;
  limitedProvider?: LLMProvider | string;
  disabled?: boolean;
};

export function ProviderModelList({ catalogs, onSelect, isSelected, limitedProvider, disabled }: ProviderModelListProps) {
  if (!catalogs) {
    return (
      <div role="status" className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Chargement des modèles…
      </div>
    );
  }

  const providers = QUOTA_PROVIDERS.filter((provider) => catalogs[provider]?.OPTIONS.length);
  if (providers.length === 0) {
    return <p className="py-3 text-sm text-muted-foreground">Aucun modèle disponible : connectez un fournisseur dans Paramètres › Agents.</p>;
  }

  return (
    <div className="space-y-3">
      {providers.map((provider) => (
        <div key={provider} data-provider={provider}>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <LLMProviderLogo provider={provider} className="h-3.5 w-3.5" />
            {PROVIDER_NAMES[provider]}
            {provider === limitedProvider && <span className="font-normal normal-case tracking-normal text-amber-600 dark:text-amber-400">· limite atteinte</span>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {catalogs[provider]!.OPTIONS.map((option) => {
              const entry = { provider, model: option.value };
              const selected = isSelected?.(entry) ?? false;
              return (
                <button
                  key={option.value}
                  type="button"
                  disabled={disabled}
                  title={option.description || option.value}
                  onClick={() => onSelect(entry)}
                  className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors disabled:opacity-50 ${selected ? 'border-primary bg-primary/10 text-foreground' : 'border-border/60 text-foreground hover:bg-accent'}`}
                >
                  {selected && <Check className="h-3 w-3" />}
                  {option.label || option.value}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
