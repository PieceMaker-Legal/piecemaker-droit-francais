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
.pmc-log{position:relative;list-style:none;margin:0;padding:0 0 0 22px}
.pmc-log:before{content:'';position:absolute;left:7px;top:8px;bottom:8px;width:1px;background:var(--border)}
.pmc-entry{position:relative;padding:6px 0 8px}
.pmc-mark{position:absolute;left:-22px;top:8px;display:flex;width:15px;height:15px;align-items:center;justify-content:center;border-radius:50%;background:var(--bg);box-shadow:0 0 0 3px var(--bg);font-size:9px;font-weight:700;line-height:1}
.pmc-entry[data-status=ok] .pmc-mark{background:var(--ok-soft);color:#fff}
.pmc-entry[data-status=alerte] .pmc-mark{background:var(--ko-soft);color:#fff}
.pmc-entry[data-status=neutre] .pmc-mark{border:1.5px solid var(--muted);transform:scale(.7)}
.pmc-entry-head{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
.pmc-step{color:var(--muted);font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
.pmc-entry strong{color:var(--ink);font-weight:600;overflow-wrap:anywhere}
.pmc-entry-text{color:var(--text);font-size:12.5px}
.pmc-entry[data-status=alerte] .pmc-entry-text{color:var(--ko)}
.pmc-part{margin-top:16px}.pmc-part:first-of-type{margin-top:4px}.pmc-phase{margin:8px 0;padding:10px 12px 4px;border:1px solid var(--border);border-left:4px solid var(--border);border-radius:12px;background:var(--surface)}.pmc-phase[data-status=ok]{border-left-color:var(--ok-soft)}.pmc-phase[data-status=alerte]{border-left-color:var(--ko-soft)}.pmc-phase[data-status=attente]{border-left-color:var(--warn-soft)}.pmc-phase[data-status=attente] .pmc-phase-state{color:var(--warn)}.pmc-phase header{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:4px}.pmc-phase header strong{color:var(--ink);font-weight:600}.pmc-phase-state{margin-left:auto;font-size:12px;font-weight:600}.pmc-phase[data-status=ok] .pmc-phase-state{color:var(--ok)}.pmc-phase[data-status=alerte] .pmc-phase-state{color:var(--ko)}.pmc-phase h5{margin:8px 0 0;color:var(--muted);font-size:10px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}.pmc-proofs{margin-left:22px}.pmc-phase-rule{margin:2px 0 6px;font-size:13px;line-height:1.45;color:var(--ink)}.pmc-phase-rule p{margin:4px 0 0}.pmc-phase-rule ul{margin:2px 0 0;padding-left:20px}.pmc-phase-rule .pmc-link{font-weight:600}.pmc-part h4{margin:0 0 4px;font-size:12px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--ink)}
.pmc-lead{margin:0 0 8px!important;color:var(--muted);font-size:12px}
.pmc-files{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}.pmc-detail .pmc-link[aria-pressed=true]{text-decoration:none;color:var(--ink)}.pmc-entry-head .pmc-pill{font-size:10px;line-height:15px}
.pmc-explanation{margin-top:12px;border:1px solid var(--border);border-radius:14px;overflow:hidden}
.pmc-graph-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--border)}
.pmc-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--glass-border);border-radius:999px;background:var(--glass-bg);box-shadow:var(--glass-shadow)}
.pmc-tabs button{border:0;box-shadow:none;background:none;color:var(--muted)}.pmc-tabs button[aria-selected=true]{color:var(--ink);box-shadow:inset 0 0 0 1px var(--border)}
.pmc-view>.pmc-tabs{width:max-content;margin:10px 0 0}.pmc-view>.pmc-explanation[hidden],.pmc-view>.pmc-written[hidden]{display:none}.pmc-written-step{margin:12px 0 20px}.pmc-written-step>h3{margin:0 0 8px;color:var(--ink);font:600 16px var(--editorial)}.pmc-written-branches{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:8px}.pmc-written-branches .pmc-phase{margin:0}
.pmc-graph-head select{flex:1;min-width:150px;max-width:100%;border:1px solid var(--border);border-radius:999px;padding:5px 10px;background:var(--surface);color:var(--text);font:inherit}
.pmc-open-states{padding:8px 12px;font-size:12px;border-bottom:1px solid var(--border)}.pmc-open-states ul{margin:6px 0;padding-left:20px}
.pmc-canvas{position:relative;height:68vh;min-height:380px;overflow:hidden;touch-action:none;background-image:radial-gradient(color-mix(in srgb,var(--muted) 30%,transparent) .7px,transparent .7px);background-size:22px 22px;cursor:grab}
.pmc-stage{position:absolute;left:0;top:0;transform-origin:0 0;user-select:none}.pmc-stage svg{display:block;overflow:visible;font:12.5px var(--piecemaker-font-ui,Inter,system-ui,sans-serif)}
.pmc-wire{color:var(--muted);stroke-width:1.6;opacity:.6;pointer-events:none;transition:opacity .2s}
.pmc-node{--kind:#3b82f6;cursor:pointer;outline:none;transition:opacity .2s}
.pmc-node[data-kind=input]{--kind:#2f9e7c}.pmc-node[data-kind=condition]{--kind:#d99a2b}.pmc-node[data-kind=conclusion]{--kind:#14a3a0}.pmc-node[data-monetary=true]{--kind:#8b5cf6}
.pmc-node[data-kind=input][data-tone=ko]{--kind:#c45b5b}.pmc-node[data-tone=warn]{--kind:#d99a2b}
.pmc-node rect{fill:color-mix(in srgb,var(--kind) 8%,var(--surface));stroke:color-mix(in srgb,var(--kind) 70%,var(--border));stroke-width:1.5}
.pmc-node:hover rect,.pmc-node:focus-visible rect,.pmc-node[aria-pressed=true] rect{stroke:var(--kind);stroke-width:3}
.pmc-node-kind{fill:var(--kind);font-size:10px;font-weight:600}.pmc-node-text{fill:var(--ink);font-weight:600}.pmc-node-value{fill:var(--muted);font-weight:400}
.pmc-node[data-tone=ok] .pmc-node-value{fill:var(--ok)}.pmc-node[data-tone=ko] .pmc-node-value{fill:var(--ko)}.pmc-node[data-tone=warn] .pmc-node-value,.pmc-node-alert{fill:var(--warn)}
.pmc-node.is-dim,.pmc-wire.is-dim{opacity:.13}.pmc-node.is-waiting,.pmc-wire.is-waiting{opacity:.05}
.pmc-tools{position:absolute;bottom:12px;right:12px;display:flex;gap:4px;padding:3px;border:1px solid var(--glass-border);border-radius:999px;background:var(--glass-bg);box-shadow:var(--glass-shadow);backdrop-filter:blur(20px)}
.pmc-tools button{padding:0 8px;min-width:28px;border:0;box-shadow:none;background:transparent}
.pmc-legend,.pmc-inspector{position:absolute;right:12px;bottom:56px;max-width:calc(100% - 24px);width:340px;max-height:calc(100% - 76px);overflow:auto;padding:12px;border:1px solid var(--glass-border);border-radius:14px;background:var(--surface);box-shadow:var(--glass-shadow);cursor:auto}
.pmc-legend{display:flex;gap:8px 12px;flex-wrap:wrap;z-index:2;font-size:12px}.pmc-legend p{margin:0;color:var(--muted)}.pmc-legend .is-calculation{color:#3b82f6}.pmc-legend .is-condition{color:#d99a2b}.pmc-legend .is-input{color:#2f9e7c}
.pmc-inspector header{display:flex;align-items:baseline;justify-content:space-between;gap:10px}.pmc-inspector p{white-space:pre-line}.pmc-inspector h4{margin-top:10px}
.pmc-written{padding:12px 0;max-height:68vh;overflow:auto}
.pmc-part>summary{cursor:pointer;color:var(--muted);font-weight:500}.pmc-open-states summary{cursor:pointer}
.pmc-node[data-kind=piece]{--kind:#2f9e7c}.pmc-node[data-kind=article]{--kind:#3b82f6}.pmc-node[data-kind=reference]{--kind:#8c96ad}
.pmc-condition-expression{color:var(--ink);font:500 12px/1.85 var(--mono);overflow-wrap:anywhere;white-space:pre-wrap}
.pmc-logic-pill{display:inline-flex;align-items:center;justify-content:center;min-width:28px;padding:0 8px;margin:1px 3px;border:1px solid color-mix(in srgb,var(--warn) 45%,var(--border));border-radius:999px;background:color-mix(in srgb,var(--warn-soft) 20%,var(--surface));color:var(--warn);font:600 11px/20px var(--piecemaker-font-ui,Inter,system-ui,sans-serif);vertical-align:baseline}
.pmc-expression,.pmc-source-text{white-space:pre-wrap;overflow-wrap:anywhere}.pmc-expression{margin:8px 0;font:12px/1.7 var(--mono)}
.pmc-legend .is-piece{color:#2f9e7c}.pmc-legend .is-article{color:#3b82f6}.pmc-legend .is-reference{color:#8c96ad}

`;
