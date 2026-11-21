import type { LLMProvider } from '@/shared/types';
import { useProviderCatalogs } from '@/modules/piecemaker-quota/hooks/useProviderCatalogs';
import { PROVIDER_NAMES } from '@/modules/piecemaker-quota/utils/quotaResume';

type ModelSelectProps = {
  providers: LLMProvider[];
  value: string;
  onChange: (model: string) => void;
  className?: string;
  disabled?: boolean;
  defaultLabel?: string;
};

export function ModelSelect({ providers, value, onChange, className, disabled, defaultLabel = 'Modèle par défaut' }: ModelSelectProps) {
  const catalogs = useProviderCatalogs();
  const groups = providers.map((provider) => ({ provider, options: catalogs?.[provider]?.OPTIONS ?? [] })).filter((group) => group.options.length > 0);
  const known = groups.some((group) => group.options.some((option) => option.value === value));
  const renderOptions = (options: typeof groups[number]['options']) => options.map((option) => <option key={option.value} value={option.value}>{option.label || option.value}</option>);

  return (
    <select className={className} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      <option value="">{catalogs ? defaultLabel : 'Chargement des modèles…'}</option>
      {value && !known && <option value={value}>{value}</option>}
      {groups.length === 1
        ? renderOptions(groups[0].options)
        : groups.map((group) => <optgroup key={group.provider} label={PROVIDER_NAMES[group.provider]}>{renderOptions(group.options)}</optgroup>)}
    </select>
  );
}
