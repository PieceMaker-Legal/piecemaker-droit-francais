export type PseudonymizationModelId = 'gliner' | 'mineru';

export type PseudonymizationModelStatus = { name: string; installed: boolean };

export type PseudonymizationInstallJob = {
  id: string;
  component: PseudonymizationModelId;
  state: 'running' | 'done' | 'failed';
  progress: string;
  error: string;
};
