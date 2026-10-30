export const STYLES = `
.pme{
  height:100%;display:flex;flex-direction:column;min-height:0;overflow-wrap:anywhere;
  background:hsl(var(--background));color:var(--piecemaker-text,#374151);
  font:13px/1.45 var(--piecemaker-font-ui,Inter,ui-sans-serif,system-ui,sans-serif);
  --border:var(--piecemaker-border,#e5e7eb);--muted:var(--piecemaker-muted,#6b7280);--ko:#9f3b3b;--warn:#8a6514
}
.pme[data-theme=dark]{--border:hsl(var(--border));--muted:hsl(var(--muted-foreground));--ko:#f0c4c4;--warn:#ecd29a}
.pme *{box-sizing:border-box}
.pme-band:empty{display:none}
.pme-band{flex:none;max-height:40%;overflow:auto;padding:6px 16px;border-bottom:1px solid var(--border)}
.pme-prompt{float:right;margin-left:8px}
.pme-band summary{cursor:pointer;color:var(--muted)}
.pme-band summary.pme-erreur{color:var(--ko)}
.pme-band ul{margin:4px 0;padding:0;list-style:none}
.pme-dossier{padding:6px 0;border-top:1px solid var(--border)}
.pme-dossier-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pme-dossier-head strong{margin-right:auto}
.pme li.pme-erreur{color:var(--ko)}
.pme li.pme-manque{color:var(--warn)}
.pme button{height:1.6rem;padding:0 .7rem;border:1px solid var(--border);border-radius:9999px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.pme button:disabled{cursor:default;opacity:.45}
.pme-frame{flex:1;min-height:0;width:100%;border:0;background:transparent}
`;
