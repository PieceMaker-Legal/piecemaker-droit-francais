import { RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Section } from '@/modules/piecemaker-workspace-tabs/agent/AgentSection';
import { LibraryGraph, TYPE_COLORS } from '@/modules/piecemaker-workspace-tabs/agent/LibraryGraph';
import { libraryApi } from '@/modules/piecemaker-workspace-tabs/agent/libraryApi';
import type { Library as LibraryData, LibraryConcept, LibraryTemplate } from '@/modules/piecemaker-workspace-tabs/agent/libraryApi';

const buttonClass = 'rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-40';
const message = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

function Dot({ type }: { type: string }) {
  return <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: TYPE_COLORS[type] ?? '#64748b' }} />;
}

/** Éditeur d'un concept (guideline, template, projet) : le fichier Markdown entier, frontmatter compris. */
function ConceptEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    libraryApi.concept(id).then((value) => { if (alive) { setContent(value.content); setSaved(value.content); } }).catch((cause) => alive && setError(message(cause)));
    return () => { alive = false; };
  }, [id]);
  const save = async () => {
    try { setError(''); const value = await libraryApi.save(id, content ?? ''); setSaved(value.content); } catch (cause) { setError(message(cause)); }
  };
  return <div className="space-y-2 rounded-xl border border-border p-2">
    <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="min-w-0 flex-1 truncate">{id}</span>
      <button type="button" aria-label="Fermer l’éditeur" className="rounded p-1 hover:bg-accent" onClick={onClose}><X className="h-3.5 w-3.5" /></button></div>
    {content === null ? <p className="text-xs text-muted-foreground">{error || 'Chargement…'}</p> : <>
      <textarea aria-label={`Contenu de ${id}`} className="h-72 w-full rounded-lg border border-border bg-background p-2 font-mono text-xs text-foreground outline-none focus:border-ring" value={content} onChange={(event) => setContent(event.target.value)} />
      <div className="flex items-center gap-2">
        <button type="button" className={buttonClass} disabled={content === saved} onClick={() => void save()}>Enregistrer</button>
        <span className="text-xs text-muted-foreground">{content.split('\n').length} / 500 lignes</span>
        {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
      </div>
    </>}
  </div>;
}

function TemplateCard({ template, byId, projects, onLink, onEdit }: { template: LibraryTemplate; byId: Map<string, LibraryConcept>; projects: LibraryConcept[]; onLink: (project: string, attach: boolean) => void; onEdit: (id: string) => void }) {
  const free = projects.filter((project) => !template.projects.includes(project.id));
  return <div className="space-y-3 px-2 pb-3 text-sm">
    {template.description && <p className="text-muted-foreground">{template.description}</p>}
    {template.resource && <p className="text-xs text-muted-foreground">Fichier : {template.resource}</p>}
    <div>
      <h4 className="text-xs font-medium uppercase text-muted-foreground">Projets attachés</h4>
      {template.projects.length ? <ul>{template.projects.map((id) => <li key={id} className="flex items-center gap-2 py-1">
        <Dot type="Projet" /><span className="min-w-0 flex-1 truncate">{byId.get(id)?.title ?? id}<span className="ml-2 text-xs text-muted-foreground">{byId.get(id)?.dossier}</span></span>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onLink(id, false)}>Détacher</button>
      </li>)}</ul> : <p className="text-xs text-muted-foreground">Aucun projet attaché.</p>}
      {free.length > 0 && <select aria-label={`Attacher un projet à ${template.title}`} className="mt-1 w-full rounded-lg border border-border bg-background px-2 py-1 text-xs" value="" onChange={(event) => event.target.value && onLink(event.target.value, true)}>
        <option value="">Attacher un projet…</option>
        {free.map((project) => <option key={project.id} value={project.id}>{project.title}{project.dossier ? ` · ${project.dossier}` : ''}</option>)}
      </select>}
    </div>
    <div>
      <h4 className="text-xs font-medium uppercase text-muted-foreground">Guidelines</h4>
      {template.guidelines.length ? <ul>{template.guidelines.map((id) => <li key={id} className="flex items-center gap-2 py-1">
        <Dot type="Guideline" /><span className="min-w-0 flex-1 truncate">{byId.get(id)?.title ?? id}</span>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => onEdit(id)}>Modifier</button>
      </li>)}</ul> : <p className="text-xs text-muted-foreground">Aucune guideline reliée.</p>}
    </div>
  </div>;
}

