export const STYLES = `
.pmc{
  height:100%;display:flex;flex-direction:column;min-height:0;container-type:inline-size;overflow-wrap:anywhere;
  background:hsl(var(--background));color:var(--piecemaker-text,#374151);
  font:13px/1.5 var(--piecemaker-font-ui,Inter,ui-sans-serif,system-ui,sans-serif);
  --bg:hsl(var(--background));--surface:hsl(var(--card));--soft:hsl(var(--muted));
  --border:var(--piecemaker-border,#e5e7eb);--text:var(--piecemaker-text,#374151);--muted:var(--piecemaker-muted,#6b7280);--ink:var(--piecemaker-ink,#111827);
  --accent:var(--piecemaker-blue,rgb(0 136 255));--ok:#4e7a5c;--ok-soft:#a8d5b5;--ko:#9f3b3b;--ko-soft:#efb4b4;--warn:#9a7420;--warn-soft:#f2d79c;
  --glass-bg:var(--liquid-glass-background-subtle,rgb(255 255 255 / .78));--glass-border:var(--liquid-glass-border-subtle,rgb(229 231 235 / .9));
  --glass-shadow:var(--liquid-glass-shadow-subtle,inset 0 1px 0 rgb(255 255 255 / .8),0 1px 2px rgb(15 23 42 / .05));
  --editorial:var(--piecemaker-font-editorial,EB Garamond,Georgia,serif);--mono:ui-monospace,SFMono-Regular,Menlo,monospace
}
.pmc[data-theme=dark]{
  --border:hsl(var(--border));--text:hsl(var(--foreground));--muted:hsl(var(--muted-foreground));--ink:hsl(var(--foreground));
  --ok:#b7dcc2;--ok-soft:#7fae8d;--ko:#f0c4c4;--ko-soft:#c98a8a;--warn:#ecd29a;--warn-soft:#b8995a;
  --glass-bg:var(--liquid-glass-background-subtle,rgb(24 28 36 / .72));--glass-border:var(--liquid-glass-border-subtle,rgb(255 255 255 / .08));
  --glass-shadow:var(--liquid-glass-shadow-subtle,inset 0 1px 0 rgb(255 255 255 / .06),0 1px 2px rgb(0 0 0 / .35))
}
.pmc *{box-sizing:border-box}.pmc [hidden]{display:none!important}
.pmc button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:1.75rem;padding:0 .75rem;border:1px solid var(--glass-border);border-radius:9999px;background:var(--glass-bg);box-shadow:var(--glass-shadow);color:var(--text);font:500 12px var(--piecemaker-font-ui,inherit);cursor:pointer;white-space:nowrap;backdrop-filter:blur(20px);transition:filter .15s ease,transform .15s ease}
.pmc button:hover{filter:brightness(.97)}.pmc button:active{transform:scale(.98)}.pmc button:disabled{cursor:default;opacity:.45}
.pmc button:focus-visible,.pmc select:focus-visible,.pmc input:focus-visible,.pmc textarea:focus-visible{outline:none;box-shadow:0 0 0 2px rgb(0 136 255 / 40%),0 0 0 4px var(--bg)}
.pmc .pmc-primary{background:rgb(3 7 18 / 88%);border-color:transparent;color:#fff;box-shadow:none;backdrop-filter:none}
.pmc[data-theme=dark] .pmc-primary{background:rgb(255 255 255 / 92%);color:#0b0f17}
.pmc-warning{margin:8px 16px 0;padding:9px 12px;border:1px solid color-mix(in srgb,var(--ko) 35%,var(--border));border-radius:10px;background:color-mix(in srgb,var(--ko-soft) 12%,var(--surface));color:var(--ko);font-size:12px}
.pmc-detail{flex:1;min-height:0;overflow:auto;padding:16px 18px 22px;font-size:13px;line-height:1.6}
.pmc-detail h4{margin:16px 0 6px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.pmc-detail p{margin:6px 0}
.pmc-muted{color:var(--muted)}.pmc-warn{color:var(--warn)}
.pmc-pill{display:inline-flex;align-items:center;border:1px solid transparent;border-radius:999px;padding:1px 9px;font-size:11px;font-weight:500;line-height:18px;max-width:100%}
.pmc-ok{color:var(--ok)}.pmc-ko{color:var(--ko)}
.pmc-pill.pmc-ok{border-color:color-mix(in srgb,var(--ok-soft) 60%,transparent);background:color-mix(in srgb,var(--ok-soft) 22%,var(--surface))}
.pmc-pill.pmc-ko{border-color:color-mix(in srgb,var(--ko-soft) 60%,transparent);background:color-mix(in srgb,var(--ko-soft) 22%,var(--surface))}
.pmc-pill.pmc-warn{border-color:color-mix(in srgb,var(--warn-soft) 70%,transparent);background:color-mix(in srgb,var(--warn-soft) 25%,var(--surface))}
.pmc-pill.pmc-muted{border-color:var(--border);background:var(--soft)}
.pmc-run{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.pmc-tally{display:flex;gap:6px;margin-left:auto}
.pmc-analysed{color:var(--muted);font-size:12px}
.pmc-view-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:2px 0 12px}
.pmc-view-head select{min-width:150px;max-width:100%;border:1px solid var(--border);border-radius:999px;padding:5px 10px;background:var(--surface);color:var(--text);font:inherit}
.pmc-scenario{color:var(--muted);font-size:12.5px}.pmc-scenario strong{color:var(--ink);font-weight:600}
.pmc-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--glass-border);border-radius:999px;background:var(--glass-bg);box-shadow:var(--glass-shadow)}
.pmc-tabs button{border:0;box-shadow:none;background:none;color:var(--muted)}.pmc-tabs button[aria-selected=true]{color:var(--ink);box-shadow:inset 0 0 0 1px var(--border)}
.pmc-open-states{margin:0 0 12px;padding:8px 12px;border:1px solid color-mix(in srgb,var(--warn-soft) 70%,var(--border));border-radius:12px;font-size:12.5px;background:color-mix(in srgb,var(--warn-soft) 8%,var(--surface))}.pmc-open-states summary{cursor:pointer;font-weight:600}.pmc-open-states ul{margin:6px 0 0;padding-left:20px}
.pmc-written{display:flex;flex-direction:column;gap:14px}
.pmc-rule{--kind:#3b82f6;padding:14px 16px;border:1px solid var(--border);border-left:3px solid var(--kind);border-radius:12px;background:var(--surface);scroll-margin-top:12px;transition:box-shadow .3s}
.pmc-rule[data-kind=answer]{border-left-width:5px;box-shadow:0 1px 2px rgb(15 23 42 / .04)}
.pmc-rule[data-tone=ok]{--kind:var(--ok-soft)}.pmc-rule[data-tone=ko]{--kind:var(--ko-soft)}.pmc-rule[data-tone=warn]{--kind:var(--warn-soft)}.pmc-rule.is-focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent)}
.pmc-rule header{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}.pmc-rule h3{flex:1;min-width:12em;margin:0;color:var(--ink);font:600 17px/1.35 var(--editorial)}
.pmc-rule h4{margin:14px 0 4px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.pmc-part{border-top:1px solid color-mix(in srgb,var(--border) 60%,transparent);margin-top:12px;padding-top:2px}
.pmc-part[data-part=rule]{border-top:0;margin-top:4px}
.pmc-kind{color:var(--muted);font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.pmc-value{display:inline-flex;align-items:center;border-radius:999px;padding:1px 10px;font-size:12px;font-weight:600;line-height:20px;border:1px solid var(--border);background:var(--soft);white-space:nowrap}
.pmc-value.pmc-ok{border-color:color-mix(in srgb,var(--ok-soft) 70%,transparent);background:color-mix(in srgb,var(--ok-soft) 25%,var(--surface))}.pmc-value.pmc-ko{border-color:color-mix(in srgb,var(--ko-soft) 70%,transparent);background:color-mix(in srgb,var(--ko-soft) 25%,var(--surface))}.pmc-value.pmc-warn{border-color:color-mix(in srgb,var(--warn-soft) 70%,transparent);background:color-mix(in srgb,var(--warn-soft) 25%,var(--surface))}
.pmc-projection{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:2px 0 0}
.pmc-projection .pmc-value{font-size:14px;line-height:26px;padding:1px 14px;font-weight:700}
.pmc-projection span{color:var(--text)}
.pmc-conditions,.pmc-justification,.pmc-conditions ul,.pmc-justification ul{margin:2px 0;padding-left:20px}
.pmc-conditions li,.pmc-justification li{margin:3px 0}
.pmc-conditions>li::marker{color:var(--muted)}
.pmc-op{display:inline-block;margin-right:4px;color:var(--muted);font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.pmc-formula{margin:4px 0 0!important;color:var(--ink)}
.pmc .pmc-reference,.pmc .pmc-text-action{display:inline;height:auto;max-width:100%;padding:0;border:0;border-radius:3px;background:none;box-shadow:none;backdrop-filter:none;color:var(--ink);font:inherit;text-align:left;white-space:normal;text-decoration:none;cursor:pointer}
.pmc .pmc-reference:hover,.pmc .pmc-text-action:hover{background:var(--soft);filter:none}
.pmc-sources{margin:2px 0 0;padding-left:18px}.pmc-sources li{margin:4px 0}
.pmc-sources q{display:block;margin:2px 0 4px;color:var(--text);font:italic 15px/1.5 var(--editorial)}
.pmc-code{display:inline-block;margin-left:6px;color:var(--muted);font-size:11px;font-weight:500;letter-spacing:.01em}
.pmc-chips{display:inline-flex;flex-wrap:wrap;gap:6px 12px;margin-left:8px;vertical-align:baseline}
.pmc-chip{align-self:flex-start;color:#6d5bd0;font-size:12px;font-weight:500;text-decoration:none;white-space:nowrap}.pmc-chip:hover{text-decoration:underline}.pmc-chip:before{content:'§ '}.pmc-chip[data-kind=piece]{color:#2f7d63}.pmc-chip[data-kind=piece]:before{content:'▤ '}.pmc-chip[data-citation=failed]{color:var(--ko)}
.pmc-justification .pmc-chips{margin-left:6px}
.pmc-explanation{position:relative;border:1px solid var(--border);border-radius:14px;overflow:hidden}
.pmc-map-scroll{max-height:72vh;min-height:360px;overflow:auto;padding:20px}
.pmc-map-summary{display:flex;gap:8px;flex-direction:column;color:var(--ink);font-weight:600;margin-bottom:20px}
.pmc-map-summary span{font-size:12px;font-weight:400;color:var(--muted)}
.pmc-map-tools{display:flex;gap:5px;justify-content:flex-end;padding:8px 12px;border-bottom:1px solid var(--border)}
.pmc-map-refs{display:flex;gap:5px;flex-wrap:wrap;margin-top:9px;min-width:0}
.pmc-map-refs .pmc-reference{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 7px;border:1px solid var(--border);border-radius:8px;font:500 12px var(--piecemaker-font-ui,Inter,system-ui,sans-serif);color:var(--ink);text-decoration:none;background:var(--soft)}
.pmc-map-refs .pmc-reference:before{content:'§ ';color:var(--muted)}
.pmc-map-refs .pmc-reference[data-kind=piece]:before{content:'▤ '}
.pmc-map-refs .pmc-reference[data-citation=failed]{color:var(--ko)}
.pmc-unused{margin:0 0 18px;color:var(--muted);font-size:12px}
.pmc-unused summary{cursor:pointer}.pmc-unused p{margin:5px 0}
.pmc-native{margin:10px 0;color:var(--muted);font-size:12px}.pmc-native summary{cursor:pointer}
.pmc-application{margin-top:10px}.pmc-application section+section{margin-top:10px;padding-top:8px;border-top:1px solid var(--border)}
.pmc-application h4{margin:0 0 4px;font:600 10px var(--piecemaker-font-ui,Inter,system-ui,sans-serif);color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
.pmc-application p,.pmc-application q{margin:3px 0;font-size:12px;line-height:1.45;color:var(--ink)}
.pmc-application q{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pmc-application .pmc-map-refs{margin-top:0}.pmc-application .pmc-warn{color:var(--warn);font-size:11px}
.pmc-scenario-value{display:block;font-size:11px;color:var(--muted)}
.pmc-conditions,.pmc-conditions ul{list-style:none;margin:0;padding:0}.pmc-condition-group>p{margin:12px 0 0;color:var(--muted);font-size:12px;font-weight:600}.pmc-condition-group .pmc-condition-group{padding-left:14px;border-left:2px solid var(--border)}
.pmc-map-summary b{display:inline-block;margin-right:12px;font-weight:600}.pmc-map-summary i{font-style:normal;margin-right:6px}
.pmc-map{--k:var(--muted);min-width:max-content;padding:4px 0 8px}
.pmc-graph{position:relative;display:flex;flex-direction:column;gap:64px;align-items:center;padding:8px 16px 16px}
.pmc-graph-edges{position:absolute;inset:0;pointer-events:none;overflow:visible}.pmc-graph-edges path{fill:none;stroke:var(--muted);stroke-width:1.5;opacity:.55;transition:opacity .15s,stroke .15s}.pmc-graph-edges marker path{fill:var(--muted);stroke:none}
.pmc-graph-edges g.is-on path{stroke:var(--accent);stroke-width:2.2;opacity:1}
.pmc-graph-row{position:relative;display:flex;flex-wrap:nowrap;gap:20px;justify-content:center}
.pmc .pmc-doc{--k:var(--muted);display:flex;flex-direction:column;align-items:flex-start;gap:4px;width:210px;height:auto;padding:10px 12px;border:1px solid var(--border);border-top:4px solid var(--k);border-radius:10px;background:var(--surface);color:var(--ink);text-align:left;cursor:pointer;transition:opacity .15s,box-shadow .15s}
.pmc .pmc-doc:hover,.pmc .pmc-doc:focus-visible{box-shadow:0 0 0 2px var(--accent)}
.pmc-doc[data-kind=article]{--k:#6d5bd0}.pmc-doc[data-kind=jurisprudence]{--k:#d99a2b}.pmc-doc[data-kind=piece]{--k:#2f9e7c}.pmc-doc[data-citation=failed]{border-color:var(--ko)}
.pmc-doc-kind{color:var(--k);font-size:10.5px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.pmc-doc strong{font-size:13.5px;line-height:1.35;font-weight:600}.pmc-doc .pmc-warn{font-size:11px}
.pmc-map-summary b[data-kind=article]{color:#6d5bd0}.pmc-map-summary b[data-kind=jurisprudence]{color:#d99a2b}.pmc-map-summary b[data-kind=piece]{color:#2f9e7c}
.pmc-graph-loose{margin-top:28px}.pmc-graph-loose>h3{margin:0 0 10px;font-size:13px;color:var(--muted)}.pmc-graph-loose .pmc-graph-row{flex-wrap:wrap;justify-content:flex-start}
.pmc-map .is-dim{opacity:.22}

.pmc-inspector{position:absolute;right:12px;top:12px;max-width:calc(100% - 24px);width:400px;max-height:calc(100% - 68px);overflow:auto;cursor:auto;border-radius:14px;box-shadow:0 8px 28px rgb(15 23 42 / .16);background:var(--surface)}
.pmc-inspector .pmc-rule{border-radius:0;border-left-width:3px;padding-top:30px}
.pmc-inspector .pmc-rule h3{font-size:16px}
.pmc .pmc-close{position:absolute;top:6px;right:6px;width:24px;height:24px;padding:0;z-index:1}
.pmc-others h3{font-size:15px}
`;
