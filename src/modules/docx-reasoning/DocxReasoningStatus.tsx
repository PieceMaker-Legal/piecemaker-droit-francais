import type { DocxReasoningCheckState } from '@/modules/docx-reasoning/api';

export function DocxReasoningStatus({ state, onCheck }: { state: DocxReasoningCheckState; onCheck: () => void }) {
  const report = state.report;
  if (!report || report.status === 'unlinked') return null;
  const errors = report.status === 'tested' ? report.issues.filter((issue) => issue.kind === 'erreur').length : 0;
  const label = state.phase === 'dirty' ? 'Document modifié · vérification à actualiser'
    : state.phase === 'checking' ? 'Vérification locale en cours…'
      : report.status === 'review' ? 'Raisonnement à revoir'
        : report.status === 'error' ? 'Vérification impossible'
          : errors ? `Test local : ${errors} erreur${errors > 1 ? 's' : ''}`
            : report.issues.length ? `Test local exécuté · ${report.issues.length} points à examiner` : 'Test local exécuté';
  return (
    <section className="shrink-0 border-b border-border bg-background px-3 py-2 text-xs" aria-label="Contrôle du raisonnement">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite">{label}</p>
        <button type="button" className="rounded border border-border px-2 py-1 disabled:opacity-50" disabled={state.phase !== 'ready'} onClick={onCheck}>Relancer le contrôle</button>
      </div>
      {state.phase === 'ready' && <p className="mt-1 text-muted-foreground">Modèle lié au document. Sources externes non relues.</p>}
      {state.phase === 'ready' && (
        <details className="mt-1 max-h-40 overflow-auto">
          <summary className="cursor-pointer">Détails du contrôle</summary>
          <p className="mt-1 text-muted-foreground">Contrôle local. Sources externes, parties et fiabilité des pièces non relues.</p>
          {report.status === 'error' && <p>{report.message}</p>}
          {report.status === 'review' && <>
            <p>Le résultat précédent est suspendu. Les passages modifiés doivent être réexaminés.</p>
            {report.changed.includes('révisions en attente') && <p>Des modifications suivies restent à accepter ou à refuser.</p>}
            {report.context.map((passage) => <blockquote key={passage.tag} className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-2">{passage.text}</blockquote>)}
          </>}
          {report.status === 'tested' && <>
            {report.objectives?.map((objective, index) => <p key={index}>{objective.objectif}{typeof objective.montant_calcule === 'number' ? ` : ${objective.montant_calcule.toLocaleString('fr-FR')}` : ''}</p>)}
            {report.issues.length ? <ul className="list-disc pl-4">{report.issues.map((issue, index) => <li key={index}>{issue.kind === 'erreur' ? 'Erreur' : 'À examiner'} : {issue.text}</li>)}</ul> : <p>Aucune erreur ni manque signalé par ce test local. Cela ne vaut pas validation juridique complète.</p>}
          </>}
        </details>
      )}
    </section>
  );
}
