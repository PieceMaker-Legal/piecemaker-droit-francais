export const STYLES = `
.pmr{--ink:#e5e7eb;--muted:#9293a5;--bg:#16171e;--surface:#20212b;--border:#343540;--accent:#a78bfa;--ok:#4ade80;--ko:#f87171;--warn:#fbbf24;height:100%;display:flex;flex-direction:column;min-height:0;color:var(--ink);background:var(--bg);font:13px system-ui,sans-serif;container-type:inline-size}
.pmr[data-theme=light]{--ink:#242534;--muted:#696b7b;--bg:#f7f7fb;--surface:#fff;--border:#dadce5;--accent:#7251bd;--ok:#15803d;--ko:#b91c1c;--warn:#a16207}
.pmr *{box-sizing:border-box}.pmr [hidden]{display:none!important}
.pmr button,.pmr select,.pmr input,.pmr textarea{font:inherit;color:inherit;border:1px solid var(--border);border-radius:7px;background:var(--surface);padding:5px 9px}.pmr button{cursor:pointer}.pmr button:hover{border-color:var(--accent)}.pmr button:focus-visible,.pmr select:focus-visible,.pmr input:focus-visible,.pmr textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.pmr button:disabled{opacity:.5;cursor:default}
.pmr-head{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--border)}.pmr-head strong{font-size:12px;font-weight:600;flex:1}.pmr-head select{min-width:0;max-width:100%;flex:1 1 190px;font-size:11px}
.pmr-meta{padding:6px 12px;color:var(--muted);font-size:11px}.pmr-meta:empty{display:none}.pmr-warning{margin:4px 12px;padding:8px 10px;background:#f59e0b18;border:1px solid #f59e0b55;border-radius:7px;font-size:11px}
.pmr-workspace{display:flex;flex:1;flex-direction:column;min-height:0}
.pmr-canvas{position:relative;flex:1;min-height:260px;overflow:hidden;touch-action:none;background-image:radial-gradient(var(--border) .7px,transparent .7px);background-size:22px 22px}.pmr-canvas svg{width:100%;height:100%;display:block;position:absolute;inset:0;user-select:none}
.pmr-edge{fill:none;stroke:var(--muted);stroke-width:1.2;opacity:.35}.pmr-edge.is-neighbour{stroke:var(--accent);opacity:.85;stroke-width:1.8}.pmr-edge.is-dim{opacity:.08}.pmr-canvas marker path{fill:var(--muted)}
.pmr-node{cursor:pointer;outline:none}.pmr-node circle{stroke:var(--bg);stroke-width:3}.pmr-node.is-selected circle,.pmr-node:focus circle{stroke:var(--ink);stroke-width:3}.pmr-node.is-dim{opacity:.18}
.pmr-node text{fill:var(--ink);font-size:12px;paint-order:stroke;stroke:var(--bg);stroke-width:3px;stroke-linejoin:round}.pmr-node text.pmr-strong{font-size:13px;font-weight:600}.pmr-node .pmr-value{font-size:11px;fill:var(--muted)}
.pmr-node.is-uncertain circle{stroke:#f59e0b;stroke-dasharray:3 3}.pmr-node.is-missing circle{fill:transparent;stroke:#fb923c;stroke-width:2.5;stroke-dasharray:4 3}
.pmr-tools{position:absolute;bottom:10px;right:10px;display:flex;gap:5px}.pmr-tools button{min-width:30px;font-size:12px}
.pmr-legend{position:absolute;left:12px;bottom:12px;color:var(--muted);font-size:10px;display:flex;gap:9px;flex-wrap:wrap;max-width:calc(100% - 150px);pointer-events:none}.pmr-legend i{display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:4px}
.pmr-empty{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:15px;padding:28px;text-align:center;color:var(--muted);background:var(--bg)}.pmr-empty strong{font-size:16px;color:var(--ink)}.pmr-empty p{max-width:330px;margin:0;line-height:1.65}
.pmr-inspector{flex:0 0 auto;max-height:48%;min-height:140px;overflow:auto;border-top:1px solid var(--border);background:var(--surface)}
.pmr-tabs{display:flex;gap:4px;padding:8px 10px;position:sticky;top:0;background:var(--surface);z-index:1;border-bottom:1px solid var(--border)}.pmr-tabs button{font-size:11px;border-color:transparent;padding:5px 8px}.pmr-tabs button[aria-selected=true]{color:var(--accent);border-color:var(--border);background:var(--bg)}
.pmr-detail{padding:12px 14px;font-size:12.5px;line-height:1.6}.pmr-detail h3{margin:4px 0 6px;font-size:14px}.pmr-detail h4{margin:14px 0 4px;font-size:12px}.pmr-detail p{margin:6px 0}
.pmr-detail blockquote{margin:4px 0;border-left:2px solid var(--accent);padding-left:10px;white-space:pre-wrap;font-style:italic}.pmr-detail pre{font:11px ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--bg);padding:10px;border-radius:6px;margin:0}
.pmr-muted{color:var(--muted)}.pmr-warn{color:var(--warn)}
.pmr-pill{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:0 8px;font-size:11.5px;line-height:19px;white-space:nowrap}.pmr-ok{color:var(--ok)}.pmr-ko{color:var(--ko)}.pmr-warn.pmr-pill{color:var(--warn)}
.pmr-detail .pmr-link{border:0;background:none;padding:0 2px;color:var(--accent);text-decoration:underline;text-underline-offset:2px}.pmr-detail .pmr-link:hover{border:0}
.pmr-quote{margin:8px 0}.pmr-quote p{margin:0}
.pmr-problems{margin:8px 0;padding:6px 10px;border-left:3px solid var(--warn);background:color-mix(in srgb,var(--warn) 8%,transparent)}.pmr-problems ul{margin:2px 0 0;padding-left:16px}
.pmr-decision{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px}.pmr-decision button{font-size:12px}.pmr-primary{border-color:var(--accent)!important;color:var(--accent)}
.pmr-form{display:grid;gap:6px;margin-top:8px}.pmr-form label{display:grid;gap:2px;font-size:11.5px;color:var(--muted)}.pmr-form textarea{min-height:48px;resize:vertical;color:var(--ink)}
.pmr-test{display:grid;gap:6px;margin:8px 0}.pmr-test-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px;align-items:center}
.pmr-box{border:1px solid var(--border);border-radius:8px;padding:6px 10px;margin:8px 0;background:var(--bg)}.pmr-box p{margin:3px 0}
@container (min-width:880px){.pmr-workspace{flex-direction:row}.pmr-canvas{min-width:0;min-height:0}.pmr-inspector{flex:0 0 36%;width:36%;max-height:none;min-height:0;height:100%;border-top:0;border-left:1px solid var(--border)}}
`;
