import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { AiSettings, FindingStatus, Playbook, PluginApi, Rule, Run } from '../shared.js';
import { anonymizationProxyOrigin, loadModels } from '../../../piecemaker-tabular-review/src/client/runtime.js';
import { WordReview, type Rpc } from './WordReview.js';
import { STYLES } from './styles.js';

type Draft = Omit<Playbook, 'id' | 'revision' | 'createdAt' | 'updatedAt' | 'sources' | 'sourcePath' | 'sourceHash'> & Partial<Playbook>;
type Catalog = { playbooks: Playbook[]; runs: Run[]; documents: string[] };
const mounted = new WeakMap<HTMLElement, Root>();
const STATUS: Record<Run['status'], string> = { running: 'En cours', completed: 'Terminé', failed: 'Échec', interrupted: 'Interrompu', cancelled: 'Arrêté' };
const FINDING: Record<FindingStatus, string> = { acceptable: 'Acceptable', needs_review: 'À vérifier', unacceptable: 'Inacceptable', missing_required: 'Clause obligatoire absente', not_applicable: 'Non applicable' };

function newRule(): Rule {
  return { id: crypto.randomUUID(), name: '', concept: '', required: false, standard: '', fallbacks: [], unacceptable: [], conditions: [], guidance: '', suggestedClause: '', sourceRefs: [] };
}

function RuleForm({ rule, onChange, onRemove }: { rule: Rule; onChange(rule: Rule): void; onRemove(): void }) {
  const field = (key: keyof Rule, label: string, rows = false) => <label key={key}>{label}
    {rows ? <textarea value={Array.isArray(rule[key]) ? (rule[key] as string[]).join('\n') : String(rule[key])}
      onChange={(event) => onChange({ ...rule, [key]: Array.isArray(rule[key]) ? event.target.value.split('\n') : event.target.value })} />
      : <input value={String(rule[key])} onChange={(event) => onChange({ ...rule, [key]: event.target.value })} />}</label>;
  return <section className="rule"><div className="bar"><h3>{rule.name || 'Nouvelle règle'}</h3><button type="button" onClick={onRemove}>Retirer cette règle</button></div>
    <div className="grid">{field('name', 'Nom')}{field('concept', 'Point à contrôler', true)}{field('standard', 'Position souhaitée', true)}
      {field('fallbacks', 'Replis acceptés — un par ligne', true)}{field('unacceptable', 'Positions refusées — une par ligne', true)}
      {field('conditions', 'Conditions — une par ligne', true)}{field('guidance', 'Consignes et escalade', true)}{field('suggestedClause', 'Rédaction préférée', true)}
      {field('sourceRefs', 'Références au guide — une par ligne', true)}</div>
    <label className="check"><input type="checkbox" checked={rule.required} onChange={(event) => onChange({ ...rule, required: event.target.checked })} />Clause obligatoire</label>
  </section>;
}

