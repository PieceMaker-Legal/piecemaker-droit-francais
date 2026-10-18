export const STYLES = `
.pmr{
  height:100%;display:flex;flex-direction:column;min-height:0;container-type:inline-size;
  background:hsl(var(--background));color:var(--piecemaker-text,#374151);
  font:13px/1.45 var(--piecemaker-font-ui,Inter,ui-sans-serif,system-ui,sans-serif);
  --bg:hsl(var(--background));--surface:hsl(var(--card));--soft:hsl(var(--muted));
  --border:var(--piecemaker-border,#e5e7eb);--text:var(--piecemaker-text,#374151);--muted:var(--piecemaker-muted,#6b7280);--ink:var(--piecemaker-ink,#111827);
  --accent:var(--piecemaker-blue,rgb(0 136 255));--ok:#4e7a5c;--ok-soft:#a8d5b5;--ko:#9f3b3b;--ko-soft:#efb4b4;--warn:#9a7420;--warn-soft:#f2d79c;
  --glass-bg:var(--liquid-glass-background-subtle,rgb(255 255 255 / .78));--glass-border:var(--liquid-glass-border-subtle,rgb(229 231 235 / .9));
  --glass-shadow:var(--liquid-glass-shadow-subtle,inset 0 1px 0 rgb(255 255 255 / .8),0 1px 2px rgb(15 23 42 / .05));
  --editorial:var(--piecemaker-font-editorial,EB Garamond,Georgia,serif);--mono:ui-monospace,SFMono-Regular,Menlo,monospace
}
.pmr[data-theme=dark]{
  --border:hsl(var(--border));--text:hsl(var(--foreground));--muted:hsl(var(--muted-foreground));--ink:hsl(var(--foreground));
  --ok:#b7dcc2;--ok-soft:#7fae8d;--ko:#f0c4c4;--ko-soft:#c98a8a;--warn:#ecd29a;--warn-soft:#b8995a;
  --glass-bg:var(--liquid-glass-background-subtle,rgb(24 28 36 / .72));--glass-border:var(--liquid-glass-border-subtle,rgb(255 255 255 / .08));
  --glass-shadow:var(--liquid-glass-shadow-subtle,inset 0 1px 0 rgb(255 255 255 / .06),0 1px 2px rgb(0 0 0 / .35))
}
.pmr *{box-sizing:border-box}.pmr [hidden]{display:none!important}
.pmr button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:1.75rem;padding:0 .75rem;border:1px solid var(--glass-border);border-radius:9999px;background:var(--glass-bg);box-shadow:var(--glass-shadow);color:var(--text);font:500 12px var(--piecemaker-font-ui,inherit);cursor:pointer;white-space:nowrap;backdrop-filter:blur(20px);transition:filter .15s ease,transform .15s ease}
.pmr button:hover{filter:brightness(.97)}.pmr button:active{transform:scale(.98)}.pmr button:disabled{cursor:default;opacity:.45}
.pmr button:focus-visible,.pmr select:focus-visible,.pmr input:focus-visible,.pmr textarea:focus-visible{outline:none;box-shadow:0 0 0 2px rgb(0 136 255 / 40%),0 0 0 4px var(--bg)}
.pmr select,.pmr input,.pmr textarea{font:inherit;color:var(--text);border:1px solid var(--border);border-radius:.75rem;background:var(--surface);padding:7px 10px}
.pmr .pmr-primary{background:rgb(3 7 18 / 88%);border-color:transparent;color:#fff;box-shadow:none;backdrop-filter:none}
.pmr[data-theme=dark] .pmr-primary{background:rgb(255 255 255 / 92%);color:#0b0f17}
.pmr-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--border)}
.pmr-head strong{flex:1;font-family:var(--editorial);font-size:1.25rem;font-weight:500;letter-spacing:-.02em;color:var(--ink)}
.pmr-head select{min-width:0;max-width:100%;flex:1 1 190px;font-size:12px;border-radius:9999px;padding:4px 10px}
.pmr-head [data-refresh]{width:1.75rem;padding:0}
.pmr-meta{padding:8px 16px 0;color:var(--muted);font-size:11px}.pmr-meta:empty{display:none}
.pmr-warning{margin:8px 16px 0;padding:9px 12px;border:1px solid color-mix(in srgb,var(--ko) 35%,var(--border));border-radius:10px;background:color-mix(in srgb,var(--ko-soft) 12%,var(--surface));color:var(--ko);font-size:12px}
.pmr-workspace{display:flex;flex:1;flex-direction:column;min-height:0}
.pmr-canvas{position:relative;flex:1;min-height:260px;overflow:hidden;touch-action:none;background-image:radial-gradient(color-mix(in srgb,var(--muted) 30%,transparent) .7px,transparent .7px);background-size:22px 22px}.pmr-canvas svg{width:100%;height:100%;display:block;position:absolute;inset:0;user-select:none}
.pmr-edge{fill:none;stroke:var(--muted);stroke-width:1.2;opacity:.35}.pmr-edge.is-neighbour{stroke:var(--accent);opacity:.85;stroke-width:1.8}.pmr-edge.is-dim{opacity:.08}
.pmr-node{cursor:pointer;outline:none}.pmr-node circle{stroke:var(--bg);stroke-width:3;transition:r .2s}.pmr-node.is-selected circle,.pmr-node:focus circle{stroke:var(--ink);stroke-width:2.5}.pmr-node.is-dim{opacity:.18}
.pmr-node text{fill:var(--ink);font-size:12px;paint-order:stroke;stroke:var(--bg);stroke-width:3px;stroke-linejoin:round}.pmr-node text.pmr-strong{font-family:var(--editorial);font-size:15px;font-weight:500}.pmr-node .pmr-value{font-size:11px;fill:var(--muted)}
.pmr-node.is-uncertain circle{stroke:var(--warn-soft);stroke-dasharray:3 3}.pmr-node.is-missing circle{fill:transparent;stroke:var(--ko-soft);stroke-width:2.5;stroke-dasharray:4 3}
.pmr-tools{position:absolute;bottom:12px;right:12px;display:flex;gap:4px;padding:3px;border:1px solid var(--glass-border);border-radius:9999px;background:var(--glass-bg);box-shadow:var(--glass-shadow);backdrop-filter:blur(20px)}
.pmr-tools button{min-width:1.75rem;border:0;box-shadow:none;background:transparent;backdrop-filter:none;padding:0 8px}
.pmr-legend{position:absolute;left:14px;bottom:14px;color:var(--muted);font-size:11px;display:flex;gap:10px;flex-wrap:wrap;max-width:calc(100% - 170px);pointer-events:none}.pmr-legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}
.pmr-empty{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;padding:28px;text-align:center;color:var(--muted);background:var(--bg)}
.pmr-empty strong{font-family:var(--editorial);font-size:1.35rem;font-weight:500;color:var(--ink)}.pmr-empty p{max-width:340px;margin:0;font-size:13px;line-height:1.6}
.pmr-inspector{display:flex;flex-direction:column;flex:0 0 auto;max-height:52%;min-height:150px;border-top:1px solid var(--border);background:var(--bg)}
.pmr-tabs{display:flex;align-self:flex-start;gap:3px;margin:12px 16px 0;padding:3px;border:1px solid var(--glass-border);border-radius:9999px;background:var(--glass-bg);box-shadow:var(--glass-shadow);backdrop-filter:blur(20px)}
.pmr-tabs button{height:1.6rem;border:0;box-shadow:none;background:transparent;backdrop-filter:none;color:var(--muted)}
.pmr-tabs button[aria-selected=true]{color:var(--ink);font-weight:600;box-shadow:inset 0 0 0 1px rgb(var(--piecemaker-ink-rgb,17 24 39) / 22%)}
.pmr-tabs .pmr-count{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:color-mix(in srgb,var(--ko-soft) 40%,transparent);color:var(--ko);font-size:10px;font-weight:600;line-height:18px}
.pmr-detail{flex:1;min-height:0;overflow:auto;padding:14px 16px 18px;font-size:13px;line-height:1.6}
.pmr-detail h3{margin:2px 0 8px;font-family:var(--editorial);font-size:1.05rem;font-weight:500;letter-spacing:-.02em;line-height:1.3;color:var(--ink)}
.pmr-detail h4{margin:16px 0 6px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}.pmr-detail p{margin:6px 0}
.pmr-detail blockquote{margin:6px 0 0;padding:8px 12px;border-left:2px solid color-mix(in srgb,var(--accent) 60%,transparent);border-radius:0 8px 8px 0;background:var(--soft);white-space:pre-wrap;font-family:var(--editorial);font-size:14px;line-height:1.5}
.pmr-muted{color:var(--muted)}.pmr-warn{color:var(--warn)}
.pmr-pill{display:inline-flex;align-items:center;border:1px solid transparent;border-radius:999px;padding:1px 9px;font-size:11px;font-weight:500;line-height:18px;white-space:nowrap}
.pmr-ok{color:var(--ok)}.pmr-ko{color:var(--ko)}
.pmr-pill.pmr-ok{border-color:color-mix(in srgb,var(--ok-soft) 60%,transparent);background:color-mix(in srgb,var(--ok-soft) 22%,var(--surface))}
.pmr-pill.pmr-ko{border-color:color-mix(in srgb,var(--ko-soft) 60%,transparent);background:color-mix(in srgb,var(--ko-soft) 22%,var(--surface))}
.pmr-pill.pmr-warn{border-color:color-mix(in srgb,var(--warn-soft) 70%,transparent);background:color-mix(in srgb,var(--warn-soft) 25%,var(--surface))}
.pmr-pill.pmr-muted{border-color:var(--border);background:var(--soft)}
.pmr-detail .pmr-link{height:auto;border:0;box-shadow:none;background:none;backdrop-filter:none;padding:0 2px;color:var(--accent);font-weight:500;text-decoration:underline;text-underline-offset:2px;white-space:normal;text-align:left;display:inline;line-height:inherit;font-size:inherit}
.pmr-quote{margin:10px 0;padding:10px 12px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}.pmr-quote p{margin:0}
.pmr-problems{margin:10px 0;padding:8px 12px;border:1px solid color-mix(in srgb,var(--warn-soft) 70%,transparent);border-radius:10px;background:color-mix(in srgb,var(--warn-soft) 14%,var(--surface))}.pmr-problems ul{margin:2px 0 0;padding-left:16px}
.pmr-decision{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:12px}
.pmr-form{display:grid;gap:10px;margin-top:10px}.pmr-form label{display:grid;gap:4px;font-size:12px;color:var(--muted)}.pmr-form textarea{min-height:60px;resize:vertical}
.pmr-run{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.pmr-tally{display:flex;gap:6px;margin-left:auto}
.pmr-log{position:relative;list-style:none;margin:0;padding:0 0 0 22px}
.pmr-log:before{content:'';position:absolute;left:7px;top:8px;bottom:8px;width:1px;background:var(--border)}
.pmr-entry{position:relative;padding:6px 0 8px}
.pmr-entry.is-new{animation:pmr-in .35s cubic-bezier(.2,.7,.2,1) both}
.pmr-entry.is-updated .pmr-mark{animation:pmr-pop .35s ease}
.pmr-mark{position:absolute;left:-22px;top:8px;display:flex;width:15px;height:15px;align-items:center;justify-content:center;border-radius:50%;background:var(--bg);box-shadow:0 0 0 3px var(--bg);font-size:9px;font-weight:700;line-height:1}
.pmr-entry[data-status=ok] .pmr-mark{background:var(--ok-soft);color:#fff}
.pmr-entry[data-status=alerte] .pmr-mark{background:var(--ko-soft);color:#fff}
.pmr-entry[data-status=neutre] .pmr-mark{border:1.5px solid var(--muted);transform:scale(.7)}
.pmr-entry[data-status="en cours"] .pmr-mark{border:2px solid color-mix(in srgb,var(--accent) 25%,transparent);border-top-color:var(--accent);animation:pmr-spin .8s linear infinite}
.pmr-entry-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.pmr-step{color:var(--muted);font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.pmr-entry strong{color:var(--ink);font-weight:600;overflow-wrap:anywhere}
.pmr-entry-text{color:var(--text);font-size:12.5px}
.pmr-entry[data-status=alerte] .pmr-entry-text{color:var(--ko)}
.pmr-entry[data-status="en cours"] .pmr-entry-text{color:var(--muted)}
.pmr-part{margin-top:16px}.pmr-part:first-of-type{margin-top:4px}.pmr-part h4{margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--ink)}
.pmr-goal{margin:0 0 6px;padding:12px 14px;border:1px solid var(--border);border-radius:14px;background:var(--surface)}.pmr-goal h4{margin:0 0 2px}.pmr-goal ul{margin:6px 0;padding-left:18px}.pmr-goal li{margin:3px 0}
.pmr-question{font-weight:600;font-size:13px;line-height:1.4;color:var(--ink)}
.pmr-lead{margin:0 0 8px!important;color:var(--muted);font-size:12px}
.pmr-use{margin:2px 0 0!important;color:var(--muted);font-size:12px}
.pmr-card{margin:10px 0;padding:10px 12px 4px;border:1px solid var(--border);border-radius:12px;background:var(--surface)}.pmr-card header{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px}.pmr-card header .pmr-link{min-width:0;font-weight:600;text-decoration:none;color:var(--ink)}
.pmr-entry[data-step=conclusion]:last-child{margin-top:2px;border-top:1px dashed var(--border)}
.pmr-verdict{margin:10px 0 0!important;font-size:13px}
.pmr-fix{display:inline-flex;align-items:baseline;gap:5px;padding:1px 9px;border:1px dashed currentColor;border-radius:999px;background:transparent;color:var(--text);font:inherit;font-size:12.5px;cursor:pointer;white-space:normal;text-align:left;height:auto}.pmr-fix span{opacity:.6;font-size:11px}.pmr-fix:hover{background:var(--soft)}
.pmr-entry[data-status=alerte] .pmr-fix{color:var(--ko)}
.pmr-entry[data-step=réponse]{margin-top:6px;padding:12px 14px;border:1px solid var(--border);border-radius:14px;background:var(--surface);box-shadow:var(--glass-shadow)}
.pmr-entry[data-step=réponse] .pmr-mark{top:15px;left:-22px}
.pmr-entry[data-step=réponse] .pmr-fix,.pmr-entry[data-step=réponse] .pmr-entry-text{display:block;margin-top:2px;font-weight:600;font-size:13px;color:var(--ink)}
.pmr-entry[data-step=réponse][data-status=ok]{border-color:color-mix(in srgb,var(--ok-soft) 70%,transparent)}
.pmr-entry[data-step=réponse][data-status=alerte]{border-color:color-mix(in srgb,var(--ko-soft) 70%,transparent)}
.pmr-edge.is-sauf{stroke-dasharray:5 4}.pmr-edge-label{fill:var(--muted);font-size:10px;paint-order:stroke;stroke:var(--bg);stroke-width:3px}
.pmr-node.is-decisive circle{stroke:var(--accent);stroke-width:3}
.pmr-code{margin:0;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--soft);font:12px/1.5 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}
.pmr-issue{display:flex;gap:8px;align-items:baseline;justify-content:space-between;margin:6px 0;padding:6px 10px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}.pmr-issue span{flex:1;overflow-wrap:anywhere}.pmr-issue code{font:11px var(--mono);color:var(--muted)}
@keyframes pmr-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes pmr-pop{0%{transform:scale(.4)}70%{transform:scale(1.25)}100%{transform:scale(1)}}
@keyframes pmr-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.pmr-entry.is-new,.pmr-entry.is-updated .pmr-mark{animation:none}.pmr-entry[data-status="en cours"] .pmr-mark{animation-duration:2.4s}}
@container (min-width:880px){.pmr-workspace{flex-direction:row}.pmr-canvas{min-width:0;min-height:0}.pmr-inspector{flex:0 0 38%;width:38%;max-height:none;min-height:0;height:100%;border-top:0;border-left:1px solid var(--border)}}
`;
