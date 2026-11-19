import { AlertCircle, ArrowUp, ChevronDown, Megaphone, Menu, Mic, PanelRight, Plus, Scale, Settings, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { AgentMessage } from '@/modules/piecemaker-agent/AgentMessage';
import type { AgentOutput, AgentState } from '@/modules/piecemaker-agent/api';
import { PROVIDER_LABELS } from '@/modules/piecemaker-agent/format';
import type { AgentActions } from '@/modules/piecemaker-agent/useAgentState';

type Props = {
  projectName: string;
  projectPath: string;
  state: AgentState;
  error: string | null;
  act: AgentActions;
  panelOpen: boolean;
  onOpenPanel: (tab?: 'threads' | 'context' | 'instructions' | 'settings') => void;
  onOpenOutput: (output: AgentOutput) => void;
  onMenu?: () => void;
};

type SpeechWindow = Window & { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
type SpeechRecognitionLike = { lang: string; interimResults: boolean; onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; start(): void; stop(): void };

const seenKey = (project: string) => `pm-agent-seen:${project}`;

function readSeen(project: string): string | null {
  try { return window.localStorage.getItem(seenKey(project)); } catch { return null; }
}

function writeSeen(project: string, at: string) {
  try { window.localStorage.setItem(seenKey(project), at); } catch { return; }
}

function Wavy() {
  return <svg className="h-2 flex-1 text-orange-400" preserveAspectRatio="none" viewBox="0 0 120 8" aria-hidden="true">
    <path d="M0 4 Q 5 0 10 4 T 20 4 T 30 4 T 40 4 T 50 4 T 60 4 T 70 4 T 80 4 T 90 4 T 100 4 T 110 4 T 120 4" fill="none" stroke="currentColor" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
  </svg>;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function AgentChat({ projectName, projectPath, state, error, act, panelOpen, onOpenPanel, onOpenOutput, onMenu }: Props) {
  const [draft, setDraft] = useState('');
  const [attached, setAttached] = useState<string[]>([]);
  const [menu, setMenu] = useState<'project' | 'announcements' | 'mic' | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [language, setLanguage] = useState('fr-FR');
  const [seenAt] = useState(() => readSeen(projectPath));
  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const speech = (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition;

  const firstUnread = useMemo(() => seenAt ? state.messages.find((message) => message.author !== 'user' && message.at > seenAt)?.id ?? null : null, [seenAt, state.messages]);
  const ackIds = useMemo(() => {
    const seen = new Set<string>();
    return new Set(state.messages.filter((message) => {
      if (!message.threadId || message.author !== 'orchestrator' || seen.has(message.threadId)) return false;
      seen.add(message.threadId);
      return true;
    }).map((message) => message.id));
  }, [state.messages]);
  const announcements = state.messages.filter((message) => message.notify);
  const connected = state.providers.some((provider) => provider.authenticated);
  const lastSystem = [...state.messages].reverse().find((message) => message.author !== 'user');
  const banner = !connected
    ? { id: 'no-provider', title: 'Aucun fournisseur IA connecté', text: 'Connectez Claude, Codex ou Mistral pour que l’agent puisse répondre.', action: 'Connecter' }
    : lastSystem?.author === 'system' && !lastSystem.approval && !lastSystem.folderRequest && !lastSystem.connect
      ? { id: lastSystem.id, title: 'Le dernier tour n’a pas abouti', text: lastSystem.text, action: 'Paramètres' }
      : null;
  const model = state.settings.orchestratorModel || PROVIDER_LABELS[state.orchestrator.provider ?? state.settings.orchestratorProvider];

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
    const last = state.messages.at(-1);
    if (!last) return;
    const timer = window.setTimeout(() => writeSeen(projectPath, last.at), 1500);
    return () => window.clearTimeout(timer);
  }, [projectPath, state.messages]);

  async function send() {
    const text = [draft.trim(), ...attached.map((path) => `Fichier joint : ${path}`)].filter(Boolean).join('\n');
    if (!text) return;
    setDraft('');
    setAttached([]);
    await act('message', { text });
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  async function attach(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      const result = await act('file', { name: file.name, content: await toBase64(file) }) as { path?: string } | null;
      if (result?.path) setAttached((current) => [...current, result.path!]);
    }
  }

  function dictate() {
    if (!speech) return;
    if (listening) { recognitionRef.current?.stop(); return; }
    const recognition = new speech();
    recognition.lang = language;
    recognition.interimResults = false;
    recognition.onresult = (event) => setDraft((current) => `${current}${current ? ' ' : ''}${Array.from(event.results).map((result) => result[0].transcript).join(' ')}`);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  function openSettings() {
    setMenu(null);
    if (banner?.id === 'no-provider') window.dispatchEvent(new CustomEvent('piecemaker:open-settings', { detail: { tab: 'agents' } }));
    else onOpenPanel('settings');
  }

  return <section className="pm-agent flex h-full min-w-0 flex-1 flex-col bg-[#1f1f1e] text-zinc-100" aria-label="PieceMaker Agent">
    <header className="relative flex h-14 shrink-0 items-center gap-2 border-b border-white/10 px-4">
      {onMenu && <button type="button" aria-label="Ouvrir le menu" className="rounded-lg p-2 text-zinc-300 hover:bg-white/10" onClick={onMenu}><Menu className="h-[18px] w-[18px]" /></button>}
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 text-violet-300"><Scale className="h-4 w-4" /></span>
      <button type="button" className="flex min-w-0 items-center gap-1 rounded-lg px-2 py-1 hover:bg-white/10" aria-haspopup="menu" aria-expanded={menu === 'project'} onClick={() => setMenu(menu === 'project' ? null : 'project')}>
        <span className="truncate text-[15px] font-medium">{projectName}</span><ChevronDown className="h-4 w-4 text-zinc-400" />
      </button>
      {menu === 'project' && <div role="menu" className="absolute left-14 top-12 z-20 w-56 rounded-xl border border-white/10 bg-[#2a2a28] p-1 shadow-xl">
        <button role="menuitem" type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10" onClick={() => { setMenu(null); onOpenPanel('settings'); }}>Paramètres du projet</button>
        <button role="menuitem" type="button" className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/10" onClick={() => { setMenu(null); void act('recycle'); }}>Recycler l’orchestrateur</button>
      </div>}
      <span className="flex-1" />
      <button type="button" aria-label="Annonces" className="relative rounded-lg p-2 text-zinc-300 hover:bg-white/10" onClick={() => setMenu(menu === 'announcements' ? null : 'announcements')}>
        <Megaphone className="h-[18px] w-[18px]" />
        {announcements.length > 0 && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-orange-400" />}
      </button>
      {menu === 'announcements' && <div className="absolute right-12 top-12 z-20 max-h-80 w-80 overflow-auto rounded-xl border border-white/10 bg-[#2a2a28] p-3 shadow-xl">
        {announcements.length ? announcements.map((message) => <p key={message.id} className="border-b border-white/5 py-2 text-sm text-zinc-200 last:border-0">{message.text}</p>) : <p className="text-sm text-zinc-400">Aucune annonce.</p>}
      </div>}
      <button type="button" aria-label="Paramètres" className="rounded-lg p-2 text-zinc-300 hover:bg-white/10" onClick={() => onOpenPanel('settings')}><Settings className="h-[18px] w-[18px]" /></button>
      {!panelOpen && <button type="button" aria-label="Ouvrir le volet" className="rounded-lg p-2 text-zinc-300 hover:bg-white/10" onClick={() => onOpenPanel()}><PanelRight className="h-[18px] w-[18px]" /></button>}
    </header>

    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-6 py-6">
        {state.messages.length === 0 && <div className="py-24 text-center">
          <p className="text-lg text-zinc-200">PieceMaker Agent</p>
          <p className="mt-2 text-sm text-zinc-400">Décrivez ce que vous voulez faire. L’agent répond aux questions rapides et confie chaque travail à un fil de discussion.</p>
        </div>}
        {state.messages.map((message) => <div key={message.id}>
          {message.id === firstUnread && <div className="my-4 flex items-center gap-3" role="separator" aria-label="Nouveau"><Wavy /><span className="text-sm text-orange-400">Nouveau</span><Wavy /></div>}
          <AgentMessage message={message} state={state} act={act} ack={ackIds.has(message.id)} onOpenOutput={onOpenOutput} />
        </div>)}
      </div>
    </div>

    <div className="mx-auto w-full max-w-3xl shrink-0 px-6 pb-4">
      {banner && dismissed !== banner.id && <div className="mb-3 flex gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3" role="status">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-zinc-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] text-zinc-100">{banner.title}</p>
          <p className="mt-0.5 line-clamp-2 text-sm text-zinc-400">{banner.text}</p>
          <button type="button" className="mt-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/15" onClick={openSettings}>{banner.action}</button>
        </div>
        <button type="button" aria-label="Fermer l’alerte" className="self-start rounded p-1 text-zinc-400 hover:bg-white/10" onClick={() => setDismissed(banner.id)}><X className="h-4 w-4" /></button>
      </div>}
      {error && <p className="mb-2 text-sm text-red-400" role="alert">{error}</p>}
      <div className="rounded-3xl border border-white/10 bg-[#2a2a28] px-4 pb-3 pt-3">
        {attached.length > 0 && <div className="mb-2 flex flex-wrap gap-2">{attached.map((path) => <span key={path} className="rounded-lg bg-white/10 px-2 py-1 text-xs text-zinc-300">{path.split(/[\\/]/).at(-1)}</span>)}</div>}
        <div className="flex items-end gap-2">
          <textarea aria-label="Message à PieceMaker Agent" value={draft} rows={1} placeholder="Écrire à PieceMaker Agent…"
            onChange={(event) => setDraft(event.target.value)} onKeyDown={onKeyDown}
            className="max-h-60 min-h-[28px] flex-1 resize-none bg-transparent text-[15px] leading-7 text-zinc-100 outline-none placeholder:text-zinc-500"
            style={{ height: `${Math.min(240, 28 * Math.max(1, draft.split('\n').length))}px` }} />
          <button type="button" aria-label="Envoyer" disabled={!draft.trim() && !attached.length} onClick={() => void send()}
            className="rounded-full p-1.5 text-zinc-200 hover:bg-white/10 disabled:opacity-30"><ArrowUp className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="relative mt-2 flex items-center gap-1 px-2 text-zinc-400">
        <button type="button" aria-label="Joindre un fichier" className="rounded-lg p-1.5 hover:bg-white/10" onClick={() => fileRef.current?.click()}><Plus className="h-5 w-5" /></button>
        <input ref={fileRef} type="file" multiple hidden onChange={(event) => { void attach(event.target.files); event.target.value = ''; }} />
        {speech && <>
          <button type="button" aria-label={listening ? 'Arrêter la dictée' : 'Dicter'} aria-pressed={listening} className={`rounded-lg p-1.5 hover:bg-white/10 ${listening ? 'text-orange-400' : ''}`} onClick={dictate}><Mic className="h-5 w-5" /></button>
          <button type="button" aria-label="Langue de la dictée" className="rounded-lg p-0.5 hover:bg-white/10" onClick={() => setMenu(menu === 'mic' ? null : 'mic')}><ChevronDown className="h-4 w-4" /></button>
          {menu === 'mic' && <div role="menu" className="absolute bottom-9 left-10 z-20 rounded-xl border border-white/10 bg-[#2a2a28] p-1 shadow-xl">
            {[['fr-FR', 'Français'], ['en-US', 'English']].map(([value, label]) => <button key={value} role="menuitemradio" aria-checked={language === value} type="button"
              className="block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-white/10" onClick={() => { setLanguage(value); setMenu(null); }}>{label}</button>)}
          </div>}
        </>}
        <span className="flex-1" />
        <span className="text-sm text-zinc-300">{model}</span>
        <span aria-label={state.orchestrator.running ? 'L’agent travaille' : 'L’agent est disponible'} role="status"
          className={`ml-2 h-4 w-4 rounded-full border-2 ${state.orchestrator.running ? 'animate-spin border-orange-400 border-t-transparent' : 'border-zinc-600'}`} />
      </div>
    </div>
  </section>;
}
