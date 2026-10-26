export const STYLES = `
.pme{
  height:100%;display:flex;flex-direction:column;min-height:0;overflow-wrap:anywhere;
  background:hsl(var(--background));color:var(--piecemaker-text,#374151);
  font:13px/1.45 var(--piecemaker-font-ui,Inter,ui-sans-serif,system-ui,sans-serif);
  --surface:hsl(var(--card));--soft:hsl(var(--muted));
  --border:var(--piecemaker-border,#e5e7eb);--text:var(--piecemaker-text,#374151);--muted:var(--piecemaker-muted,#6b7280);--ink:var(--piecemaker-ink,#111827);
  --accent:var(--piecemaker-blue,rgb(0 136 255));--ok:#3f6f4e;--ok-soft:#a8d5b5;--ko:#9f3b3b;--ko-soft:#efb4b4;--warn:#8a6514;--warn-soft:#f2d79c;
  --glass-bg:var(--liquid-glass-background-subtle,rgb(255 255 255 / .78));--glass-border:var(--liquid-glass-border-subtle,rgb(229 231 235 / .9));
  --glass-shadow:var(--liquid-glass-shadow-subtle,inset 0 1px 0 rgb(255 255 255 / .8),0 1px 2px rgb(15 23 42 / .05));
  --editorial:var(--piecemaker-font-editorial,EB Garamond,Georgia,serif);--mono:ui-monospace,SFMono-Regular,Menlo,monospace
}
.pme[data-theme=dark]{
  --border:hsl(var(--border));--text:hsl(var(--foreground));--muted:hsl(var(--muted-foreground));--ink:hsl(var(--foreground));
  --ok:#b7dcc2;--ok-soft:#7fae8d;--ko:#f0c4c4;--ko-soft:#c98a8a;--warn:#ecd29a;--warn-soft:#b8995a;
  --glass-bg:var(--liquid-glass-background-subtle,rgb(24 28 36 / .72));--glass-border:var(--liquid-glass-border-subtle,rgb(255 255 255 / .08));
  --glass-shadow:var(--liquid-glass-shadow-subtle,inset 0 1px 0 rgb(255 255 255 / .06),0 1px 2px rgb(0 0 0 / .35))
}
.pme *{box-sizing:border-box}
.pme button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:1.75rem;padding:0 .75rem;border:1px solid var(--glass-border);border-radius:9999px;background:var(--glass-bg);box-shadow:var(--glass-shadow);color:var(--text);font:500 12px var(--piecemaker-font-ui,inherit);cursor:pointer;white-space:nowrap}
.pme button:hover{filter:brightness(.97)}.pme button:disabled{cursor:default;opacity:.45}
.pme button:focus-visible,.pme input:focus-visible,.pme summary:focus-visible{outline:none;box-shadow:0 0 0 2px rgb(0 136 255 / 40%)}
.pme input{font:inherit;color:var(--text);border:1px solid var(--border);border-radius:.6rem;background:var(--surface);padding:5px 9px;min-width:0}
.pme .pme-primary{background:rgb(3 7 18 / 88%);border-color:transparent;color:#fff;box-shadow:none}
.pme[data-theme=dark] .pme-primary{background:rgb(255 255 255 / 92%);color:#0b0f17}
.pme-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--border)}
.pme-head strong{font-family:var(--editorial);font-size:1.25rem;font-weight:500;letter-spacing:-.02em;color:var(--ink);margin-right:auto}
.pme-head input[type=search]{flex:0 1 200px;border-radius:9999px}
.pme-head [data-refresh]{width:1.75rem;padding:0}
.pme-switch{display:inline-flex;padding:2px;border:1px solid var(--border);border-radius:9999px;background:var(--soft)}
.pme-switch button{border:0;background:transparent;box-shadow:none;height:1.5rem}
.pme-switch button[aria-selected=true]{background:var(--surface);box-shadow:var(--glass-shadow);color:var(--ink)}
.pme-notice{margin:8px 16px 0;padding:7px 12px;border-radius:10px;background:var(--soft);font-size:12px}
.pme-chips{display:flex;gap:8px;flex-wrap:wrap;padding:10px 16px 4px}
.pme .pme-chip{height:auto;padding:6px 12px;border-radius:12px;font-weight:500}
.pme-chip b{font-size:15px;font-variant-numeric:tabular-nums}
.pme-chip.is-ko:not(.is-zero){border-color:color-mix(in srgb,var(--ko) 40%,transparent);background:color-mix(in srgb,var(--ko-soft) 22%,var(--surface));color:var(--ko)}
.pme-chip.is-warn:not(.is-zero){border-color:color-mix(in srgb,var(--warn) 35%,transparent);background:color-mix(in srgb,var(--warn-soft) 22%,var(--surface));color:var(--warn)}
.pme-chip.is-zero{opacity:.55}
.pme-body{flex:1;min-height:0;overflow:auto;padding:4px 16px 24px}
.pme-empty{margin:40px auto;max-width:460px;text-align:center;color:var(--muted)}
.pme-empty p{margin:0 0 8px}.pme-empty.is-error{color:var(--ko)}
.pme-hint{color:var(--muted);font-size:12px;font-weight:400}
.pme-group{margin-top:14px}
.pme-group-head,.pme-group>summary{display:flex;align-items:baseline;gap:8px;padding:4px 2px 6px;cursor:default;list-style:none}
.pme-group>summary{cursor:pointer}.pme-group>summary::-webkit-details-marker{display:none}
.pme-group>summary::before{content:'›';display:inline-block;transition:transform .15s;color:var(--muted)}.pme-group[open]>summary::before{transform:rotate(90deg)}
.pme-group h3{margin:0;font-family:var(--editorial);font-size:1.05rem;font-weight:500;color:var(--ink)}
.pme-group.is-retard h3{color:var(--ko)}
.pme-count{font-size:11px;font-weight:600;padding:0 7px;border-radius:9999px;background:var(--soft);color:var(--muted)}
.pme-group.is-retard .pme-count{background:color-mix(in srgb,var(--ko-soft) 35%,transparent);color:var(--ko)}
.pme-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.pme-row{border:1px solid var(--border);border-radius:12px;background:var(--surface);overflow:hidden}
.pme-row.is-retard{border-left:3px solid var(--ko)}.pme-row.is-aujourdhui,.pme-row.is-semaine{border-left:3px solid var(--warn)}.pme-row.is-done{opacity:.75}
.pme .pme-summary{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:12px;width:100%;padding:8px 12px;cursor:pointer}
.pme .pme-summary:focus-visible{box-shadow:inset 0 0 0 2px rgb(0 136 255 / 40%)}
.pme-date{flex:0 0 52px;display:flex;flex-direction:column;align-items:center;line-height:1.1;padding:4px 0;border-radius:10px;background:var(--soft)}
.pme-date b{font-size:19px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}
.pme-date span{font-size:10.5px;color:var(--muted);text-transform:lowercase}
.pme-row.is-retard .pme-date{background:color-mix(in srgb,var(--ko-soft) 30%,var(--surface))}
.pme-date.is-empty b{color:var(--muted)}
.pme-main{flex:1;min-width:0;display:flex;flex-direction:column}
.pme-title{font-weight:600;color:var(--ink)}
.pme-folder{font-size:12px;color:var(--muted)}
.pme-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:5px}
.pme-badge{font-size:11px;font-weight:500;padding:2px 8px;border-radius:9999px;white-space:nowrap;border:1px solid transparent}
.pme-badge.is-ok{color:var(--ok);background:color-mix(in srgb,var(--ok-soft) 25%,transparent)}
.pme-badge.is-ko{color:var(--ko);background:color-mix(in srgb,var(--ko-soft) 28%,transparent)}
.pme-badge.is-warn{color:var(--warn);background:color-mix(in srgb,var(--warn-soft) 30%,transparent)}
.pme-badge.is-muted{color:var(--muted);background:var(--soft)}
.pme-chevron{color:var(--muted);font-size:18px;transition:transform .15s}.pme-row.is-open .pme-chevron{transform:rotate(90deg)}
.pme-detail{padding:4px 14px 12px 76px;border-top:1px solid var(--border);display:flex;flex-direction:column;gap:10px}
.pme-block h4{margin:8px 0 4px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
.pme-steps{margin:0;padding-left:18px;font-variant-numeric:tabular-nums}
.pme-cites,.pme-issues{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px}
.pme-cites li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px}
.pme-src{font-weight:600;color:var(--ink)}
.pme-cites code{font:11px var(--mono);color:var(--muted)}
.pme-cites q{flex-basis:100%;font-family:var(--editorial);font-size:14px;color:var(--text);padding-left:10px;border-left:2px solid var(--border)}
.pme .pme-link{height:auto;padding:0 6px;border:0;box-shadow:none;background:none;color:var(--accent)}
.pme-issues li{padding-left:12px;position:relative}.pme-issues li::before{content:'';position:absolute;left:0;top:.55em;width:6px;height:6px;border-radius:50%}
.pme-issues li.is-ko::before{background:var(--ko)}.pme-issues li.is-warn::before{background:var(--warn)}
.pme-actions{display:flex;align-items:flex-end;gap:10px;flex-wrap:wrap;padding-top:8px;border-top:1px dashed var(--border)}
.pme-actions label{display:flex;flex-direction:column;gap:3px;font-size:11px;color:var(--muted)}
.pme-actions .pme-grow{flex:1 1 160px}
.pme-done{margin:0;flex:1;color:var(--ok);font-weight:500}
.pme-event{display:flex;align-items:center;gap:12px;padding:6px 12px;border-bottom:1px solid var(--border)}
.pme-when{flex:0 0 76px;font-variant-numeric:tabular-nums;color:var(--muted)}
.pme-alert{margin-top:12px;padding:9px 12px;border:1px solid color-mix(in srgb,var(--warn) 35%,var(--border));border-radius:12px;background:color-mix(in srgb,var(--warn-soft) 14%,var(--surface))}
.pme-alert summary{cursor:pointer;font-weight:500;color:var(--warn)}
.pme-alert>ul{list-style:none;padding:0;margin:8px 0 0;display:flex;flex-direction:column;gap:8px}
@media (max-width:560px){
  .pme-head input[type=search]{flex:1 1 100%}
  .pme-detail{padding-left:14px}
}
`;
