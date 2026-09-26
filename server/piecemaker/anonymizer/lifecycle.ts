type AnonymizerService = {
  start(): Promise<unknown>;
  stop(): Promise<unknown>;
  status(): { enabled: boolean; listening: boolean; reason?: string };
};

export async function startRequiredAnonymizer(service: AnonymizerService) {
  const ensureReady = () => {
    const status = service.status();
    if (status.reason === 'disabled') return;
    if (!status.enabled || !status.listening) throw new Error('PieceMaker : le proxy PII est indisponible. Démarrage IA refusé.');
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
