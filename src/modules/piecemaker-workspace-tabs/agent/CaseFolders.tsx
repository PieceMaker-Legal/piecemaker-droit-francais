import { ChevronDown, ChevronRight, FileJson, FileText, Folder, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

import { agentApi } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';
import type { AgentSettings, AgentState, CasePair, CaseRoadmap, CaseRoadmapLine, CaseSuivi } from '@/modules/piecemaker-workspace-tabs/agent/agentApi';

const ABOUT_LIMIT = 200;
const KINDS: Array<[string, string]> = [['filing', 'Acte à déposer'], ['hearing', 'Audience'], ['limitation', 'Prescription'], ['other', 'Autre']];
const inputClass = 'w-full rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground outline-none focus:border-ring';
const buttonClass = 'rounded-lg bg-muted px-3 py-1.5 text-sm text-foreground hover:bg-accent disabled:opacity-40';

const folderName = (folder: string) => folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
const lineName = (text: string) => text.toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}'’ -]+/gu, ' ').replace(/\s+/g, ' ').trim();
const lineCount = (text: string) => text.replace(/\n$/, '').split('\n').length;

function describe(line: CaseRoadmapLine) {
  if (line.okf) return `prémisse « ${line.okf} »`;
  const link = line.de ?? line.avant;
  if (link && line.delai) {
    const [unit, count] = Object.entries(line.delai)[0] ?? [];
    return `${count ?? ''} ${String(unit ?? '').replace('_', ' ')} ${line.de ? 'après' : 'avant'} « ${link} »`;
  }
  return '';
}

