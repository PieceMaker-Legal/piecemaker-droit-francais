import { ChevronDown, ChevronRight, File, Filter, Folder, FolderSync, NotebookPen, Plus, Search, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { ACTIVE_THREAD_STATES } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import type { AgentDeliverable, AgentProvider, AgentSettings, AgentState, AgentThread, AgentThreadState } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import { AgentCards, pendingCards } from '@/modules/piecemaker-workspace-tabs/agent/AgentCards';
import { age, bytes, DELIVERABLE_LABELS, PROVIDER_LABELS, THREAD_STATE_COLORS, THREAD_STATE_LABELS } from '@/modules/piecemaker-workspace-tabs/agent/agentFormat';
import { openAgentOutput } from '@/modules/piecemaker-workspace-tabs/agent/openAgentOutput';
import { useSubagent } from '@/modules/piecemaker-workspace-tabs/agent/subagent';
import { useAgentState } from '@/modules/piecemaker-workspace-tabs/agent/useAgentState';
import type { AgentActions } from '@/modules/piecemaker-workspace-tabs/agent/useAgentState';

type AgentPanelTab = 'threads' | 'context' | 'settings' | 'scheduled';

const TABS: Array<[AgentPanelTab, string]> = [['threads', 'Fils de discussion'], ['context', 'Contexte'], ['scheduled', 'Tâches planifiées']];
const PROVIDERS: AgentProvider[] = ['claude', 'codex', 'mistral'];
const VIEW_KEY = 'pm-agent-view';
const inputClass = 'w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring';
const buttonClass = 'rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-40';

function Section({ title, count, action, children, initiallyOpen = true }: { title: string; count: number; action?: ReactNode; children: ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <section className="py-1">
    <div className="flex items-center">
      <button type="button" aria-expanded={open} className="flex flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        <span className="text-[15px] text-foreground">{title}</span><span className="text-sm text-muted-foreground">{count}</span>
      </button>
      {action}
    </div>
    {open && <div className="pb-2 pl-8">{children}</div>}
  </section>;
}

function Row({ icon, title, detail, trailing, onClick }: { icon: ReactNode; title: string; detail?: string; trailing?: ReactNode; onClick?: () => void }) {
  const content = <>
    <span className="shrink-0 text-muted-foreground">{icon}</span>
    <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{title}{detail && <span className="ml-2 text-sm text-muted-foreground">{detail}</span>}</span>
    {trailing && <span className="shrink-0 text-sm text-muted-foreground">{trailing}</span>}
  </>;
  return onClick
    ? <button type="button" className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent" onClick={onClick}>{content}</button>
    : <div className="flex items-center gap-3 px-2 py-2">{content}</div>;
}

function DeliverableState({ deliverable, act }: { deliverable: AgentDeliverable; act: AgentActions }) {
  return <select aria-label={`État de ${deliverable.title}`} value={deliverable.state} className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground"
    onChange={(event) => void act('deliverable', { id: deliverable.id, state: event.target.value }, 'PUT')}>
    {Object.entries(DELIVERABLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
  </select>;
}

const folderName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;

function Threads({ state, act, query, filter }: { state: AgentState; act: AgentActions; query: string; filter: AgentThreadState | 'all' }) {
  const pending = pendingCards(state).count;
  const threads = state.threads
    .filter((thread) => filter === 'all' || thread.state === filter)
    .filter((thread) => !query || thread.title.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const groups = state.central
    ? [...new Set(threads.map((thread) => thread.projectPath))].map((folder) => ({ folder, threads: threads.filter((thread) => thread.projectPath === folder) }))
    : [{ folder: null, threads }];
  return <>
    {pending > 0 && <div className="px-3 pt-3"><Section title="À traiter" count={pending}><AgentCards state={state} act={act} /></Section></div>}
    {!threads.length ? <p className="px-4 py-8 text-center text-sm text-muted-foreground">{state.threads.length ? 'Aucun fil ne correspond.' : 'Aucun fil pour l’instant. Les tâches confiées par l’agent apparaîtront ici.'}</p>
      : groups.map((group) => <section key={group.folder ?? 'fils'} aria-label={group.folder ? `Dossier ${folderName(group.folder)}` : undefined}>
        {group.folder && <h3 className="flex items-center gap-2 px-4 pt-3 text-sm font-medium text-muted-foreground"><Folder className="h-3.5 w-3.5" />{folderName(group.folder)}</h3>}
        <ul className="px-2 py-2">{group.threads.map((thread) => <ThreadRow key={thread.id} thread={thread} state={state} act={act} />)}</ul>
      </section>)}
  </>;
}

function ThreadRow({ thread, state, act }: { thread: AgentThread; state: AgentState; act: AgentActions }) {
  const navigate = useNavigate();
  const subagent = useSubagent();
  const deliverables = state.deliverables.filter((deliverable) => deliverable.threadId === thread.id);
  const active = ACTIVE_THREAD_STATES.includes(thread.state);
  return <li className="group rounded-xl px-2 py-2 hover:bg-accent" data-thread={thread.id}>
    <button type="button" className="flex w-full items-center gap-3 text-left" disabled={!thread.sessionId} onClick={() => thread.sessionId && !subagent?.open(thread) && navigate(`/session/${thread.sessionId}`)}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${THREAD_STATE_COLORS[thread.state]}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] text-foreground">{thread.title}</span>
        <span className="block truncate text-sm text-muted-foreground">{THREAD_STATE_LABELS[thread.state]} · {PROVIDER_LABELS[thread.provider]}{thread.replies.at(-1) ? ` · ${thread.replies.at(-1)!.text}` : ''}</span>
      </span>
      <span className="shrink-0 text-sm text-muted-foreground">{age(thread.updatedAt)}</span>
    </button>
    <div className="ml-5 mt-1 hidden gap-2 group-hover:flex">
      <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => void act('thread/resolve', { threadId: thread.id, resolved: !thread.resolved })}>{thread.resolved ? 'Rouvrir' : 'Résoudre'}</button>
      {active && <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => void act('thread/stop', { threadId: thread.id })}>Arrêter</button>}
    </div>
    {deliverables.length > 0 && <ul className="ml-5 mt-1 space-y-1">{deliverables.map((deliverable) => <li key={deliverable.id} className="flex items-center gap-2 text-sm text-foreground/80">
      <File className="h-3.5 w-3.5 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{deliverable.title}</span><DeliverableState deliverable={deliverable} act={act} />
    </li>)}</ul>}
  </li>;
}

function Context({ state, act, projectPath, onTab, onOpenArtifact }: { state: AgentState; act: AgentActions; projectPath: string; onTab: (tab: AgentPanelTab) => void; onOpenArtifact: (url: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folders = state.central ? state.settings.folders : [projectPath, ...state.settings.folders.filter((folder) => folder !== projectPath)];
  const memoryLines = state.memory.text.trim() ? state.memory.text.trim().split('\n').filter(Boolean).length : 0;
  async function upload(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      const content = await new Promise<string>((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.readAsDataURL(file); });
      await act('file', { name: file.name, content });
    }
  }
  return <div className="flex h-full flex-col">
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className="px-2 pb-2"><select aria-label="Visibilité" className="rounded-lg bg-transparent text-[15px] text-foreground" defaultValue="me"><option value="me">Vous uniquement</option></select></div>
      <Section title="Instructions" count={state.settings.instructions.trim() ? 1 : 0}>
        <Row icon={<NotebookPen className="h-4 w-4" />} title="Instructions du projet" detail={state.settings.instructions.trim() || 'Aucune pour l’instant'} onClick={() => onTab('settings')} />
      </Section>
      <Section title="Mémoire" count={memoryLines} initiallyOpen={false}>
        {memoryLines ? <p className="whitespace-pre-wrap px-2 text-sm text-foreground/80">{state.memory.text}</p> : <p className="px-2 text-sm text-muted-foreground">La mémoire du projet est vide.</p>}
      </Section>
      <Section title="Fichiers" count={folders.length + state.files.length} action={<>
        <button type="button" aria-label="Ajouter un fichier" className="rounded-lg p-2 text-foreground/80 hover:bg-accent" onClick={() => fileRef.current?.click()}><Plus className="h-4 w-4" /></button>
        <input ref={fileRef} type="file" multiple hidden onChange={(event) => { void upload(event.target.files); event.target.value = ''; }} />
      </>}>
        {folders.map((folder) => <Row key={folder} icon={<FolderSync className="h-4 w-4" />} title={folderName(folder)} detail="Cet ordinateur" />)}
        {state.files.map((file) => <Row key={file.name} icon={<Folder className="h-4 w-4" />} title={file.name} trailing={age(file.updatedAt)} />)}
      </Section>
      <Section title="Artéfacts" count={state.artifacts.length}>
        {state.artifacts.length ? state.artifacts.map((artifact) => <button key={artifact.url} type="button" onClick={() => onOpenArtifact(artifact.url)} className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-accent">
          <span className="h-9 w-12 shrink-0 rounded-md border border-border bg-gradient-to-br from-muted to-muted/30" />
          <span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{artifact.title}</span>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-foreground">V</span>
          <span className="w-10 shrink-0 text-right text-sm text-muted-foreground">{age(artifact.updated_at)}</span>
        </button>) : <p className="px-2 text-sm text-muted-foreground">Aucun artéfact.</p>}
      </Section>
      <Section title="Livrables" count={state.deliverables.length} initiallyOpen={state.deliverables.length > 0}>
        {state.deliverables.length ? state.deliverables.map((deliverable) => <div key={deliverable.id} className="flex items-center gap-3 px-2 py-2">
          <File className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{deliverable.title}</span><DeliverableState deliverable={deliverable} act={act} />
        </div>) : <p className="px-2 text-sm text-muted-foreground">Aucun livrable.</p>}
      </Section>
    </div>
    <footer className="shrink-0 border-t border-border px-5 py-3">
      <div className="h-1 rounded-full bg-muted"><div className="h-1 rounded-full bg-blue-500" style={{ width: `${Math.max(1, Math.min(100, state.storage.total ? state.storage.used / state.storage.total * 100 : 0))}%` }} /></div>
      <p className="mt-2 text-sm text-muted-foreground">{bytes(state.storage.used)} sur {bytes(state.storage.total)} utilisés</p>
    </footer>
  </div>;
}

function Instructions({ state, act }: { state: AgentState; act: AgentActions }) {
  const [instructions, setInstructions] = useState(state.settings.instructions);
  const [memory, setMemory] = useState(state.memory.text);
  useEffect(() => setInstructions(state.settings.instructions), [state.settings.instructions]);
  useEffect(() => setMemory(state.memory.text), [state.memory.revision, state.memory.text]);
  return <div className="space-y-6 overflow-y-auto px-5 py-4">
    <label className="block">
      <span className="text-[15px] text-foreground">Instructions du projet</span>
      <span className="mt-1 block text-sm text-muted-foreground">Consignes permanentes données à l’agent au début de chaque conversation.</span>
      <textarea rows={10} value={instructions} onChange={(event) => setInstructions(event.target.value)} className={`${inputClass} mt-2`} placeholder="Aucune pour l’instant" />
    </label>
    <button type="button" className={buttonClass} disabled={instructions === state.settings.instructions} onClick={() => void act('settings', { instructions }, 'PUT')}>Enregistrer les instructions</button>
    <label className="block">
      <span className="text-[15px] text-foreground">Mémoire du projet</span>
      <span className="mt-1 block text-sm text-muted-foreground">Ce que l’agent garde d’une conversation à l’autre. Révision {state.memory.revision}.</span>
      <textarea rows={10} value={memory} onChange={(event) => setMemory(event.target.value)} className={`${inputClass} mt-2`} />
    </label>
    <button type="button" className={buttonClass} disabled={memory === state.memory.text} onClick={() => void act('memory', { text: memory, revision: state.memory.revision }, 'PUT')}>Enregistrer la mémoire</button>
  </div>;
}

function Settings({ state, act }: { state: AgentState; act: AgentActions }) {
  const settings = state.settings;
  const connected = new Set(state.providers.filter((provider) => provider.authenticated).map((provider) => provider.provider));
  const [folder, setFolder] = useState('');
  const save = (patch: Partial<AgentSettings>) => void act('settings', patch, 'PUT');
  const providerOptions = ['auto', ...PROVIDERS].map((value) => <option key={value} value={value} disabled={value !== 'auto' && !connected.has(value as AgentProvider)}>
    {PROVIDER_LABELS[value]}{value !== 'auto' && !connected.has(value as AgentProvider) ? ' (non connecté)' : ''}</option>);
  return <div className="space-y-5 overflow-y-auto px-5 py-4 text-sm">
    <fieldset className="space-y-2">
      <legend className="text-[15px] text-foreground">Agent</legend>
      <label className="block text-muted-foreground">Fournisseur<select className={`${inputClass} mt-1`} value={settings.orchestratorProvider} onChange={(event) => save({ orchestratorProvider: event.target.value as AgentSettings['orchestratorProvider'] })}>{providerOptions}</select></label>
      <label className="block text-muted-foreground">Modèle initial (vide = modèle par défaut)<input className={`${inputClass} mt-1`} defaultValue={settings.orchestratorModel} onBlur={(event) => event.target.value !== settings.orchestratorModel && save({ orchestratorModel: event.target.value })} /></label>
      <label className="block text-muted-foreground">Recycler la conversation après (tours)<input type="number" min={1} className={`${inputClass} mt-1`} defaultValue={settings.recycleAfter} onBlur={(event) => Number(event.target.value) > 0 && save({ recycleAfter: Number(event.target.value) })} /></label>
      <button type="button" className={buttonClass} onClick={() => void act('recycle')}>Recycler l’orchestrateur maintenant</button>
    </fieldset>
    <fieldset className="space-y-2">
      <legend className="text-[15px] text-foreground">Fils de discussion</legend>
      <label className="block text-muted-foreground">Fournisseur par défaut<select className={`${inputClass} mt-1`} value={settings.defaultProvider} onChange={(event) => save({ defaultProvider: event.target.value as AgentSettings['defaultProvider'] })}>{providerOptions}</select></label>
      {PROVIDERS.map((provider) => <div key={provider} className="grid grid-cols-[1fr_6rem] gap-2">
        <label className="block text-muted-foreground">Modèle {PROVIDER_LABELS[provider]}<input className={`${inputClass} mt-1`} disabled={!connected.has(provider)} defaultValue={settings.defaultModels[provider] ?? ''}
          onBlur={(event) => event.target.value.trim() && event.target.value !== settings.defaultModels[provider] && save({ defaultModels: { [provider]: event.target.value.trim() } })} /></label>
        <label className="block text-muted-foreground">Simultanés<input type="number" min={1} className={`${inputClass} mt-1`} defaultValue={settings.concurrency[provider]}
          onBlur={(event) => Number(event.target.value) > 0 && save({ concurrency: { ...settings.concurrency, [provider]: Number(event.target.value) } })} /></label>
      </div>)}
    </fieldset>
    {state.central ? <fieldset className="space-y-2">
      <legend className="text-[15px] text-foreground">Dossiers de l’agent central</legend>
      <p className="text-muted-foreground">Chaque fil travaille dans un seul de ces dossiers, et sa session y est rangée.</p>
      {state.dossiers.length ? state.dossiers.map((item) => <label key={item.path} className="flex items-center gap-2 text-foreground/80" title={item.path}>
        <input type="checkbox" checked={item.selected} onChange={() => save({ folders: item.selected ? settings.folders.filter((entry) => entry !== item.path) : [...settings.folders, item.path] })} />
        <span className="min-w-0 flex-1 truncate">{folderName(item.path)}</span>
      </label>) : <p className="text-muted-foreground">Aucun dossier pour l’instant.</p>}
    </fieldset> : <fieldset className="space-y-2">
      <legend className="text-[15px] text-foreground">Dossiers autorisés</legend>
      {settings.folders.length ? settings.folders.map((item) => <div key={item} className="flex items-center gap-2 text-foreground/80">
        <span className="min-w-0 flex-1 truncate">{item}</span>
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => save({ folders: settings.folders.filter((entry) => entry !== item) })}>Retirer</button>
      </div>) : <p className="text-muted-foreground">Seul le dossier du projet est autorisé.</p>}
      <div className="flex gap-2"><input className={inputClass} placeholder="/chemin/du/dossier" value={folder} onChange={(event) => setFolder(event.target.value)} />
        <button type="button" className={buttonClass} disabled={!folder.trim()} onClick={() => { save({ folders: [...settings.folders, folder.trim()] }); setFolder(''); }}>Ajouter</button></div>
    </fieldset>}
  </div>;
}

function Scheduled({ state, act }: { state: AgentState; act: AgentActions }) {
  const items = [
    ...state.threads.filter(thread => thread.reminderAt).map(thread => ({
      id: thread.id, kind: 'reminder', label: 'Rappel', title: thread.title, at: thread.reminderAt,
    })),
    ...state.schedules.filter(schedule => schedule.kind === 'cron' || !schedule.lastFiredAt).map(schedule => ({
      id: schedule.id, kind: schedule.kind, label: schedule.kind === 'cron' ? 'Routine' : 'Message différé',
      title: schedule.thread?.title ?? schedule.text, at: schedule.nextRunAt,
    })),
  ].sort((a, b) => (a.at ?? '~').localeCompare(b.at ?? '~'));
  if (!items.length) return <p className="px-4 py-8 text-center text-sm text-muted-foreground">Aucune tâche planifiée.</p>;
  return <ul className="px-4 py-3">{items.map(item => <li key={item.id} className="flex items-center gap-2 border-b border-border py-2 text-sm">
    <div className="min-w-0 flex-1">
      <span className="block text-foreground">{item.title}</span>
      <span className="text-muted-foreground">{item.label} · {item.at
        ? <time dateTime={item.at}>{new Date(item.at).toLocaleString('fr-FR')}</time>
        : 'Aucune prochaine exécution'}</span>
    </div>
    <button type="button" className={buttonClass} aria-label={`Annuler : ${item.title}`} onClick={() => void act('schedule/cancel', { kind: item.kind, id: item.id })}>Annuler</button>
  </li>)}</ul>;
}

export function AgentPanel({ projectPath, panelActions }: { projectPath: string; panelActions?: ReactNode }) {
  const { state, error, act } = useAgentState(projectPath);
  const [tab, setTab] = useState<AgentPanelTab>('threads');
  const [menu, setMenu] = useState<'plus' | 'filter' | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AgentThreadState | 'all'>('all');
  const onTab = setTab;

  function customView() {
    setMenu(null);
    onTab('threads');
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (saved) { setFilter(saved as AgentThreadState | 'all'); return; }
      window.localStorage.setItem(VIEW_KEY, filter);
    } catch { return; }
  }

  const active = state?.threads.filter((thread) => ACTIVE_THREAD_STATES.includes(thread.state)).length ?? 0;
  const onOpenArtifact = (url: string) => openAgentOutput(projectPath, { kind: 'artifact', ref: url });

  return <div className="pm-agent-panel flex h-full min-w-0 flex-col text-foreground" aria-label="Volet de l’agent">
    <header className="relative flex h-12 shrink-0 items-center gap-1 border-b border-border px-3">
      <nav role="tablist" className="flex min-w-0 items-center gap-1 overflow-x-auto">
        {TABS.map(([value, label]) => <button key={value} role="tab" type="button" aria-selected={tab === value} onClick={() => onTab(value)}
          className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-1.5 text-[15px] ${tab === value ? 'bg-muted text-foreground' : 'text-foreground/80 hover:text-foreground'}`}>
          {label}{value === 'threads' && active > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-500 px-1.5 text-xs text-white" aria-label={`${active} fils actifs`}>{active}</span>}
        </button>)}
      </nav>
      <button type="button" aria-label="Ajouter" aria-haspopup="menu" aria-expanded={menu === 'plus'} className="shrink-0 rounded-lg p-2 text-foreground/80 hover:bg-accent" onClick={() => setMenu(menu === 'plus' ? null : 'plus')}><Plus className="h-[18px] w-[18px]" /></button>
      {menu === 'plus' && <div role="menu" className="absolute right-12 top-11 z-20 w-56 rounded-xl border border-border bg-popover p-1 shadow-xl">
        <button role="menuitem" type="button" className="block w-full rounded-lg px-3 py-2 text-left text-[15px] hover:bg-accent" onClick={customView}>Vue personnalisée</button>
      </div>}
      <button type="button" aria-label="Paramètres" title="Paramètres" aria-pressed={tab === 'settings'} className="shrink-0 rounded-lg p-2 hover:bg-accent" onClick={() => { setMenu(null); onTab('settings'); }}><SettingsIcon className="h-[18px] w-[18px]" /></button>
      <span className="flex-1" />
      <button type="button" aria-label="Rechercher" aria-pressed={searching} className="shrink-0 rounded-lg p-2 text-foreground/80 hover:bg-accent" onClick={() => { setSearching(!searching); onTab('threads'); }}><Search className="h-[18px] w-[18px]" /></button>
      <button type="button" aria-label="Filtrer" aria-expanded={menu === 'filter'} className={`shrink-0 rounded-lg p-2 hover:bg-accent ${filter !== 'all' ? 'text-blue-500' : 'text-foreground/80'}`} onClick={() => setMenu(menu === 'filter' ? null : 'filter')}><Filter className="h-[18px] w-[18px]" /></button>
      {menu === 'filter' && <div role="menu" className="absolute right-2 top-11 z-20 w-48 rounded-xl border border-border bg-popover p-1 shadow-xl">
        {(['all', ...Object.keys(THREAD_STATE_LABELS)] as Array<AgentThreadState | 'all'>).map((value) => <button key={value} role="menuitemradio" aria-checked={filter === value} type="button"
          className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-accent" onClick={() => { setFilter(value); setMenu(null); onTab('threads'); }}>{value === 'all' ? 'Tous les états' : THREAD_STATE_LABELS[value]}</button>)}
      </div>}
      {panelActions && <div className="flex shrink-0 items-center gap-1 [&_button]:p-1 [&_svg]:size-4">{panelActions}</div>}
    </header>
    {error && <p role="alert" className="px-4 py-2 text-sm">{error}</p>}
    {!state && !error && <p className="px-4 py-8 text-center text-sm">Chargement de PieceMaker Agent…</p>}
    {state && <>
      {searching && tab === 'threads' && <div className="border-b border-border px-4 py-2"><input autoFocus aria-label="Rechercher un fil" className={inputClass} placeholder="Rechercher un fil" value={query} onChange={(event) => setQuery(event.target.value)} /></div>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'threads' && <Threads state={state} act={act} query={query} filter={filter} />}
        {tab === 'context' && <Context state={state} act={act} projectPath={projectPath} onTab={onTab} onOpenArtifact={onOpenArtifact} />}
        {tab === 'settings' && <><Instructions state={state} act={act} /><Settings state={state} act={act} /></>}
        {tab === 'scheduled' && <Scheduled state={state} act={act} />}
      </div>
    </>}
  </div>;
}
