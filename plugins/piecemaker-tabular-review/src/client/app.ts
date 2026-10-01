import type { Template } from '../shared.js';
import type { HostProject, PluginApi, PluginContext, Rpc } from './host.js';

export type View = {
  element: HTMLElement;
  show?(): void;
  destroy(): void;
};

export type App = {
  root: HTMLElement;
  api: PluginApi;
  rpc: Rpc;
  context(): PluginContext;
  projects(refresh?: boolean): Promise<HostProject[]>;
  projectName(path: string): string;
  templates(refresh?: boolean): Promise<Template[]>;
  setTemplates(templates: Template[]): void;
  onTemplatesChange(callback: (templates: Template[]) => void): () => void;
  openReview(project: string, file: string): void;
  updateResearch(project: string, file: string): void;
  takeResearchUpdate(): { project: string; file: string } | null;
  takeTargetProject(): string | null;
};
