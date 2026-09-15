export const PLUGIN_STYLES = `
.pmd-root{height:100%;display:flex;flex-direction:column;background:var(--pmd-bg);color:var(--pmd-text);font:14px Inter,ui-sans-serif,system-ui,sans-serif}
.pmd-root[data-theme=dark]{--pmd-bg:#09090b;--pmd-surface:#18181b;--pmd-soft:#27272a;--pmd-border:#3f3f46;--pmd-text:#fafafa;--pmd-muted:#a1a1aa;--pmd-accent:#d4a72c;--pmd-danger:#ef4444}
.pmd-root[data-theme=light]{--pmd-bg:#fff;--pmd-surface:#fafafa;--pmd-soft:#f4f4f5;--pmd-border:#e4e4e7;--pmd-text:#18181b;--pmd-muted:#71717a;--pmd-accent:#946c00;--pmd-danger:#dc2626}
.pmd-header{display:flex;align-items:center;gap:12px;padding:8px 12px;border-bottom:1px solid var(--pmd-border);overflow-x:auto}
.pmd-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--pmd-border);border-radius:8px;background:var(--pmd-soft)}
.pmd-tab,.pmd-button{border:0;border-radius:6px;background:transparent;color:var(--pmd-muted);padding:7px 11px;font:inherit;cursor:pointer;white-space:nowrap}
.pmd-tab[aria-selected=true]{background:var(--pmd-bg);color:var(--pmd-text);box-shadow:0 1px 2px #0002}
.pmd-button{border:1px solid var(--pmd-border);color:var(--pmd-text)}
.pmd-button:hover,.pmd-tab:hover{color:var(--pmd-accent);border-color:var(--pmd-accent)}
.pmd-button-primary{background:var(--pmd-accent);border-color:var(--pmd-accent);color:var(--pmd-bg);font-weight:650}
.pmd-button-danger{color:var(--pmd-danger)}.pmd-spacer{flex:1}
.pmd-content{min-height:0;flex:1;overflow:auto;padding:20px}.pmd-toolbar{display:flex;align-items:center;gap:8px;margin-bottom:18px}
.pmd-title{font-size:20px;font-weight:700;margin:0}.pmd-subtitle{color:var(--pmd-muted);font-size:12px;margin-top:4px}
.pmd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}
.pmd-card{background:var(--pmd-surface);border:1px solid var(--pmd-border);border-radius:10px;padding:14px}
.pmd-card-head{display:flex;gap:10px;align-items:flex-start}.pmd-card-title{font-weight:650;overflow-wrap:anywhere}.pmd-card-kind{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--pmd-accent)}
.pmd-card-actions{display:flex;gap:5px;margin-left:auto}.pmd-icon-button{border:0;background:transparent;color:var(--pmd-muted);cursor:pointer;padding:3px}.pmd-icon-button:hover{color:var(--pmd-accent)}
.pmd-meta{font-size:12px;color:var(--pmd-muted);margin-top:9px;line-height:1.5;overflow-wrap:anywhere}
.pmd-badges{display:flex;gap:5px;flex-wrap:wrap;margin-top:10px}.pmd-badge{background:var(--pmd-soft);border:1px solid var(--pmd-border);border-radius:999px;padding:3px 7px;font-size:11px}
.pmd-empty{min-height:260px;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--pmd-muted)}
.pmd-error{margin:12px 20px;padding:10px 12px;border:1px solid var(--pmd-danger);border-radius:8px;color:var(--pmd-danger)}
.pmd-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:18px}.pmd-metric{padding:13px;border:1px solid var(--pmd-border);border-radius:9px;background:var(--pmd-surface)}.pmd-metric strong{display:block;font-size:22px}.pmd-metric span{font-size:11px;color:var(--pmd-muted)}
.pmd-group{margin:22px 0 10px;font-size:12px;color:var(--pmd-muted);text-transform:uppercase;letter-spacing:.08em}
.pmd-timeline{position:relative;padding-left:22px}.pmd-timeline:before{content:'';position:absolute;left:6px;top:8px;bottom:8px;width:1px;background:var(--pmd-border)}.pmd-event{position:relative;margin-bottom:12px}.pmd-event:before{content:'';position:absolute;left:-20px;top:18px;width:9px;height:9px;border-radius:50%;background:var(--pmd-accent)}
.pmd-modal{position:absolute;inset:0;z-index:30;background:#0008;display:flex;align-items:center;justify-content:center;padding:20px}.pmd-dialog{width:min(680px,100%);max-height:85%;overflow:auto;background:var(--pmd-bg);border:1px solid var(--pmd-border);border-radius:12px;padding:18px;box-shadow:0 20px 60px #0008}
.pmd-form{display:grid;gap:12px}.pmd-form label{display:grid;gap:5px;color:var(--pmd-muted);font-size:12px}.pmd-input,.pmd-select,.pmd-textarea{width:100%;box-sizing:border-box;border:1px solid var(--pmd-border);border-radius:7px;background:var(--pmd-surface);color:var(--pmd-text);padding:9px;font:inherit}.pmd-textarea{min-height:90px;resize:vertical}
.pmd-form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}.pmd-checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:6px}.pmd-check{display:flex!important;grid-template-columns:none!important;align-items:center;gap:7px!important;color:var(--pmd-text)!important}
.pmd-code{white-space:pre-wrap;word-break:break-word;background:var(--pmd-surface);border:1px solid var(--pmd-border);padding:14px;border-radius:8px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}
.pmd-mermaid{min-width:700px;display:flex;justify-content:center}.pmd-mermaid svg{max-width:none;height:auto}
@media(max-width:640px){.pmd-content{padding:12px}.pmd-header{gap:6px}.pmd-button,.pmd-tab{padding:6px 8px}.pmd-grid{grid-template-columns:1fr}}
`;
