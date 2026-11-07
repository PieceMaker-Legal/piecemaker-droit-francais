export const STYLES = `
.pmc{
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
.pmc-detail{flex:1;min-height:0;overflow:auto;padding:14px 16px 18px;font-size:13px;line-height:1.6}
.pmc-detail h4{margin:16px 0 6px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}.pmc-detail p{margin:6px 0}
.pmc-muted{color:var(--muted)}.pmc-warn{color:var(--warn)}
.pmc-pill{display:inline-flex;align-items:center;border:1px solid transparent;border-radius:999px;padding:1px 9px;font-size:11px;font-weight:500;line-height:18px;max-width:100%}
.pmc-ok{color:var(--ok)}.pmc-ko{color:var(--ko)}
.pmc-pill.pmc-ok{border-color:color-mix(in srgb,var(--ok-soft) 60%,transparent);background:color-mix(in srgb,var(--ok-soft) 22%,var(--surface))}
.pmc-pill.pmc-ko{border-color:color-mix(in srgb,var(--ko-soft) 60%,transparent);background:color-mix(in srgb,var(--ko-soft) 22%,var(--surface))}
.pmc-pill.pmc-warn{border-color:color-mix(in srgb,var(--warn-soft) 70%,transparent);background:color-mix(in srgb,var(--warn-soft) 25%,var(--surface))}
.pmc-pill.pmc-muted{border-color:var(--border);background:var(--soft)}
.pmc-detail .pmc-link{height:auto;border:0;box-shadow:none;background:none;backdrop-filter:none;padding:0 2px;color:var(--accent);font-weight:500;text-decoration:underline;text-underline-offset:2px;white-space:normal;text-align:left;display:inline;line-height:inherit;font-size:inherit}
.pmc-run{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.pmc-tally{display:flex;gap:6px;margin-left:auto}
.pmc-view-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0 10px}
.pmc-view-head select{min-width:150px;max-width:100%;border:1px solid var(--border);border-radius:999px;padding:5px 10px;background:var(--surface);color:var(--text);font:inherit}
.pmc-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--glass-border);border-radius:999px;background:var(--glass-bg);box-shadow:var(--glass-shadow)}
.pmc-tabs button{border:0;box-shadow:none;background:none;color:var(--muted)}.pmc-tabs button[aria-selected=true]{color:var(--ink);box-shadow:inset 0 0 0 1px var(--border)}
.pmc-open-states{margin:0 0 10px;padding:8px 12px;border:1px solid color-mix(in srgb,var(--warn-soft) 70%,var(--border));border-radius:12px;font-size:12.5px}.pmc-open-states summary{cursor:pointer;font-weight:600}.pmc-open-states ul{margin:6px 0 0;padding-left:20px}
.pmc-written{display:flex;flex-direction:column;gap:12px}
.pmc-rule{--kind:#3b82f6;padding:12px 14px;border:1px solid var(--border);border-left:4px solid var(--kind);border-radius:12px;background:var(--surface);scroll-margin-top:12px;transition:box-shadow .3s}
.pmc-rule[data-tone=ok]{--kind:var(--ok-soft)}.pmc-rule[data-tone=ko]{--kind:var(--ko-soft)}.pmc-rule[data-tone=warn]{--kind:var(--warn-soft)}.pmc-rule.is-focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 35%,transparent)}
.pmc-rule header{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}.pmc-rule h3{flex:1;min-width:12em;margin:0;color:var(--ink);font:600 16px/1.35 var(--editorial)}
.pmc-rule h4{margin:12px 0 4px;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)}
.pmc-kind{color:var(--muted);font-size:10.5px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.pmc-value{display:inline-flex;align-items:center;border-radius:999px;padding:1px 10px;font-size:12px;font-weight:600;line-height:20px;border:1px solid var(--border);background:var(--soft)}
.pmc-value.pmc-ok{border-color:color-mix(in srgb,var(--ok-soft) 70%,transparent);background:color-mix(in srgb,var(--ok-soft) 25%,var(--surface))}.pmc-value.pmc-ko{border-color:color-mix(in srgb,var(--ko-soft) 70%,transparent);background:color-mix(in srgb,var(--ko-soft) 25%,var(--surface))}.pmc-value.pmc-warn{border-color:color-mix(in srgb,var(--warn-soft) 70%,transparent);background:color-mix(in srgb,var(--warn-soft) 25%,var(--surface))}
.pmc-formula{margin:8px 0 0!important;color:var(--ink);line-height:1.9}
.pmc-logic-pill{display:inline-flex;align-items:center;justify-content:center;min-width:28px;padding:0 8px;margin:1px 3px;border:1px solid color-mix(in srgb,var(--warn) 45%,var(--border));border-radius:999px;background:color-mix(in srgb,var(--warn-soft) 20%,var(--surface));color:var(--warn);font:600 11px/20px var(--piecemaker-font-ui,Inter,system-ui,sans-serif);vertical-align:baseline}
.pmc-sources,.pmc-application{margin:2px 0 0;padding-left:18px}.pmc-sources li,.pmc-application li{margin:3px 0}
.pmc-sources q{display:block;margin:2px 0 4px;color:var(--text);font:italic 14px/1.45 var(--editorial)}
.pmc-application .pmc-value{font-size:11px;line-height:17px;margin-left:4px}
.pmc-explanation{border:1px solid var(--border);border-radius:14px;overflow:hidden}
.pmc-legend{display:flex;gap:6px 14px;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--border);font-size:12px;color:var(--muted)}
.pmc-legend [data-kind]:before{content:'';display:inline-block;width:10px;height:10px;margin-right:5px;border-radius:3px;background:var(--kind);vertical-align:-1px}
.pmc-legend .pmc-ok,.pmc-legend .pmc-ko{font-weight:600}
.pmc-canvas{position:relative;height:68vh;min-height:380px;overflow:hidden;touch-action:none;background-image:radial-gradient(color-mix(in srgb,var(--muted) 30%,transparent) .7px,transparent .7px);background-size:22px 22px;cursor:grab}
.pmc-stage{position:absolute;left:0;top:0;transform-origin:0 0}
.pmc-graph{position:relative}.pmc-graph svg{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}
.pmc-wire{color:var(--muted);stroke-width:1.6;opacity:.6;transition:opacity .2s}
.pmc [data-kind=fact]{--kind:#2f9e7c}.pmc [data-kind=condition]{--kind:#d99a2b}.pmc [data-kind=rule]{--kind:#3b82f6}.pmc [data-kind=answer]{--kind:#7c3aed}
.pmc-node{position:absolute;display:flex;flex-direction:column;gap:4px;padding:10px 12px;border:1.5px solid color-mix(in srgb,var(--kind) 65%,var(--border));border-radius:12px;background:color-mix(in srgb,var(--kind) 7%,var(--surface));cursor:pointer;outline:none;user-select:none;transition:opacity .2s,box-shadow .2s}
.pmc-node[data-kind=answer]{border-width:2.5px}
.pmc-node .pmc-kind{color:var(--kind)}.pmc-node strong{color:var(--ink);font-weight:600;line-height:1.35}.pmc-node .pmc-value{align-self:flex-start}
.pmc-node[data-issue]{border-style:dashed}
.pmc-node:hover,.pmc-node:focus-visible,.pmc-node[aria-pressed=true]{box-shadow:0 0 0 2px var(--kind)}
.pmc-node-sources{margin:2px 0 0;padding-left:16px;font-size:12px}.pmc-node-sources li{margin:1px 0}
.pmc-node.is-dim,.pmc-wire.is-dim{opacity:.15}
.pmc-tools{position:absolute;bottom:12px;right:12px;display:flex;gap:4px;padding:3px;border:1px solid var(--glass-border);border-radius:999px;background:var(--glass-bg);box-shadow:var(--glass-shadow);backdrop-filter:blur(20px)}
.pmc-tools button{padding:0 8px;min-width:28px;border:0;box-shadow:none;background:transparent}
.pmc-inspector{position:absolute;right:12px;top:12px;max-width:calc(100% - 24px);width:380px;max-height:calc(100% - 68px);overflow:auto;cursor:auto;border-radius:14px;box-shadow:0 8px 24px rgb(15 23 42 / .12)}
.pmc-inspector .pmc-rule{padding-top:30px}
.pmc .pmc-close{position:absolute;top:6px;right:6px;width:24px;height:24px;padding:0;z-index:1}
`;