function App({ api, context }: { api: PluginApi; context: PluginApi['context'] }) {
  const project = context.project?.path ?? null;
  const [catalog, setCatalog] = useState<Catalog>({ playbooks: [], runs: [], documents: [] });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [sourcePath, setSourcePath] = useState('');
  const [provider, setProvider] = useState<AiSettings['provider']>('claude');
  const [models, setModels] = useState<{ value: string; label: string }[]>([]);
  const [model, setModel] = useState('');
  const [mode, setMode] = useState<Run['mode']>('strict');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [wordDirty, setWordDirty] = useState(false);
  const [loading, setLoading] = useState(Boolean(project));
  const onError = useCallback((message: string) => setError(message), []);

  const rpc: Rpc = useMemo(() => async <T,>(method: string, route: string, body?: unknown): Promise<T> => {
    if (!project && route !== '/editor-style') throw new Error('Choisissez un dossier PieceMaker.');
    const query = method === 'GET' ? `${route}${route.includes('?') ? '&' : '?'}project=${encodeURIComponent(project ?? '')}` : route;
    const result = await api.rpc(method, query, method === 'GET' ? undefined : { ...(body as object ?? {}), project }) as T & { error?: string };
    if (result && typeof result.error === 'string') throw new Error(result.error);
    return result;
  }, [api, project]);

  const refresh = useCallback(async () => { if (project) setCatalog(await rpc<Catalog>('GET', '/catalog')); }, [rpc, project]);
  useEffect(() => {
    let live = true;
    if (project) rpc<Catalog>('GET', '/catalog').then((data) => { if (live) setCatalog(data); })
      .catch((failure) => { if (live) onError(failure.message); }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [project, rpc, onError]);
  useEffect(() => {
    let live = true;
    loadModels(provider).then((data) => { if (live) { setModels(data.options); setModel(data.cheapest); } })
      .catch(() => { if (live) { setModels([]); setModel(''); onError('Impossible de charger les modèles. Vérifiez le compte du fournisseur dans les paramètres.'); } });
    return () => { live = false; };
  }, [provider, onError]);
  const hasRunning = catalog.runs.some((entry) => entry.status === 'running');
  const selectedRunId = run?.id;
  const selectedRunStatus = run?.status;
  useEffect(() => {
    if (!project || (!hasRunning && selectedRunStatus !== 'running')) return;
    let live = true;
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      Promise.all([rpc<Catalog>('GET', '/catalog'), selectedRunId ? rpc<{ run: Run }>('GET', `/runs/${selectedRunId}`) : Promise.resolve(null)])
        .then(([data, current]) => { if (live) { setCatalog(data); if (current) setRun(current.run); } })
        .catch((failure) => { if (live) onError(failure.message); }).finally(() => { pending = false; });
    }, 2000);
    return () => { live = false; window.clearInterval(timer); };
  }, [project, rpc, hasRunning, selectedRunId, selectedRunStatus, onError]);

  const action = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (failure) { onError(failure instanceof Error ? failure.message : 'L’opération a échoué.'); }
    finally { setBusy(false); }
  };
  const leaveDraft = () => (!draftDirty && !wordDirty) || window.confirm('Des modifications ne sont pas enregistrées. Quitter sans les conserver ?');
  const changeDraft = (next: Draft) => { setDraft({ ...next, validated: false }); setDraftDirty(true); };
  const aiSettings = async (): Promise<AiSettings> => ({ provider, model, proxyOrigin: await anonymizationProxyOrigin() });
  const start = async (kind: 'imports' | 'reviews') => {
    if (!leaveDraft()) return;
    await action(async () => {
      if (!sourcePath || !model) throw new Error('Choisissez un document et un modèle.');
      if (kind === 'reviews' && (!draft?.id || !draft.validated || draftDirty)) throw new Error('Enregistrez et validez le playbook avant de lancer une revue.');
      const result = await rpc<{ run: Run }>('POST', `/${kind}`, { sourcePath, playbookId: draft?.id, mode, ...await aiSettings() });
      setRun(result.run); setDraft(null); setDraftDirty(false); await refresh();
    });
  };

  if (!project) return <main className="ppb" data-theme={context.theme}><h1>Playbooks</h1><p>Choisissez un dossier pour créer un guide de négociation ou examiner un contrat.</p></main>;

  return <main className="ppb" data-theme={context.theme} aria-busy={busy || loading}>
    <header className="bar"><h1>Playbooks</h1><span className="muted">{context.project?.name}</span>
      <button type="button" disabled={busy} onClick={() => { if (leaveDraft()) { setDraft({ name: '', representedParty: '', rules: [newRule()], validated: false }); setRun(null); setDraftDirty(false); } }}>Nouveau guide</button>
      <button type="button" disabled={busy || loading} onClick={() => void action(refresh)}>Actualiser</button></header>
    {error && <div className="error" role="alert">{error}<button type="button" onClick={() => setError('')}>Fermer</button></div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    <div className="layout"><aside>
      <section className="panel"><h2>Guides du dossier</h2>{loading ? <p role="status">Chargement…</p> : !catalog.playbooks.length ? <p className="muted">Aucun guide enregistré.</p> : catalog.playbooks.map((book) =>
        <button type="button" className="item" key={book.id} aria-pressed={draft?.id === book.id} onClick={() => { if (leaveDraft()) { setDraft(structuredClone(book)); setRun(null); setDraftDirty(false); } }}>{book.name}<br /><span className="muted">{book.rules.length} règles · {book.validated ? 'Validé' : 'À valider'}</span></button>)}</section>
      <section className="panel"><h2>Historique</h2>{!catalog.runs.length && <p className="muted">Aucun traitement.</p>}{catalog.runs.map((entry) =>
        <button type="button" className="item" key={entry.id} aria-pressed={run?.id === entry.id} onClick={() => { if (leaveDraft()) void action(async () => { const result = await rpc<{ run: Run }>('GET', `/runs/${entry.id}`); setRun(result.run); setDraft(null); setDraftDirty(false); }); }}>
          {entry.kind === 'import' ? 'Import' : 'Revue'} · {entry.sourcePath}<br /><span className="muted">{STATUS[entry.status]}</span></button>)}</section>
    </aside><div>
      <section className="panel"><h2>Document et modèle</h2><div className="grid">
        <label>Document du dossier<select value={sourcePath} onChange={(event) => setSourcePath(event.target.value)}><option value="">Choisir un document…</option>{catalog.documents.map((document) => <option key={document} value={document}>{document}</option>)}</select></label>
        <label>Fournisseur<select value={provider} onChange={(event) => setProvider(event.target.value as AiSettings['provider'])}><option value="claude">Claude</option><option value="codex">Codex</option><option value="mistral">Mistral</option></select></label>
        <label>Modèle<select value={model} onChange={(event) => setModel(event.target.value)}><option value="">Choisir un modèle…</option>{models.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label>Politique de revue<select value={mode} onChange={(event) => setMode(event.target.value as Run['mode'])}><option value="strict">Stricte — signaler les replis</option><option value="permissive">Permissive — accepter les replis prévus</option></select></label>
      </div><p className="muted">Les sessions utilisent votre compte et le proxy d’anonymisation. Un PDF doit avoir son Markdown converti dans le même dossier.</p>
        <div className="actions"><button type="button" disabled={busy || !sourcePath || !model} onClick={() => void start('imports')}>Importer ce document comme guide</button>
          <button type="button" className="primary" disabled={busy || !draft?.id || !draft.validated || draftDirty || !sourcePath || !model} onClick={() => void start('reviews')}>Examiner ce contrat</button></div></section>

      {draft && <section className="panel"><h2>Règles du guide</h2><div className="grid"><label>Nom<input value={draft.name} onChange={(event) => changeDraft({ ...draft, name: event.target.value })} /></label>
        <label>Partie représentée<input value={draft.representedParty} onChange={(event) => changeDraft({ ...draft, representedParty: event.target.value })} /></label></div>
        {draft.rules.map((rule, index) => <RuleForm key={rule.id} rule={rule} onChange={(next) => changeDraft({ ...draft, rules: draft.rules.map((entry, i) => i === index ? next : entry) })}
          onRemove={() => changeDraft({ ...draft, rules: draft.rules.filter((entry) => entry.id !== rule.id) })} />)}
        <div className="actions"><button type="button" onClick={() => changeDraft({ ...draft, rules: [...draft.rules, newRule()] })}>Ajouter une règle</button></div>
        <label className="check"><input type="checkbox" checked={draft.validated} onChange={(event) => { setDraft({ ...draft, validated: event.target.checked }); setDraftDirty(true); }} />J’ai vérifié les règles et leurs sources.</label>
        <div className="actions"><button type="button" className="primary" disabled={busy} onClick={() => void action(async () => { const result = await rpc<{ playbook: Playbook }>('POST', '/playbooks', { playbook: draft }); setDraft(result.playbook); setDraftDirty(false); setNotice('Guide enregistré.'); await refresh(); })}>Enregistrer le guide</button>
          {draft.id && <button type="button" disabled={busy} onClick={() => { if (window.confirm('Supprimer ce guide ? Les revues précédentes seront conservées.')) void action(async () => { await rpc('DELETE', `/playbooks/${draft.id}`); setDraft(null); setDraftDirty(false); await refresh(); }); }}>Supprimer le guide</button>}</div>
        {Boolean(draft.sources?.length) && <details><summary>Sources du guide importé</summary><div className="source">{draft.sources!.map((source) => <p key={source.id}><strong>{source.id} — {source.location}</strong><br />{source.text}</p>)}</div></details>}
      </section>}

      {run && <section><div className="panel"><h2>{run.kind === 'import' ? 'Import du guide' : `Revue : ${run.playbook?.name ?? ''}`}</h2><p>{run.sourcePath} · {STATUS[run.status]} · {run.settings.provider} / {run.settings.model}</p>
        {run.status === 'running' && <p role="status">{run.stage === 'repairing' ? 'Correction du format de la réponse…' : 'Analyse en cours… Vous pouvez quitter ce volet.'}</p>}
        {run.error && <p role="alert">{run.error}</p>}{run.summary && <p>{run.summary}</p>}
        <div className="actions">{run.status === 'running' && <button type="button" disabled={busy} onClick={() => void action(async () => { setRun((await rpc<{ run: Run }>('POST', `/runs/${run.id}/cancel`)).run); await refresh(); })}>Arrêter</button>}
          {['failed', 'interrupted', 'cancelled'].includes(run.status) && <button type="button" disabled={busy} onClick={() => void action(async () => { const settings = { provider: run.settings.provider, model: run.settings.model, proxyOrigin: await anonymizationProxyOrigin() }; setRun((await rpc<{ run: Run }>('POST', `/runs/${run.id}/retry`, settings)).run); await refresh(); })}>Reprendre avec les mêmes règles</button>}
          {run.kind === 'import' && run.status === 'completed' && run.playbook && <button type="button" onClick={() => { setDraft(structuredClone(run.playbook!)); setRun(null); setDraftDirty(false); }}>Vérifier les règles importées</button>}</div>
        {run.kind === 'review' && <details><summary>Règles figées pour cette revue</summary><p>{run.playbook?.rules.map((rule) => rule.name).join(' · ')}</p></details>}
        {run.findings.map((finding) => <article className="finding" key={finding.id}><h3>{finding.ruleName} — {FINDING[finding.status]}</h3><p>{finding.analysis}</p>
          {finding.quote && <blockquote>{finding.quote}</blockquote>}<p className="muted">{finding.location} · {finding.verified ? 'Extrait ou ancre retrouvé' : 'Sans extrait vérifié'}</p>
          {finding.suggestedText && <details><summary>Rédaction proposée</summary><blockquote>{finding.suggestedText}</blockquote></details>}</article>)}
        {run.status === 'completed' && run.kind === 'review' && !run.outputHash && <p className="muted">Résultats en lecture seule. La proposition de révisions Eigenpal nécessite un contrat .docx.</p>}
      </div>{run.status === 'completed' && run.outputHash && <WordReview key={`${project}:${run.id}`} run={run} rpc={rpc} onRun={setRun} onError={onError} onDirty={setWordDirty} />}</section>}
      {!draft && !run && <section className="panel"><h2>Vos positions de négociation</h2><p>Créez vos règles ou importez un guide existant. Validez les règles, puis examinez un contrat. Les revues et les copies Word restent dans ce dossier.</p></section>}
    </div></div>
  </main>;
}

function HostApp({ api }: { api: PluginApi }) {
  const [context, setContext] = useState(api.context);
  useEffect(() => api.onContextChange(setContext), [api]);
  return <App key={context.project?.path ?? ''} api={api} context={context} />;
}

export function mount(container: HTMLElement, api: PluginApi): void {
  const root = createRoot(container); mounted.set(container, root);
  root.render(<><style>{STYLES}</style><HostApp api={api} /></>);
}

export function unmount(container: HTMLElement): void { mounted.get(container)?.unmount(); mounted.delete(container); }
