export async function refreshApplication(): Promise<void> {
  const response = await fetch(window.location.href, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
  if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
    throw new Error('PieceMaker indisponible');
  }
  if ('serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  }
  window.location.reload();
}
