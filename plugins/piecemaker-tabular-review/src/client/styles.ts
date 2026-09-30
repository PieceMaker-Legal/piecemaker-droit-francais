export const PLUGIN_STYLES = `
.ptr-root{
  --ptr-bg:hsl(var(--background));
  --ptr-surface:hsl(var(--card));
  --ptr-soft:hsl(var(--muted));
  --ptr-border:hsl(var(--border));
  --ptr-text:hsl(var(--foreground));
  --ptr-muted:hsl(var(--muted-foreground));
  --ptr-accent:var(--piecemaker-blue,rgb(0 136 255));
  --ptr-danger:#dc2626;
  --ptr-warning:#b45309;
  --ptr-glass-bg:var(--liquid-glass-background-subtle,rgb(255 255 255 / .78));
  --ptr-glass-border:var(--liquid-glass-border-subtle,rgb(229 231 235 / .9));
  --ptr-glass-shadow:var(--liquid-glass-shadow-subtle,0 1px 2px rgb(15 23 42 / .05));
  position:relative;height:100%;display:flex;flex-direction:column;overflow:hidden;
  background:var(--ptr-bg);color:var(--ptr-text);
  font:13px/1.45 var(--piecemaker-font-ui,Inter,ui-sans-serif,system-ui,sans-serif);
}
.ptr-root[data-theme=dark]{--ptr-glass-bg:var(--liquid-glass-background-subtle,rgb(24 28 36 / .72));--ptr-glass-border:var(--liquid-glass-border-subtle,rgb(255 255 255 / .08));--ptr-danger:#f87171;--ptr-warning:#fbbf24}
.ptr-root *{box-sizing:border-box}
.ptr-header{display:flex;align-items:center;gap:10px;padding:8px 14px;border-bottom:1px solid var(--ptr-border);flex-shrink:0}
.ptr-tabs{display:flex;gap:3px;padding:3px;border:1px solid var(--ptr-glass-border);border-radius:9999px;background:var(--ptr-glass-bg);box-shadow:var(--ptr-glass-shadow)}
.ptr-tab{height:1.75rem;border:0;border-radius:9999px;background:transparent;color:var(--ptr-muted);padding:0 .8rem;font:500 12px inherit;font-family:inherit;cursor:pointer;white-space:nowrap}
.ptr-tab[aria-selected=true]{color:var(--ptr-text);font-weight:600;box-shadow:inset 0 0 0 1px rgb(var(--piecemaker-ink-rgb,17 24 39) / 22%)}
.ptr-root[data-theme=dark] .ptr-tab[aria-selected=true]{box-shadow:inset 0 0 0 1px rgb(255 255 255 / 22%)}
.ptr-spacer{flex:1}
.ptr-main{flex:1;min-height:0;overflow:auto}
.ptr-page{padding:12px 14px;display:flex;flex-direction:column;gap:10px;min-height:100%}
.ptr-button{display:inline-flex;align-items:center;justify-content:center;gap:.35rem;height:1.75rem;padding:0 .75rem;border:1px solid var(--ptr-glass-border);border-radius:9999px;background:var(--ptr-glass-bg);box-shadow:var(--ptr-glass-shadow);color:var(--ptr-text);font:500 12px inherit;font-family:inherit;cursor:pointer;white-space:nowrap}
.ptr-button:hover{filter:brightness(.97)}
.ptr-button:disabled{opacity:.45;cursor:not-allowed}
.ptr-button-primary{background:rgb(3 7 18 / 88%);border-color:transparent;color:#fff;box-shadow:none}
.ptr-root[data-theme=dark] .ptr-button-primary{background:#f9fafb;color:#111827}
.ptr-button-danger{color:var(--ptr-danger)}
.ptr-icon-button{display:inline-flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;padding:0;border:0;border-radius:6px;background:transparent;color:var(--ptr-muted);cursor:pointer;font-size:16px;line-height:1}
.ptr-icon-button:hover{background:var(--ptr-soft);color:var(--ptr-text)}
.ptr-button:focus-visible,.ptr-tab:focus-visible,.ptr-icon-button:focus-visible,.ptr-input:focus-visible,.ptr-select:focus-visible,.ptr-textarea:focus-visible{outline:none;box-shadow:0 0 0 2px rgb(0 136 255 / 40%)}
.ptr-input,.ptr-select,.ptr-textarea{width:100%;min-width:0;border:1px solid var(--ptr-border);border-radius:8px;background:var(--ptr-surface);color:var(--ptr-text);font:13px inherit;font-family:inherit;padding:5px 8px}
.ptr-textarea{resize:vertical;min-height:52px}
.ptr-field{display:flex;flex-direction:column;gap:3px;min-width:0}
.ptr-label{font-size:11px;font-weight:600;color:var(--ptr-muted);text-transform:uppercase;letter-spacing:.03em}
.ptr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.ptr-panels{display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);gap:10px;flex:1;min-height:280px}
@media (max-width:900px){.ptr-grid{grid-template-columns:1fr}.ptr-panels{grid-template-columns:1fr}}
.ptr-panel{display:flex;flex-direction:column;min-height:0;border:1px solid var(--ptr-border);border-radius:10px;background:var(--ptr-surface);overflow:hidden}
.ptr-panel-header{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--ptr-border);font-weight:600;font-size:12px}
.ptr-panel-body{flex:1;min-height:0;overflow:auto;max-height:52vh}
.ptr-muted{color:var(--ptr-muted)}
.ptr-small{font-size:11px}
.ptr-doc-group{padding:4px 10px 2px;font-size:11px;font-weight:600;color:var(--ptr-muted);position:sticky;top:0;background:var(--ptr-surface);z-index:1}
.ptr-doc{display:flex;align-items:center;gap:8px;padding:3px 10px;cursor:pointer}
.ptr-doc:hover,.ptr-list-row:hover{background:var(--ptr-soft)}
.ptr-doc span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ptr-row-item{display:flex;align-items:flex-start;gap:8px;padding:5px 10px;border-bottom:1px solid var(--ptr-border)}
.ptr-row-item:last-child{border-bottom:0}
.ptr-row-item .ptr-input{height:1.6rem;padding:2px 6px}
.ptr-row-docs{font-size:11px;color:var(--ptr-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ptr-group-badge{flex-shrink:0;font-size:10px;font-weight:600;padding:1px 6px;border-radius:9999px;background:var(--ptr-soft);color:var(--ptr-muted)}
.ptr-footer-bar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:10px;padding-top:4px}
.ptr-warning{padding:6px 10px;border-radius:8px;background:rgb(245 158 11 / 12%);color:var(--ptr-warning);font-size:12px}
.ptr-error-box{padding:6px 10px;border-radius:8px;background:rgb(220 38 38 / 10%);color:var(--ptr-danger);font-size:12px}
.ptr-empty{padding:18px;text-align:center;color:var(--ptr-muted)}
.ptr-list{border:1px solid var(--ptr-border);border-radius:10px;background:var(--ptr-surface);overflow:hidden}
.ptr-list-row{display:flex;align-items:center;gap:8px;min-height:30px;padding:2px 10px 2px 4px;border-bottom:1px solid var(--ptr-border);cursor:pointer}
.ptr-list-row:last-child{border-bottom:0}
.ptr-list-row strong{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%}
.ptr-list-row .ptr-ellipsis{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ptr-chip{flex-shrink:0;display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:1px 8px;border-radius:9999px;background:var(--ptr-soft);color:var(--ptr-muted);white-space:nowrap}
.ptr-chip-running{color:var(--ptr-accent)}
.ptr-chip-partial,.ptr-chip-interrupted{color:var(--ptr-warning)}
.ptr-chip-cancelled{color:var(--ptr-danger)}
.ptr-chip-done{color:#15803d}
.ptr-table-wrap{flex:1;min-height:0;overflow:auto;border:1px solid var(--ptr-border);border-radius:10px;background:var(--ptr-surface)}
.ptr-table{border-collapse:separate;border-spacing:0;min-width:100%;table-layout:fixed}
.ptr-table th,.ptr-table td{border-right:1px solid var(--ptr-border);border-bottom:1px solid var(--ptr-border);padding:6px 8px;vertical-align:top;text-align:left;width:260px;min-width:220px;max-width:340px}
.ptr-table th{position:sticky;top:0;z-index:2;background:var(--ptr-soft);font-size:12px;font-weight:600}
.ptr-table th:first-child,.ptr-table td:first-child{position:sticky;left:0;z-index:1;background:var(--ptr-surface);width:220px;min-width:180px}
.ptr-table th:first-child{z-index:3;background:var(--ptr-soft)}
.ptr-th{display:flex;align-items:flex-start;gap:4px}
.ptr-th .ptr-icon-button{margin-left:auto;flex-shrink:0;width:1.25rem;height:1.25rem;font-size:10px}
.ptr-table td.ptr-cell{cursor:pointer}
.ptr-table td.ptr-cell:hover{background:var(--ptr-soft)}
.ptr-table td.ptr-cell[aria-selected=true]{box-shadow:inset 0 0 0 2px var(--ptr-accent)}
.ptr-cell-content{display:flex;gap:6px;max-height:9.5em;overflow:hidden}
.ptr-cell-content .ptr-md{min-width:0}
.ptr-md p{margin:0 0 3px}
.ptr-md ul{margin:0 0 3px;padding-left:16px}
.ptr-md code{font-size:12px}
.ptr-flag{display:inline-block;flex-shrink:0;width:9px;height:9px;margin-top:4px;border-radius:9999px}
.ptr-row-label{font-weight:600;word-break:break-word}
.ptr-row-status{margin-top:3px;font-size:11px;color:var(--ptr-muted);word-break:break-word}
.ptr-row-status.ptr-status-error{color:var(--ptr-danger)}
.ptr-spinner{display:inline-block;width:10px;height:10px;border:2px solid currentColor;border-right-color:transparent;border-radius:9999px;animation:ptr-spin .8s linear infinite;vertical-align:-1px}
@keyframes ptr-spin{to{transform:rotate(360deg)}}
.ptr-progress{height:4px;border-radius:9999px;background:var(--ptr-soft);overflow:hidden;min-width:120px}
.ptr-progress>div{height:100%;background:var(--ptr-accent);transition:width .4s}
.ptr-review{display:flex;flex-direction:column;gap:8px;height:100%;padding:10px 14px}
.ptr-review-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.ptr-review-title{font-size:15px;font-weight:600}
.ptr-legend{display:flex;flex-wrap:wrap;gap:12px;font-size:11px;color:var(--ptr-muted)}
.ptr-legend span{display:inline-flex;align-items:center;gap:5px}
.ptr-legend .ptr-flag{margin:0}
.ptr-review-body{flex:1;min-height:0;display:flex;gap:8px}
.ptr-detail{width:340px;flex-shrink:0;overflow:auto;border:1px solid var(--ptr-border);border-radius:10px;background:var(--ptr-surface);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
@media (max-width:900px){.ptr-review-body{flex-direction:column}.ptr-detail{width:auto;max-height:40vh}}
.ptr-detail h3{margin:0;font-size:13px}
.ptr-overlay{position:absolute;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;background:rgb(0 0 0 / 35%)}
.ptr-modal{width:min(480px,100%);max-height:calc(100% - 16px);display:flex;flex-direction:column;border:1px solid var(--ptr-border);border-radius:14px;background:var(--ptr-surface);box-shadow:0 20px 50px rgb(0 0 0 / 25%)}
.ptr-modal-wide{width:min(820px,100%)}
.ptr-modal-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--ptr-border)}
.ptr-modal-header h2{margin:0;font-size:14px}
.ptr-modal-body{padding:12px 14px;overflow:auto;display:flex;flex-direction:column;gap:10px}
.ptr-modal-body p{margin:0}
.ptr-modal-footer{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:8px;padding:10px 14px;border-top:1px solid var(--ptr-border)}
.ptr-question{display:grid;grid-template-columns:minmax(0,1fr) 130px auto;gap:6px;padding:8px;border:1px solid var(--ptr-border);border-radius:10px}
.ptr-question .ptr-textarea,.ptr-question [data-tags-field]{grid-column:1 / -1}
.ptr-question-actions{display:flex;gap:2px}
.ptr-toast{position:absolute;right:14px;bottom:14px;z-index:60;max-width:420px;padding:8px 12px;border-radius:10px;background:rgb(3 7 18 / 90%);color:#fff;font-size:12px;box-shadow:0 8px 24px rgb(0 0 0 / 20%)}
.ptr-toast-error{background:#b91c1c}
.ptr-summary-list{margin:0;padding-left:18px}
`;