/** Library de l'agent central : Legal-OKF en local, plus les clients et projets générés depuis les dossiers. */
export function Library() {
  const [library, setLibrary] = useState<LibraryData | null>(null);
  const [error, setError] = useState('');
  const [view, setView] = useState<'list' | 'graph'>('list');
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (task: () => Promise<LibraryData>) => {
    setBusy(true);
    try { setError(''); setLibrary(await task()); } catch (cause) { setError(message(cause)); } finally { setBusy(false); }
  };
  useEffect(() => { void run(libraryApi.read); }, []);
  if (!library) return <p role={error ? 'alert' : 'status'} className="px-4 py-8 text-center text-sm text-muted-foreground">{error || 'Chargement de la Library…'}</p>;

  const byId = new Map(library.concepts.map((concept) => [concept.id, concept]));
  const projects = library.concepts.filter((concept) => concept.type === 'Projet');
  const clients = library.concepts.filter((concept) => concept.type === 'Client');
  const domains = [...new Set(library.templates.map((template) => template.domaine || 'autre'))].sort();
  const linked = new Set(library.templates.flatMap((template) => template.projects));
  const link = (template: string) => (project: string, attach: boolean) => void run(() => libraryApi.link(project, template, attach));
  const selectedTemplate = library.templates.find((template) => template.id === selected);
  const selectedConcept = selected ? byId.get(selected) : undefined;

  return <div className="space-y-2 py-2 text-sm">
    <div className="flex flex-wrap items-center gap-2 px-4">
      <nav role="tablist" aria-label="Vue de la Library" className="flex gap-1">
        {([['list', 'Liste'], ['graph', 'Graphe']] as const).map(([value, label]) => <button key={value} role="tab" type="button" aria-selected={view === value} onClick={() => setView(value)}
          className={`rounded-lg px-3 py-1 ${view === value ? 'bg-muted text-foreground' : 'text-foreground/80 hover:text-foreground'}`}>{label}</button>)}
      </nav>
      <span className="flex-1" />
      <button type="button" aria-label="Mettre à jour Legal-OKF" title={`Mettre à jour depuis ${library.repository}`} className="rounded-lg p-2 hover:bg-accent disabled:opacity-40" disabled={busy} onClick={() => void run(libraryApi.sync)}><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} /></button>
    </div>
    <p className="px-4 text-xs text-muted-foreground">{library.present ? `${library.templates.length} templates · ${projects.length} projets · ${clients.length} clients` : 'Legal-OKF n’est pas encore récupéré.'}{library.last_sync ? ` · mis à jour le ${new Date(library.last_sync).toLocaleString('fr-FR')}` : ''}</p>
    {(error || library.syncError) && <p role="alert" className="px-4 text-xs text-destructive">{error || library.syncError}</p>}
    {editing && <div className="px-3"><ConceptEditor key={editing} id={editing} onClose={() => setEditing(null)} /></div>}
    {view === 'graph' && <>
      <LibraryGraph library={library} selected={selected} onSelect={setSelected} />
      {selectedConcept && <div className="px-3"><section aria-label={selectedConcept.title}><h3 className="flex items-center gap-2 px-2 py-2 font-medium"><Dot type={selectedConcept.type} />{selectedConcept.type} · {selectedConcept.title}</h3>
        {selectedTemplate ? <TemplateCard template={selectedTemplate} byId={byId} projects={projects} onLink={link(selectedTemplate.id)} onEdit={setEditing} />
          : <div className="space-y-2 px-2 pb-3"><p className="text-muted-foreground">{selectedConcept.description || 'Sans description.'}</p>
            {['Guideline', 'Projet', 'Domaine', 'Template'].includes(selectedConcept.type) && <button type="button" className={buttonClass} onClick={() => setEditing(selectedConcept.id)}>Modifier</button>}</div>}
      </section></div>}
    </>}
    {view === 'list' && <div className="px-3">
      {domains.map((domain) => <Section key={domain} title={domain} count={library.templates.filter((template) => (template.domaine || 'autre') === domain).length}>
        {library.templates.filter((template) => (template.domaine || 'autre') === domain).map((template) => <div key={template.id}>
          <button type="button" aria-expanded={selected === template.id} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent" onClick={() => setSelected(selected === template.id ? null : template.id)}>
            <Dot type="Template" /><span className="min-w-0 flex-1 truncate">{template.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{template.projects.length} projet(s) · {template.guidelines.length} guideline(s)</span>
          </button>
          {selected === template.id && <TemplateCard template={template} byId={byId} projects={projects} onLink={link(template.id)} onEdit={setEditing} />}
        </div>)}
      </Section>)}
      <Section title="Projets à relier" count={projects.filter((project) => !linked.has(project.id)).length} initiallyOpen={false}>
        {projects.filter((project) => !linked.has(project.id)).map((project) => <div key={project.id} className="flex items-center gap-2 px-2 py-1.5"><Dot type="Projet" />
          <span className="min-w-0 flex-1 truncate">{project.title}<span className="ml-2 text-xs text-muted-foreground">{project.dossier}</span></span></div>)}
      </Section>
      <Section title="Clients" count={clients.length} initiallyOpen={false}>
        {clients.map((client) => <div key={client.id} className="flex items-center gap-2 px-2 py-1.5"><Dot type="Client" />
          <span className="min-w-0 flex-1 truncate">{client.title}<span className="ml-2 text-xs text-muted-foreground">{client.dossier}</span></span></div>)}
      </Section>
    </div>}
  </div>;
}
