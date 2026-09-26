export function formatDateIso(dateIso: string | null | undefined): string {
  if (!dateIso) return 'Date inconnue';
  const date = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateIso;
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}
