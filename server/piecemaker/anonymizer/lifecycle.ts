type AnonymizerService = {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  status(): { enabled: boolean; listening: boolean; coverage: Record<string, { state: string }> };
};

export async function startRequiredAnonymizer(service: AnonymizerService) {
  const ensureReady = () => {
    const status = service.status();
    if (!status.enabled || !status.listening) throw new Error('PieceMaker : le proxy PII est indisponible. Démarrage IA refusé.');
    const missing = ['claude', 'codex'].filter((provider) => status.coverage[provider]?.state !== 'filtered');
    if (missing.length) throw new Error(`PieceMaker : routage PII non configuré pour ${missing.join(', ')}. Démarrage IA refusé.`);
  };
  try {
    await service.start();
    ensureReady();
  } catch (error) {
    await service.stop();
    throw error;
  }
  return ensureReady;
}
