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
.pmc-detail{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;font-size:13px;line-height:1.6}
.pmc-detail>p{margin:16px 18px}
.pmc-detail h4{margin:16px 0 6px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.pmc-detail p{margin:6px 0}
.pmc-muted{color:var(--muted)}.pmc-warn{color:var(--warn)}
.pmc-pill{display:inline-flex;align-items:center;border:1px solid transparent;border-radius:999px;padding:1px 9px;font-size:11px;font-weight:500;line-height:18px;max-width:100%}
.pmc-ok{color:var(--ok)}.pmc-ko{color:var(--ko)}
.pmc-pill.pmc-ok{border-color:color-mix(in srgb,var(--ok-soft) 60%,transparent);background:color-mix(in srgb,var(--ok-soft) 22%,var(--surface))}
.pmc-pill.pmc-ko{border-color:color-mix(in srgb,var(--ko-soft) 60%,transparent);background:color-mix(in srgb,var(--ko-soft) 22%,var(--surface))}
.pmc-pill.pmc-warn{border-color:color-mix(in srgb,var(--warn-soft) 70%,transparent);background:color-mix(in srgb,var(--warn-soft) 25%,var(--surface))}
.pmc-pill.pmc-muted{border-color:var(--border);background:var(--soft)}
.pmc-view{flex:1;min-height:0;display:flex;flex-direction:column}
.pmc-bar{flex:none;display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border);overflow-x:auto;scrollbar-width:none;white-space:nowrap}
.pmc-bar>*{flex:none}
.pmc-bar select{flex:0 1 auto;min-width:72px;max-width:200px;height:1.75rem;border:1px solid var(--border);border-radius:999px;padding:0 8px;background:var(--surface);color:var(--text);font:inherit;font-size:12px;text-overflow:ellipsis}
.pmc-run{display:flex;align-items:center;gap:8px;margin-left:auto}
.pmc-map-tools{display:flex;gap:4px}.pmc .pmc-map-tools button{width:1.75rem;padding:0}
.pmc .pmc-alerts{position:relative;flex:none;margin-right:6px}.pmc .pmc-alerts[data-count]{color:var(--ko)}.pmc-bubble{position:absolute;top:-6px;right:-8px;min-width:16px;padding:0 4px;border-radius:999px;background:#d93025;color:#fff;font-size:10px;font-weight:700;line-height:16px;text-align:center}
.pmc-alert-list{flex:none;max-height:40%;overflow:auto;margin:0 16px 8px;padding:8px 12px;border:1px solid color-mix(in srgb,var(--ko) 35%,var(--border));border-radius:12px;background:var(--surface);font-size:12.5px}.pmc-alert-list ul{margin:0;padding-left:18px}.pmc-alert-list li+li{margin-top:4px}.pmc-alert-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;margin-bottom:6px}.pmc-alert-actions>span{margin-right:auto}.pmc-alert-list p{margin:0}.pmc-draft-list .pmc-alert-actions{justify-content:flex-start;margin:6px 0 0}
.pmc-scenario{color:var(--muted);font-size:12.5px}.pmc-scenario strong{color:var(--ink);font-weight:600}
p.pmc-scenario{margin:0}
.pmc-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--glass-border);border-radius:999px;background:var(--glass-bg);box-shadow:var(--glass-shadow)}
.pmc-tabs button{border:0;box-shadow:none;background:none;color:var(--muted)}.pmc-tabs button[aria-selected=true]{color:var(--ink);box-shadow:inset 0 0 0 1px var(--border)}
.pmc-written{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:14px;padding:14px 16px 22px}.pmc-written>*{flex:none}
.pmc-thread{margin:0!important;color:var(--muted)}.pmc-serves{margin:4px 0 0!important;color:var(--muted);font-size:12.5px}
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
.pmc .pmc-reference:not(.pmc-chip),.pmc .pmc-text-action{text-decoration:underline;text-underline-offset:2px}
.pmc .pmc-reference:hover,.pmc .pmc-text-action:hover{background:var(--soft);filter:none}
.pmc-sources{margin:2px 0 0;padding-left:18px}.pmc-sources li{margin:4px 0}
.pmc-sources q{display:block;margin:2px 0 4px;color:var(--text);font:italic 15px/1.5 var(--editorial)}
.pmc-code{display:inline-block;margin-left:6px;color:var(--muted);font-size:11px;font-weight:500;letter-spacing:.01em}
.pmc-chips{display:inline-flex;flex-wrap:wrap;gap:6px 12px;margin-left:8px;vertical-align:baseline}
.pmc-chip{align-self:flex-start;color:#6d5bd0;font-size:12px;font-weight:500;text-decoration:none;white-space:nowrap}.pmc-chip:hover{text-decoration:underline}.pmc-chip:before{content:'§ '}.pmc-chip[data-kind=piece]{color:#2f7d63}.pmc-chip[data-kind=piece]:before{content:'▤ '}.pmc-chip[data-citation=failed]{color:var(--ko)}
.pmc-justification .pmc-chips{margin-left:6px}
.pmc-explanation{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}.pmc-explanation>p{margin:16px 18px}
.pmc-legend{display:flex;gap:6px 16px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--border);font-size:11.5px;color:var(--muted)}
.pmc-legend .pmc-ok,.pmc-legend .pmc-ko{font-weight:600}
.pmc-map-scroll{flex:1;min-height:0;overflow:auto;padding:12px 14px}
.pmc-program{flex:1;min-height:0;overflow:auto;padding:14px 16px 22px;line-height:1.5}.pmc-program-file h2,.pmc-program-file h3,.pmc-program-file h4{margin:18px 0 8px;color:var(--ink)}.pmc-program-file p{margin:0 0 8px}.pmc-program-graph{overflow-x:auto;margin:6px 0}.pmc-program-code{margin:4px 0 12px;font-size:12px}.pmc-program-code summary{cursor:pointer;color:var(--muted)}.pmc-program-code pre{overflow:auto;padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--soft)}
.pmc .pmc-program .pmc-branch>*{position:relative}
.pmc-map-summary{margin-bottom:12px}
.pmc-docs{list-style:none;margin:8px 0 0;padding:0;display:flex;flex-direction:column;gap:10px}.pmc-docs li{display:flex;flex-direction:column;gap:4px;padding-left:10px;border-left:2px solid var(--border)}.pmc-docs li[data-kind=piece]{border-left-color:#2f7d63}.pmc-docs q{display:block;font:italic 13.5px/1.5 var(--editorial);color:var(--ink)}.pmc-docs .pmc-reference{align-self:flex-start;text-align:left}
.pmc-calculation{color:var(--muted);font-size:12.5px}
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
.pmc-map{--ok-line:#2f8f5b;--warn-line:#c98a1b;--ko-line:#c45b5b;position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:36px;width:max-content;padding:8px}
.pmc-branch{position:relative;display:flex;align-items:center;padding:7px 0}
.pmc-children{position:relative;display:flex;flex-direction:column;padding-left:72px}
.pmc-wires{position:absolute;inset:0;width:100%;height:100%;overflow:visible;pointer-events:none}.pmc-wires path{--tint:var(--muted);fill:none;stroke:var(--tint);stroke-width:2;stroke-linecap:round;transition:opacity .15s}
.pmc-map-node{--tint:var(--muted);position:relative;flex:none;width:290px;padding:10px 12px;border:1.5px solid color-mix(in srgb,var(--tint) 70%,transparent);border-left-width:5px;border-radius:12px;background:color-mix(in srgb,var(--tint) 9%,var(--surface));color:var(--ink);transition:opacity .15s,outline-color .15s}
.pmc-map [data-state=ok]{--tint:var(--ok-line)}.pmc-map [data-state=warn]{--tint:var(--warn-line)}.pmc-map [data-state=ko]{--tint:var(--ko-line)}
.pmc-branch>.pmc-map-node,.pmc-branch>.pmc-gate{position:sticky;top:30%;bottom:30%}
.pmc-map-node[data-state=warn]{border-style:dashed;border-left-style:solid}
.pmc-map-node[data-kind=answer]{border-width:2.5px;border-left-width:7px}
.pmc-gate{--tint:var(--muted);flex:none;width:290px;padding:10px 12px;border:1.5px dashed color-mix(in srgb,var(--tint) 70%,transparent);border-left:5px solid color-mix(in srgb,var(--tint) 70%,transparent);border-radius:12px;background:var(--surface);color:var(--ink);font-size:13px;line-height:1.35}.pmc-gate p{margin:0 0 4px}
.pmc-box-kind{display:block;margin-bottom:3px;font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)}
.pmc-map-node h3{margin:0;font-size:14px;line-height:1.35;color:var(--ink)}.pmc-result{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;margin:5px 0 0}.pmc-result:empty{display:none}.pmc-result .pmc-value{margin:0}
.pmc-met{font-size:11.5px;font-weight:700;white-space:nowrap;color:color-mix(in srgb,var(--tint) 62%,var(--ink))}.pmc-met:before{content:'● '}
.pmc-map-node .pmc-docs{margin-top:7px;gap:7px}.pmc-map-node .pmc-docs q{font-size:12.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}.pmc-map-node .pmc-reference{font-size:12.5px;font-weight:600}
.pmc-map-node p.pmc-muted{margin:6px 0 0;font-size:12px}.pmc-map-node .pmc-calculation{margin:5px 0 0}
.pmc-map-node[role=button]{cursor:pointer}
.pmc-map-node .pmc-warn:not(.pmc-met,.pmc-value){display:block;font-size:11px;margin:6px 0 0}
.pmc-map-node:focus-visible,.pmc-map-node.is-selected{outline:2px solid var(--accent);outline-offset:3px}
.pmc[data-picking] .pmc-view,.pmc[data-picking] [data-card],.pmc[data-picking] [data-card] *{cursor:crosshair}.pmc[data-picking] [data-card]:hover{outline:2px solid var(--accent);outline-offset:3px}
.pmc-map .is-dim{opacity:.3}
.pmc-map-legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:0;font-size:11.5px;font-weight:500}.pmc-map-legend span{--tint:var(--muted);color:var(--ink)}.pmc-map-legend span:before{content:'';display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:3px;background:var(--tint)}.pmc-map-legend [data-state=ok]{--tint:#2f8f5b}.pmc-map-legend [data-state=warn]{--tint:#c98a1b}.pmc-map-legend [data-state=ko]{--tint:#c45b5b}

.pmc-others h3{font-size:15px}
.pmc-code-block{margin:10px 0;border:1px solid var(--border);border-radius:10px;background:var(--surface);font:12.5px/1.5 var(--piecemaker-font-ui,Inter,system-ui,sans-serif)}
.pmc-code-block summary{display:flex;align-items:center;flex-wrap:wrap;gap:4px 12px;padding:6px 10px;cursor:pointer;color:var(--text)}.pmc-code-block summary>span:not(.pmc-kind){display:inline-flex;align-items:center;gap:6px}
.pmc-code-block pre{margin:0;padding:10px 12px;border-top:1px solid var(--border);overflow:auto;color:var(--text);font:12px/1.5 var(--mono);white-space:pre}
`;
