export const STYLES = `
.pmr{
  height:100%;display:flex;flex-direction:column;min-height:0;container-type:inline-size;overflow-wrap:anywhere;
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
.pmr-head select{min-width:0;max-width:100%;flex:1 1 190px;font-size:12px;border-radius:9999px;padding:4px 10px}
.pmr-warning{margin:8px 16px 0;padding:9px 12px;border:1px solid color-mix(in srgb,var(--ko) 35%,var(--border));border-radius:10px;background:color-mix(in srgb,var(--ko-soft) 12%,var(--surface));color:var(--ko);font-size:12px}
.pmr-workspace{display:flex;flex:1;flex-direction:column;min-height:0}
.pmr-canvas{position:relative;flex:1;min-height:260px;overflow:hidden;touch-action:none;background-image:radial-gradient(color-mix(in srgb,var(--muted) 30%,transparent) .7px,transparent .7px);background-size:22px 22px}
.pmr-stage{position:absolute;left:0;top:0;transform-origin:0 0;user-select:none}
.pmr-wires{position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none}
.pmr-wire{fill:none;stroke-width:1.6;opacity:.75;transition:opacity .15s}.pmr-wire.is-sauf{stroke-dasharray:6 4}.pmr-wire.is-lit{opacity:1;stroke-width:2.2}.pmr-wire.is-dim,.pmr-wire-label.is-dim{opacity:.12}
.pmr-wire-label{fill:var(--muted);font-size:10px;font-style:italic;paint-order:stroke;stroke:var(--bg);stroke-width:3px}
.pmr-box{--kind:#8c96ad;position:absolute;display:flex;gap:10px;align-items:flex-start;width:max-content;max-width:280px;min-width:170px;padding:10px 12px;border:1.5px solid color-mix(in srgb,var(--kind) 70%,transparent);border-radius:14px;background:color-mix(in srgb,var(--kind) 8%,var(--surface));box-shadow:0 1px 3px rgb(15 23 42 / .08);cursor:pointer;outline:none;transition:opacity .15s,box-shadow .15s}
.pmr-box:hover{box-shadow:0 2px 10px rgb(15 23 42 / .14)}.pmr-box:focus-visible,.pmr-box.is-selected{box-shadow:0 0 0 3px color-mix(in srgb,var(--kind) 35%,transparent)}.pmr-box.is-dim{opacity:.22}
.pmr-box.is-uncertain{border-style:dashed}.pmr-box.is-excluded{opacity:.7}.pmr-box.is-excluded strong{text-decoration:line-through;text-decoration-color:var(--ko-soft)}
.pmr-question{--kind:#d9779f;max-width:420px}.pmr-terme{--kind:#3b82f6}.pmr-controle{--kind:#d99a2b}.pmr-fait{--kind:#2f9e7c}.pmr-conclusion{--kind:#14a3a0;max-width:300px}
.pmr-icon{flex:0 0 26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:8px;background:color-mix(in srgb,var(--kind) 18%,transparent);color:var(--kind);font-size:14px}
.pmr-box-body{min-width:0;display:flex;flex-direction:column;gap:3px}
.pmr-kind{font-size:9.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--kind)}
.pmr-box strong{color:var(--ink);font-weight:600;font-size:12.5px;line-height:1.35}.pmr-box .pmr-editorial{font-family:var(--editorial);font-size:15px;font-weight:500}
.pmr-sub{margin:0;color:var(--muted);font-size:11px;line-height:1.4}
.pmr-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:2px}
.pmr .pmr-chip{height:auto;padding:1px 7px;border-radius:6px;border:1px solid transparent;box-shadow:none;backdrop-filter:none;font-size:10.5px;font-weight:500;line-height:16px;white-space:nowrap}
.pmr .pmr-chip.is-source{color:#6a5bd6;background:color-mix(in srgb,#7c6ee6 13%,var(--surface));border-color:color-mix(in srgb,#7c6ee6 35%,transparent)}
.pmr .pmr-chip.is-piece{color:var(--text);background:color-mix(in srgb,#8c96ad 14%,var(--surface));border-color:color-mix(in srgb,#8c96ad 40%,transparent)}
.pmr .pmr-chip.is-against{color:var(--ko);border-color:color-mix(in srgb,var(--ko-soft) 70%,transparent);border-style:dashed}
.pmr[data-theme=dark] .pmr-chip.is-source{color:#b7aefa}
.pmr-terme,.pmr-controle{max-width:400px;min-width:260px}.pmr-fait.is-ko{--kind:#c45b5b}.pmr-fait.is-warn{--kind:#d99a2b;border-style:dashed}.pmr-fait.is-ok{border-width:2px}
.pmr-then{display:block;margin-top:2px;padding-top:6px;border-top:1px solid color-mix(in srgb,var(--kind) 25%,transparent)}.pmr-then:before{content:'⇒ ';color:var(--kind)}
.pmr-law{display:flex;flex-direction:column;gap:6px;margin-top:4px}
.pmr-rule{display:flex;flex-direction:column;align-items:flex-start;gap:4px}.pmr-rule+.pmr-rule{margin-top:6px}.pmr-rule .pmr-chip{font-size:11.5px;font-weight:600;white-space:normal;text-align:left}
.pmr-clauses{display:flex;gap:6px;align-self:stretch}.pmr-clause{flex:1 1 0;min-width:150px;display:flex;flex-direction:column;gap:4px;padding:6px 8px;border:1px solid color-mix(in srgb,var(--kind) 30%,transparent);border-radius:9px;background:var(--surface)}.pmr-needs{font-size:11px;font-weight:600;color:var(--muted)}.pmr-needs:before{content:'→ '}.pmr-box:has(.pmr-clause+.pmr-clause){max-width:620px}.pmr-ruled{display:block;font-size:13.5px}.pmr-foot+.pmr-rule{margin-top:8px}.pmr-box:has(.pmr-clauses){padding-bottom:0}.pmr-rule:last-child .pmr-clause{border-bottom:0;border-radius:9px 9px 0 0;padding-bottom:9px}
.pmr-rule q{color:var(--text);font-family:var(--editorial);font-size:13px;line-height:1.4}
.pmr-conds{list-style:none;margin:2px 0 0;padding:0;display:flex;flex-direction:column;gap:2px;width:100%}
.pmr-conds ul{list-style:none;margin:2px 0 0;padding:0 0 0 4px;display:flex;flex-direction:column;gap:2px}
.pmr-conds li{display:flex;align-items:flex-start;gap:5px;font-size:11.5px;line-height:1.4;color:var(--text)}
.pmr-conds .pmr-link{padding:0;height:auto;border:0;background:none;box-shadow:none;color:inherit;font:inherit;text-align:left;cursor:pointer}.pmr-conds .pmr-link:hover{text-decoration:underline}
.pmr-met{flex:none;width:15px;height:15px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:700;color:var(--surface);margin-top:1px}
.pmr-conds .is-ok>.pmr-met{background:var(--ok)}.pmr-conds .is-ko>.pmr-met{background:var(--ko)}.pmr-conds .is-warn>.pmr-met{background:transparent;color:var(--warn);border:1px dashed var(--warn)}
.pmr-conds .pmr-pill{font-size:9.5px;line-height:14px;padding:0 6px}
.pmr-foot{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px}.pmr-foot .pmr-pill{font-size:10px;line-height:15px;padding:0 7px}
.pmr-pill.pmr-accent{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 40%,transparent)}
.pmr-test{position:absolute;top:-8px;right:-8px;width:18px;height:18px;display:flex;align-items:center;justify-content:center;border-radius:50%;font-size:10px;font-weight:700;color:#fff;box-shadow:0 0 0 2px var(--bg)}.pmr-test.is-ok{background:#4e9a6a}.pmr-test.is-alerte{background:#c45b5b}
.pmr-box.pmr-ou{min-width:0;padding:3px 10px;border-radius:999px;border:1px dashed var(--muted);background:var(--surface);color:var(--muted);font-size:10.5px;font-style:italic;cursor:default}
.pmr-tools{position:absolute;bottom:12px;right:12px;display:flex;gap:4px;padding:3px;border:1px solid var(--glass-border);border-radius:9999px;background:var(--glass-bg);box-shadow:var(--glass-shadow);backdrop-filter:blur(20px)}
.pmr-tools button{min-width:1.75rem;border:0;box-shadow:none;background:transparent;backdrop-filter:none;padding:0 8px}
.pmr-legend{position:absolute;bottom:52px;right:12px;max-width:min(260px,calc(100% - 24px));padding:10px 12px;border:1px solid var(--glass-border);border-radius:14px;background:var(--glass-bg);box-shadow:var(--glass-shadow);backdrop-filter:blur(20px);color:var(--muted);font-size:10.5px;display:flex;gap:6px 12px;flex-wrap:wrap}.pmr-legend[hidden],.pmr-head[hidden]{display:none}.pmr-tools [aria-pressed=true]{color:var(--ink);font-weight:600}.pmr-legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:5px}.pmr-legend i.is-dashed{background:transparent;border:1px dashed var(--warn)}.pmr-legend span{display:inline-flex;align-items:center}.pmr-legend i{border-radius:3px}.pmr-legend i.is-sauf{width:16px;height:0;border-radius:0;border-top:1.5px dashed var(--muted)}.pmr-legend .pmr-chip{font-size:10px}
.pmr-empty{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:12px;padding:28px;text-align:center;color:var(--muted);background:var(--bg)}
.pmr-empty strong{font-family:var(--editorial);font-size:1.35rem;font-weight:500;color:var(--ink)}.pmr-empty p{max-width:340px;margin:0;font-size:13px;line-height:1.6}
.pmr-split{flex:0 0 7px;cursor:row-resize;touch-action:none;background:linear-gradient(var(--border),var(--border)) center/100% 1px no-repeat}.pmr-split:hover,.pmr-split:focus-visible,.pmr-split.is-dragging{outline:none;background:linear-gradient(#7aa7d8,#7aa7d8) center/100% 3px no-repeat}.pmr-inspector{display:flex;flex-direction:column;flex:0 0 50%;width:50%;min-width:220px;min-height:0;background:var(--bg)}
.pmr-tabs{display:flex;align-self:flex-start;gap:3px;margin:12px 16px 0;max-width:calc(100% - 32px);overflow-x:auto;scrollbar-width:none;padding:3px;border:1px solid var(--glass-border);border-radius:9999px;background:var(--glass-bg);box-shadow:var(--glass-shadow);backdrop-filter:blur(20px)}
.pmr-tabs button{height:1.6rem;border:0;box-shadow:none;background:transparent;backdrop-filter:none;color:var(--muted)}
.pmr-tabs button[aria-selected=true]{color:var(--ink);font-weight:600;box-shadow:inset 0 0 0 1px rgb(var(--piecemaker-ink-rgb,17 24 39) / 22%)}
.pmr-tabs .pmr-count{min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:color-mix(in srgb,var(--ko-soft) 40%,transparent);color:var(--ko);font-size:10px;font-weight:600;line-height:18px}
.pmr-detail{flex:1;min-height:0;overflow:auto;padding:14px 16px 18px;font-size:13px;line-height:1.6}
.pmr-detail h4{margin:16px 0 6px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}.pmr-detail p{margin:6px 0}
.pmr-muted{color:var(--muted)}.pmr-warn{color:var(--warn)}
.pmr-pill{display:inline-flex;align-items:center;border:1px solid transparent;border-radius:999px;padding:1px 9px;font-size:11px;font-weight:500;line-height:18px;max-width:100%}
.pmr-ok{color:var(--ok)}.pmr-ko{color:var(--ko)}
.pmr-pill.pmr-ok{border-color:color-mix(in srgb,var(--ok-soft) 60%,transparent);background:color-mix(in srgb,var(--ok-soft) 22%,var(--surface))}
.pmr-pill.pmr-ko{border-color:color-mix(in srgb,var(--ko-soft) 60%,transparent);background:color-mix(in srgb,var(--ko-soft) 22%,var(--surface))}
.pmr-pill.pmr-warn{border-color:color-mix(in srgb,var(--warn-soft) 70%,transparent);background:color-mix(in srgb,var(--warn-soft) 25%,var(--surface))}
.pmr-pill.pmr-muted{border-color:var(--border);background:var(--soft)}
.pmr-detail .pmr-link{height:auto;border:0;box-shadow:none;background:none;backdrop-filter:none;padding:0 2px;color:var(--accent);font-weight:500;text-decoration:underline;text-underline-offset:2px;white-space:normal;text-align:left;display:inline;line-height:inherit;font-size:inherit}
.pmr-decision{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:12px}
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
.pmr-lead{margin:0 0 8px!important;color:var(--muted);font-size:12px}
.pmr-entry[data-step=réponse]{margin-top:6px;padding:12px 14px;border:1px solid var(--border);border-radius:14px;background:var(--surface);box-shadow:var(--glass-shadow)}
.pmr-entry[data-step=réponse] .pmr-mark{top:15px;left:-22px}
.pmr-entry[data-step=réponse] .pmr-entry-text{display:block;margin-top:2px;font-weight:600;font-size:13px;color:var(--ink)}
.pmr-entry[data-step=réponse][data-status=ok]{border-color:color-mix(in srgb,var(--ok-soft) 70%,transparent)}
.pmr-entry[data-step=réponse][data-status=alerte]{border-color:color-mix(in srgb,var(--ko-soft) 70%,transparent)}
.pmr-issue{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start;margin:6px 0;padding:8px 10px;border:1px solid var(--border);border-radius:10px;background:var(--surface)}.pmr-issue-body{flex:1;min-width:180px;overflow-wrap:anywhere}.pmr-issue-body p{margin:0 0 4px;line-height:1.45}.pmr-issue details summary{cursor:pointer;font-size:11px;color:var(--muted)}.pmr-issue code{font:11px var(--mono);color:var(--muted)}
@container (max-width:380px){.pmr-tabs{gap:1px}.pmr-tabs button{padding:0 .4rem}}
.pmr-stage.is-following{transition:transform .45s cubic-bezier(.2,.7,.2,1)}
.pmr-box.is-waiting{opacity:.06;filter:grayscale(1);pointer-events:none}.pmr-wire.is-waiting,.pmr-wire-label.is-waiting{opacity:.04}
.pmr-box{transition:opacity .35s,filter .35s}.pmr-box.is-arriving{animation:pmr-arrive .55s cubic-bezier(.2,.7,.2,1) both;box-shadow:0 0 0 4px color-mix(in srgb,var(--kind) 30%,transparent)}
.pmr-verdict{margin-top:8px;padding-top:7px;border-top:1px solid color-mix(in srgb,var(--kind) 30%,transparent);display:flex;flex-direction:column;align-items:flex-start;gap:4px}.pmr-verdict p{margin:0;font-size:12px}
.pmr-note{position:absolute;width:360px;max-height:460px;overflow:auto;overscroll-behavior:contain;padding:10px 12px;border:1px solid var(--glass-border);border-radius:12px;background:var(--surface);box-shadow:var(--glass-shadow);font-size:12px;user-select:text;cursor:auto;animation:pmr-in .25s both;z-index:20}
.pmr-note ul{list-style:none;margin:6px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}.pmr-note li{display:flex;gap:7px;align-items:flex-start;line-height:1.4}.pmr-note li .pmr-pill{flex:none}.pmr-note p{margin:2px 0 0}.pmr-note .pmr-decision{margin-top:6px}.pmr-note .pmr-issue{display:block;padding:6px 8px}.pmr-note .pmr-issue-body{margin-top:4px}.pmr-note .pmr-link{height:auto;padding:0;border:0;box-shadow:none;background:none;color:var(--accent);font:inherit;font-weight:500;white-space:normal;text-align:left;cursor:pointer;text-decoration:underline;text-underline-offset:2px}
.pmr-note .pmr-mark{flex:none;width:16px;height:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff;background:#4e9a6a}.pmr-note li[data-status=alerte] .pmr-mark{background:#c45b5b}.pmr-note li[data-status=neutre] .pmr-mark{background:var(--border)}
.pmr-tools .pmr-primary{padding:0 12px}.pmr-tools .pmr-primary:disabled{opacity:.6}
@keyframes pmr-arrive{from{opacity:0;transform:translateY(-10px) scale(.92)}to{opacity:1;transform:none}}
@keyframes pmr-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes pmr-pop{0%{transform:scale(.4)}70%{transform:scale(1.25)}100%{transform:scale(1)}}
@keyframes pmr-spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.pmr-box.is-arriving,.pmr-stage.is-following{animation:none;transition:none}.pmr-entry.is-new,.pmr-entry.is-updated .pmr-mark{animation:none}.pmr-entry[data-status="en cours"] .pmr-mark{animation-duration:2.4s}}
@container (min-width:880px){.pmr-workspace{flex-direction:row}.pmr-canvas{min-width:0;min-height:0}.pmr-split{cursor:col-resize;background:linear-gradient(var(--border),var(--border)) center/1px 100% no-repeat}.pmr-split:hover,.pmr-split:focus-visible,.pmr-split.is-dragging{background:linear-gradient(#7aa7d8,#7aa7d8) center/3px 100% no-repeat}.pmr-inspector{height:100%}.pmr-tabs{display:none}}
@container (max-width:879.98px){.pmr-split{display:none}.pmr-inspector{flex:1 1 auto!important;order:-1;width:auto;min-width:0}.pmr[data-view=test] .pmr-canvas{display:none}.pmr[data-view=graph] .pmr-detail{display:none}.pmr[data-view=graph] .pmr-inspector{flex:0 0 auto!important;padding-bottom:8px}}
`;