function AboutEditor({ project, pair, onSaved }: { project: string; pair: CasePair; onSaved: (pair: CasePair) => void }) {
  const [text, setText] = useState(pair.about);
  const [error, setError] = useState<string | null>(null);
  const lines = lineCount(text);
  async function save() {
    try { onSaved(await agentApi.saveAbout(project, pair.folder, text)); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <div className="space-y-2 px-2 py-2">
    <textarea aria-label={`About.md de ${pair.name}`} className={`${inputClass} min-h-48 font-mono`} value={text} onChange={(event) => setText(event.target.value)} />
    <div className="flex items-center gap-2">
      <span className={`flex-1 text-xs ${lines > ABOUT_LIMIT ? 'text-red-500' : 'text-muted-foreground'}`}>{lines} / {ABOUT_LIMIT} lignes</span>
      <button type="button" className={buttonClass} disabled={text === pair.about} onClick={() => setText(pair.about)}>Annuler</button>
      <button type="button" className={buttonClass} disabled={text === pair.about || lines > ABOUT_LIMIT} onClick={() => void save()}>Enregistrer</button>
    </div>
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
  </div>;
}

type Group = 'echeances' | 'evenements';

function RoadmapLine({ name, line, onChange, onRemove }: { name: string; line: CaseRoadmapLine; onChange: (line: CaseRoadmapLine) => void; onRemove: () => void }) {
  const computed = describe(line);
  return <li className="grid grid-cols-[1fr_8.5rem_auto] items-center gap-2" data-line={name}>
    <input aria-label={`Intitulé de ${name}`} className={inputClass} value={line.intitule ?? name} onChange={(event) => onChange({ ...line, intitule: event.target.value })} />
    {computed
      ? <span className="truncate text-xs text-muted-foreground" title={computed}>{computed}</span>
      : <input aria-label={`Date de ${name}`} type="date" className={inputClass} value={line.date ?? ''} onChange={(event) => onChange({ ...line, date: event.target.value })} />}
    <button type="button" aria-label={`Retirer ${name}`} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></button>
  </li>;
}

function NewLine({ onAdd }: { onAdd: (group: Group, name: string, line: CaseRoadmapLine) => void }) {
  const [group, setGroup] = useState<Group>('echeances');
  const [intitule, setIntitule] = useState('');
  const [date, setDate] = useState('');
  const [kind, setKind] = useState('filing');
  const name = lineName(intitule);
  return <div className="grid grid-cols-[1fr_8.5rem] gap-2 pt-2">
    <input aria-label="Nouvelle ligne" placeholder="Nouvelle ligne : intitulé" className={inputClass} value={intitule} onChange={(event) => setIntitule(event.target.value)} />
    <input aria-label="Date de la nouvelle ligne" type="date" className={inputClass} value={date} onChange={(event) => setDate(event.target.value)} />
    <select aria-label="Type de la nouvelle ligne" className={inputClass} value={group === 'evenements' ? 'evenement' : kind} onChange={(event) => { if (event.target.value === 'evenement') setGroup('evenements'); else { setGroup('echeances'); setKind(event.target.value); } }}>
      {KINDS.map(([value, label]) => <option key={value} value={value}>Échéance : {label}</option>)}
      <option value="evenement">Événement</option>
    </select>
    <button type="button" aria-label="Ajouter la ligne" className={buttonClass} disabled={!name || !date} onClick={() => { onAdd(group, name, group === 'echeances' ? { intitule: intitule.trim(), kind, date } : { intitule: intitule.trim(), date }); setIntitule(''); setDate(''); }}>
      <Plus className="mr-1 inline h-3.5 w-3.5" />Ajouter
    </button>
  </div>;
}

function RoadmapEditor({ project, pair, onSaved }: { project: string; pair: CasePair; onSaved: (pair: CasePair) => void }) {
  const [roadmap, setRoadmap] = useState<CaseRoadmap>(pair.roadmap);
  const [newSuivi, setNewSuivi] = useState('');
  const [error, setError] = useState<string | null>(pair.error);
  const suivis = roadmap.suivis ?? {};
  const synthese = roadmap.synthese as Record<string, { etat?: string }> | undefined;
  const changed = JSON.stringify(roadmap) !== JSON.stringify(pair.roadmap);
  const update = (fichier: string, change: (suivi: CaseSuivi) => CaseSuivi) => setRoadmap({ ...roadmap, suivis: { ...suivis, [fichier]: change(suivis[fichier] ?? {}) } });
  const setLine = (fichier: string, group: Group, name: string, line: CaseRoadmapLine | null) => update(fichier, (suivi) => {
    const lines = { ...(suivi[group] ?? {}) };
    if (line) lines[name] = line; else delete lines[name];
    return { ...suivi, [group]: lines };
  });
  async function save() {
    try { const saved = await agentApi.saveRoadmap(project, pair.folder, roadmap); onSaved(saved); setRoadmap(saved.roadmap); setError(null); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  return <div className="space-y-3 px-2 py-2 text-sm">
    {synthese && <ul className="space-y-1 rounded-lg bg-muted/50 px-2 py-2 text-xs" aria-label="Synthèse">
      {Object.entries(synthese).filter(([key]) => key !== 'le').map(([key, value]) => <li key={key}><span className="text-muted-foreground">{key === 'okf' ? 'Index' : key === 'parties' ? 'Parties' : key} : </span>{value?.etat ?? JSON.stringify(value)}</li>)}
    </ul>}
    {Object.entries(suivis).map(([fichier, suivi]) => <section key={fichier} aria-label={`Suivi ${fichier}`} className="space-y-2">
      <h4 className="text-xs font-medium text-muted-foreground">{fichier.replace(/-?suivi\.json$/, '') || 'Suivi'}</h4>
      {(['echeances', 'evenements'] as Group[]).map((group) => Object.keys(suivi[group] ?? {}).length > 0 && <div key={group}>
        <p className="pb-1 text-xs text-muted-foreground">{group === 'echeances' ? 'Échéances' : 'Événements'}</p>
        <ul className="space-y-1">{Object.entries(suivi[group] ?? {}).map(([name, line]) => <RoadmapLine key={name} name={name} line={line}
          onChange={(next) => setLine(fichier, group, name, next)} onRemove={() => setLine(fichier, group, name, null)} />)}</ul>
      </div>)}
      <NewLine onAdd={(group, name, line) => setLine(fichier, group, name, line)} />
    </section>)}
    <div className="flex gap-2">
      <input aria-label="Nouveau suivi" placeholder="Nouveau suivi : nom de l’acte" className={inputClass} value={newSuivi} onChange={(event) => setNewSuivi(event.target.value)} />
      <button type="button" className={buttonClass} disabled={!newSuivi.trim()} onClick={() => { update(`${lineName(newSuivi).replace(/ /g, '-')}-suivi.json`, (suivi) => ({ ...suivi, echeances: suivi.echeances ?? {} })); setNewSuivi(''); }}>Créer</button>
    </div>
    <div className="flex justify-end gap-2">
      <button type="button" className={buttonClass} disabled={!changed} onClick={() => setRoadmap(pair.roadmap)}>Annuler</button>
      <button type="button" className={buttonClass} disabled={!changed} onClick={() => void save()}>Enregistrer</button>
    </div>
    {error && <p role="alert" className="whitespace-pre-wrap text-xs text-red-500">{error}</p>}
  </div>;
}

function CaseFolder({ project, folder }: { project: string; folder: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'about' | 'roadmap' | null>(null);
  const [pair, setPair] = useState<CasePair | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || pair) return;
    agentApi.casePair(project, folder).then(setPair, (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [open, pair, project, folder]);
  const item = (key: 'about' | 'roadmap', label: string, icon: ReactNode) => <button type="button" aria-expanded={view === key}
    className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-[15px] text-foreground hover:bg-accent" onClick={() => setView(view === key ? null : key)}>
    <span className="text-muted-foreground">{icon}</span>{label}
  </button>;
  return <li data-case={folder}>
    <button type="button" aria-expanded={open} title={folder} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-accent" onClick={() => setOpen(!open)}>
      {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      <Folder className="h-4 w-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate text-[15px] text-foreground">{folderName(folder)}</span>
    </button>
    {open && <div className="pl-6">
      {error && <p role="alert" className="px-2 text-xs text-red-500">{error}</p>}
      {pair && <>
        {item('about', 'About', <FileText className="h-4 w-4" />)}
        {view === 'about' && <AboutEditor key={pair.about} project={project} pair={pair} onSaved={setPair} />}
        {item('roadmap', 'Roadmap', <FileJson className="h-4 w-4" />)}
        {view === 'roadmap' && <RoadmapEditor project={project} pair={pair} onSaved={setPair} />}
      </>}
    </div>}
  </li>;
}

export function CaseFolders({ state, projectPath, save }: { state: AgentState; projectPath: string; save: (patch: Partial<AgentSettings>) => void }) {
  const [adding, setAdding] = useState(false);
  const [choice, setChoice] = useState('');
  const available = state.dossiers.filter((item) => !item.selected);
  return <section className="py-1" aria-label="Dossiers">
    <div className="flex items-center">
      <span className="flex flex-1 items-center gap-2 px-2 py-2"><span className="text-[15px] text-foreground">Dossiers</span><span className="text-sm text-muted-foreground">{state.settings.folders.length}</span></span>
      <button type="button" aria-label="Ajouter un dossier" className="rounded-lg p-2 text-foreground/80 hover:bg-accent" onClick={() => setAdding(!adding)}><Plus className="h-4 w-4" /></button>
    </div>
    {adding && <div className="flex gap-2 px-2 pb-2 pl-8">
      {available.length ? <>
        <select aria-label="Dossier à ajouter" className={inputClass} value={choice} onChange={(event) => setChoice(event.target.value)}>
          <option value="">Choisir un dossier…</option>
          {available.map((item) => <option key={item.path} value={item.path}>{folderName(item.path)}</option>)}
        </select>
        <button type="button" aria-label="Ajouter le dossier" className={buttonClass} disabled={!choice} onClick={() => { save({ folders: [...state.settings.folders, choice] }); setChoice(''); setAdding(false); }}>Ajouter</button>
      </> : <p className="text-sm text-muted-foreground">Tous les dossiers connus sont déjà suivis.</p>}
    </div>}
    <ul className="pb-2 pl-6">
      {state.settings.folders.length ? state.settings.folders.map((folder) => <CaseFolder key={folder} project={projectPath} folder={folder} />)
        : <li className="px-2 text-sm text-muted-foreground">Aucun dossier. Ajoutez-en un avec +.</li>}
    </ul>
  </section>;
}
