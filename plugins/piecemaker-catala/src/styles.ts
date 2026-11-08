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
.pmc-detail .pmc-link{height:auto;border:0;box-shadow:none;background:none;backdrop-filter:none;padding:0 1px;color:var(--accent);font-weight:500;text-decoration:underline;text-underline-offset:2px;white-space:normal;text-align:left;display:inline;line-height:inherit;font-size:inherit}
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
.pmc-sources{margin:2px 0 0;padding-left:18px}.pmc-sources li{margin:4px 0}
.pmc-sources q{display:block;margin:2px 0 4px;color:var(--text);font:italic 15px/1.5 var(--editorial)}
.pmc-code{display:inline-block;margin-left:6px;color:var(--muted);font-size:11px;font-weight:500;letter-spacing:.01em}
.pmc-chips{display:inline-flex;flex-wrap:wrap;gap:6px 12px;margin-left:8px;vertical-align:baseline}
.pmc-chip{align-self:flex-start;color:#6d5bd0;font-size:12px;font-weight:500;text-decoration:none;white-space:nowrap}.pmc-chip:hover{text-decoration:underline}.pmc-chip:before{content:'§ '}.pmc-chip[data-kind=piece]{color:#2f7d63}.pmc-chip[data-kind=piece]:before{content:'▤ '}.pmc-chip[data-citation=failed]{color:var(--ko)}
.pmc-justification .pmc-chips{margin-left:6px}
.pmc-explanation{position:relative;border:1px solid var(--border);border-radius:14px;overflow:hidden}
.pmc-legend{display:flex;gap:6px 16px;flex-wrap:wrap;padding:8px 14px;border-bottom:1px solid var(--border);font-size:11.5px;color:var(--muted)}
.pmc-legend [data-kind]:before{content:'';display:inline-block;width:9px;height:9px;margin-right:5px;border-radius:3px;background:var(--kind);vertical-align:0}
.pmc-legend .pmc-ok,.pmc-legend .pmc-ko{font-weight:600}
.pmc-map-scroll{max-height:72vh;min-height:360px;overflow:auto;padding:20px}
.pmc-map-summary{display:flex;gap:8px;flex-direction:column;color:var(--ink);font-weight:600;margin-bottom:20px}
.pmc-map-summary span{font-size:12px;font-weight:400;color:var(--muted)}
.pmc-map{position:relative;display:flex;gap:96px;width:max-content;min-width:100%;padding:8px 0;align-items:center}
.pmc-map-column{display:flex;flex-direction:column;justify-content:center;gap:20px;width:250px;flex:none;z-index:1}
.pmc-map-node{padding:14px;border:1px solid var(--border);border-radius:16px;background:var(--surface);color:var(--ink);transition:opacity .15s,outline-color .15s}
.pmc-map-node[role=button]{cursor:pointer}
.pmc-map-node[data-kind=answer]{border-color:var(--accent)}
.pmc-map-node[data-kind=action]{border-style:dashed;border-color:var(--warn)}
.pmc-map-node .pmc-value{display:inline-block;margin-top:8px}
.pmc-map-node .pmc-node-note{margin:8px 0 0;max-height:6em;overflow:auto}
.pmc-map-node .pmc-warn{display:block;font-size:11px;margin-top:8px}
.pmc-map-node.is-selected,.pmc-map-node:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.pmc-map .is-dim{opacity:.22}
.pmc-map-links{position:absolute;inset:0;overflow:visible;pointer-events:none}
.pmc-map-links path{fill:none;stroke:var(--muted);stroke-width:1.4;opacity:.6}
.pmc-map-links [data-relation="condition appliquée"] path,.pmc-map-links [data-relation="écarte"] path{stroke-dasharray:5 4}
.pmc-map-links text{font:10px var(--piecemaker-font-ui,Inter,system-ui,sans-serif);fill:var(--muted);text-anchor:middle;paint-order:stroke;stroke:var(--bg);stroke-width:4px;stroke-linejoin:round}
.pmc-legend [data-kind]{--kind:var(--muted)}
.pmc-legend [data-kind=answer]{--kind:var(--accent)}
.pmc-legend [data-kind=action]{--kind:var(--warn)}
.pmc-node-title{color:var(--ink);font-weight:600;line-height:1.4;font-size:13px;margin-top:5px}
.pmc-node-note{color:var(--muted);font-size:12px;line-height:1.5}
.pmc-node-label{color:var(--muted);font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.pmc-inspector{position:absolute;right:12px;top:12px;max-width:calc(100% - 24px);width:400px;max-height:calc(100% - 68px);overflow:auto;cursor:auto;border-radius:14px;box-shadow:0 8px 28px rgb(15 23 42 / .16);background:var(--surface)}
.pmc-inspector .pmc-rule{border-radius:0;border-left-width:3px;padding-top:30px}
.pmc-inspector .pmc-rule h3{font-size:16px}
.pmc .pmc-close{position:absolute;top:6px;right:6px;width:24px;height:24px;padding:0;z-index:1}
.pmc-others h3{font-size:15px}
`;
