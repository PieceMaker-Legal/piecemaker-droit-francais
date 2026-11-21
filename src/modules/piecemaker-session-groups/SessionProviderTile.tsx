import { LLMProviderLogo } from '@/shared/ui';
import { cn } from '@/shared/utils';

type SessionProviderTileProps = {
  provider?: string | null;
  isSelected: boolean;
  isRunning: boolean;
  className: string;
  logoClassName: string;
};

export function SessionProviderTile({ provider, isSelected, isRunning, className, logoClassName }: SessionProviderTileProps) {
  return (
    <span
      data-running={isRunning || undefined}
      className={cn(
        'relative flex flex-shrink-0 items-center justify-center rounded-md',
        className,
        isRunning ? 'bg-orange-500/15 ring-1 ring-orange-500/80' : isSelected ? 'bg-primary/10' : 'bg-muted/50',
      )}
    >
      {isRunning && <span className="pm-session-blink absolute inset-0 rounded-md bg-orange-500/45" aria-hidden="true" />}
      <LLMProviderLogo provider={provider} className={cn('relative', logoClassName)} />
    </span>
  );
}
