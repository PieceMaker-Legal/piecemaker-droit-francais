import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';

import { Button } from '@/shared/ui/Button';

/** Adapte les cartes Mike aux contrôles PieceMaker. */
export function PillButtonUI({ tone, size: _size, loading, disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone: string; size?: string; loading?: boolean }) {
  return <Button type="button" size="sm" variant={tone === 'white' ? 'secondary' : 'default'} disabled={disabled || loading} {...props} />;
}

/** Adapte la fermeture des cartes Mike. */
export function TextButtonUI({ size: _size, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { size?: string }) {
  return <Button type="button" size="sm" variant="ghost" {...props} />;
}

/** Conserve l’aperçu textuel des cartes Mike dans la surface PieceMaker. */
export function TextSlabUI({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`rounded-md bg-muted px-3 py-2 ${className ?? ''}`} {...props} />;
}
