export const STYLES = `
.pmr{--ink:#e5e7eb;--muted:#9293a5;--bg:#16171e;--surface:#20212b;--border:#343540;--accent:#a78bfa;--law:#93b4f5;--fact:#7ccfae;--ok:#4ade80;--ko:#f87171;--warn:#fbbf24;height:100%;display:flex;flex-direction:column;min-height:0;color:var(--ink);background:var(--bg);font:13px system-ui,sans-serif;container-type:inline-size}
.pmr[data-theme=light]{--ink:#242534;--muted:#696b7b;--bg:#f7f7fb;--surface:#fff;--border:#dadce5;--accent:#7251bd;--law:#2f5fbf;--fact:#16825d;--ok:#15803d;--ko:#b91c1c;--warn:#a16207}
.pmr *{box-sizing:border-box}.pmr [hidden]{display:none!important}
.pmr button,.pmr select,.pmr input,.pmr textarea{font:inherit;color:inherit;border:1px solid var(--border);border-radius:7px;background:var(--surface);padding:4px 8px}.pmr button{cursor:pointer}.pmr button:hover{border-color:var(--accent)}.pmr button:focus-visible,.pmr select:focus-visible,.pmr input:focus-visible,.pmr textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.pmr button:disabled{opacity:.5;cursor:default}
.pmr-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:10px 12px;border-bottom:1px solid var(--border)}.pmr-head strong{flex:1;font-size:12px}
.pmr-tabs{display:flex;gap:4px}.pmr-tabs button[aria-selected=true]{border-color:var(--accent);color:var(--accent)}
.pmr-meta{padding:6px 12px;color:var(--muted);font-size:11px}.pmr-warning{margin:0 12px 6px;padding:6px 8px;border-radius:7px;border:1px solid var(--warn);color:var(--warn);font-size:12px}
.pmr-body{flex:1;overflow:auto;padding:0 12px 16px}
.pmr-empty{padding:24px 8px;color:var(--muted)}.pmr-empty strong{color:var(--ink)}
.pmr-question{border:1px solid var(--border);border-radius:10px;background:var(--surface);margin:10px 0;padding:10px}
.pmr-question h3{margin:0 0 4px;font-size:14px}.pmr-answer{display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:6px}
.pmr-badge{display:inline-block;border:1px solid currentColor;border-radius:999px;padding:0 7px;font-size:11px;line-height:18px;white-space:nowrap}
.pmr-s-remplie,.pmr-s-établi,.pmr-s-validé{color:var(--ok)}.pmr-s-non-remplie,.pmr-s-bloquée,.pmr-s-écarté{color:var(--ko)}.pmr-s-indéterminée,.pmr-s-non-établi{color:var(--warn)}
.pmr-k-loi{color:var(--law)}.pmr-k-jurisprudence{color:var(--accent)}.pmr-k-doctrine{color:var(--muted)}
.pmr-columns{display:grid;grid-template-columns:minmax(0,1fr) 18px minmax(0,1fr);gap:6px;align-items:stretch}.pmr-colhead{font-size:11px;font-weight:700;letter-spacing:.06em}.pmr-colhead.law{color:var(--law)}.pmr-colhead.fact{color:var(--fact)}
.pmr-arrow{align-self:center;text-align:center;color:var(--muted)}
.pmr-card{border:1px solid var(--border);border-radius:8px;padding:8px;background:var(--bg);min-width:0}.pmr-card.law{border-left:3px solid var(--law)}.pmr-card.fact{border-left:3px solid var(--fact)}.pmr-card.missing{border-style:dashed}
.pmr-card h4{margin:0 0 4px;font-size:12.5px}.pmr-card code{font-size:11px;color:var(--muted)}
.pmr-chips{display:flex;gap:4px;flex-wrap:wrap;margin:4px 0}.pmr-chip{font-size:11px;padding:1px 6px!important;border-radius:999px!important;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pmr-issues{margin:4px 0 0;padding-left:16px;color:var(--warn);font-size:11.5px}
.pmr-review{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}.pmr-review button{font-size:11px;padding:2px 7px}
.pmr-form{display:grid;gap:4px;margin-top:6px}.pmr-form textarea{min-height:44px;resize:vertical}
.pmr-muted{color:var(--muted);font-size:11.5px}.pmr-excerpt{font-style:italic;color:var(--muted);font-size:11.5px;margin:2px 0}
.pmr-vigueur{font-size:11.5px;margin:4px 0 8px;color:var(--muted)}
.pmr-code{white-space:pre;overflow:auto;font:12px ui-monospace,monospace;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:10px;margin:10px 0}
.pmr-source{border-bottom:1px solid var(--border);padding:8px 0}
@container (max-width:520px){.pmr-columns{grid-template-columns:minmax(0,1fr)}.pmr-arrow{transform:rotate(90deg);height:12px;line-height:12px}.pmr-colhead.fact,.pmr-colhead.gap{display:none}}
`;
