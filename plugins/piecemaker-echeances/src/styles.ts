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
.pme-band button{height:1.6rem;padding:0 .7rem;border:1px solid var(--border);border-radius:9999px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.pme-band button:disabled{cursor:default;opacity:.45}
.pme-frame{flex:1;min-height:0;width:100%;border:0;background:transparent}
.pme-tabs{flex:none;display:flex;gap:4px;padding:8px 16px;border-bottom:1px solid var(--border)}
.pme-tab{height:1.75rem;padding:0 .8rem;border:0;border-radius:9999px;background:transparent;color:var(--muted);font:500 12px var(--piecemaker-font-ui,inherit);cursor:pointer}
.pme-tab[aria-selected=true]{color:var(--ptr-text);box-shadow:inset 0 0 0 1px var(--ptr-border);font-weight:600}
.pme-view{flex:1;min-height:0;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.pme-view--frame{padding:0;gap:0;overflow:hidden}
.pme-toolbar{display:flex;align-items:center;gap:10px}
.pme-spacer{flex:1}
.pme-board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(260px,1fr);gap:14px;align-items:start;overflow-x:auto;padding-bottom:6px}
.pme-board--two{grid-auto-columns:minmax(280px,1fr)}
.pme-col{display:flex;flex-direction:column;gap:10px;min-width:0}
.pme-col h3{margin:0;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.pme-card{display:flex;flex-direction:column;gap:10px;padding:12px;border:1px solid var(--ptr-border);border-radius:10px;background:var(--ptr-surface)}
.pme-card.is-excluded{opacity:.6}
.pme-card-head{display:flex;align-items:flex-start;gap:8px}
.pme-card-title{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.pme-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.pme-muted{color:var(--muted)}
.pme-small{font-size:12px;margin:0}
.pme-card p{margin:0}
.pme-ok{color:#2f7d4f}
.pme-erreur{color:var(--ko)}
.pme-manque{color:var(--warn)}
.pme-checks{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px}
.pme-checks .is-ok{color:var(--muted)}
.pme-badged{position:relative}
.pme-badge{position:absolute;bottom:calc(100% + 2px);left:50%;transform:translateX(-50%);padding:1px 6px;border-radius:999px;background:#e5484d;color:#fff;font-size:10px;font-weight:600;line-height:14px;white-space:nowrap;pointer-events:none}
.pme-alertes summary{cursor:pointer}
.pme-alertes ul{margin:6px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:4px}
.pme-docs{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.pme-docs li{padding:8px;border:1px solid var(--ptr-border);border-radius:8px}
.pme-doc-head,.pme-doc-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pme-doc-head strong{flex:1}
.pme-pill{display:inline-flex;align-items:center;height:1.3rem;padding:0 .55rem;border:1px solid var(--ptr-border);border-radius:9999px;background:transparent;color:var(--muted);font:500 11px var(--piecemaker-font-ui,inherit);white-space:nowrap}
button.pme-pill{cursor:pointer}
.pme-pill--run{border-color:var(--ptr-accent);color:var(--ptr-accent)}
.pme-pill--todo{border-color:var(--warn);color:var(--warn)}
.pme-pill--done{border-color:#2f7d4f;color:#2f7d4f}
.pme-pill--ko{border-color:var(--ko);color:var(--ko)}
.pme-task{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pme-next{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pme-next-text{flex:1;min-width:0}
.pme-link{border:0;padding:0;background:transparent;color:var(--ptr-accent);font:inherit;cursor:pointer}
.pme-link--muted{color:var(--muted)}
.pme-link:hover{text-decoration:underline}
.pme-menus{display:flex;gap:8px;flex-wrap:wrap}
.pme-new-type{display:flex;flex-direction:column;gap:10px}
.pme-empty{margin:24px 0;text-align:center}
.pme-question{margin:0;white-space:pre-wrap;font:inherit;max-height:240px;overflow:auto}
.pme-demande{display:flex;flex-direction:column;gap:8px;padding-top:8px;border-top:1px solid var(--ptr-border)}
.pme-choix{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;border:0}
.pme-choix legend{margin-bottom:4px;font-weight:600}
.pme-done summary{cursor:pointer;color:var(--muted);font-weight:600}
.pme-done-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px;margin-top:10px}
`;
