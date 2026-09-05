/** Dialog for creating a new PieceMaker skill or agent (`POST /files`). */

import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';

import { Button, Dialog, DialogContent, DialogTitle, Input } from '@/shared/ui';

import { pmPost, PieceMakerApiError } from '../api';
import type { ManagedFile } from './SkillsSection';

const AGENT_MODELS = ['inherit', 'haiku', 'sonnet', 'opus'] as const;
const DEFAULT_AGENT_TOOLS = 'Read, Grep, Glob';

type CreateFileResponse = { ok: true; file: ManagedFile };

type SkillsCreateDialogProps = {
  open: boolean;
  kind: 'skill' | 'agent';
  onOpenChange: (open: boolean) => void;
  onCreated: (path: string) => void;
};

const KIND_LABEL: Record<'skill' | 'agent', string> = {
  skill: 'un skill',
  agent: 'un agent',
};

export default function SkillsCreateDialog({ open, kind, onOpenChange, onCreated }: SkillsCreateDialogProps) {
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tools, setTools] = useState(DEFAULT_AGENT_TOOLS);
  const [model, setModel] = useState<(typeof AGENT_MODELS)[number]>('sonnet');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSlug('');
    setName('');
    setDescription('');
    setTools(DEFAULT_AGENT_TOOLS);
    setModel('sonnet');
    setError(null);
  }, [open, kind]);

  const close = () => {
    if (isSubmitting) return;
    onOpenChange(false);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const response = await pmPost<CreateFileResponse>('/files', {
        kind,
        slug,
        name,
        description,
        ...(kind === 'agent' ? { tools, model } : {}),
      });
      onCreated(response.file.path);
    } catch (cause) {
      setError(cause instanceof PieceMakerApiError ? cause.message : 'Création impossible.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-md p-0">
        <DialogTitle>Créer {KIND_LABEL[kind]}</DialogTitle>
        <div className="flex items-center justify-between border-b border-border/50 px-4 py-3">
          <h2 className="text-sm font-medium text-foreground">Créer {KIND_LABEL[kind]}</h2>
          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Fermer" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="space-y-3 px-4 py-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="skills-create-slug">
              Identifiant (minuscules, chiffres, tirets)
            </label>
            <Input
              id="skills-create-slug"
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder="rediger-conclusions"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="skills-create-name">
              Nom
            </label>
            <Input
              id="skills-create-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Rédiger des conclusions"
              maxLength={80}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="skills-create-description">
              Description (indique à l’agent quand l’utiliser)
            </label>
            <textarea
              id="skills-create-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={1000}
              rows={3}
              required
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Utilisé pour rédiger des conclusions à partir des pièces du dossier."
            />
          </div>

          {kind === 'agent' && (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="skills-create-tools">
                  Outils autorisés (séparés par des virgules)
                </label>
                <Input
                  id="skills-create-tools"
                  value={tools}
                  onChange={(event) => setTools(event.target.value)}
                  placeholder={DEFAULT_AGENT_TOOLS}
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="skills-create-model">
                  Modèle
                </label>
                <select
                  id="skills-create-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value as (typeof AGENT_MODELS)[number])}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {AGENT_MODELS.map((entry) => (
                    <option key={entry} value={entry}>{entry}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={close} disabled={isSubmitting}>
              Annuler
            </Button>
            <Button type="submit" size="sm" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Créer
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
