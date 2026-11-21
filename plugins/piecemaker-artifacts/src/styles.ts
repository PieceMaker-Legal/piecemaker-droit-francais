export const STYLES = `
.pma{
  height:100%;display:flex;flex-direction:column;overflow:auto;
  background:var(--pma-bg);color:var(--pma-text);
  font:14px/1.45 var(--piecemaker-font-ui,Inter,ui-sans-serif,system-ui,sans-serif);
  --pma-bg:hsl(var(--background));--pma-surface:hsl(var(--card));--pma-soft:hsl(var(--muted));
  --pma-border:var(--piecemaker-border,#e5e7eb);--pma-text:var(--piecemaker-text,#374151);
  --pma-muted:var(--piecemaker-muted,#6b7280);--pma-ink:var(--piecemaker-ink,#111827);
  --pma-accent:var(--piecemaker-blue,rgb(0 136 255));--pma-danger:#9f3b3b;
  --pma-glass-bg:var(--liquid-glass-background-subtle,rgb(255 255 255 / .78));
  --pma-glass-border:var(--liquid-glass-border-subtle,rgb(229 231 235 / .9));
  --pma-glass-shadow:var(--liquid-glass-shadow-subtle,inset 0 1px 0 rgb(255 255 255 / .8),0 1px 2px rgb(15 23 42 / .05));
}
.pma[data-theme=dark]{
  --pma-bg:hsl(var(--background));--pma-surface:hsl(var(--card));--pma-soft:hsl(var(--muted));
  --pma-border:hsl(var(--border));--pma-text:hsl(var(--foreground));
  --pma-muted:hsl(var(--muted-foreground));--pma-ink:hsl(var(--foreground));--pma-danger:#d7a3a3;
  --pma-glass-bg:var(--liquid-glass-background-subtle,rgb(24 28 36 / .72));
  --pma-glass-border:var(--liquid-glass-border-subtle,rgb(255 255 255 / .08));
  --pma-glass-shadow:var(--liquid-glass-shadow-subtle,inset 0 1px 0 rgb(255 255 255 / .06),0 1px 2px rgb(0 0 0 / .35));
}
.pma[data-theme=dark] .piecemaker-button--glass{color:var(--pma-text)}
.pma .pma-danger,.pma[data-theme=dark] .pma-danger{color:var(--pma-danger)}
.pma-bar{display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--pma-border);position:sticky;top:0;z-index:1;background:var(--pma-bg)}
.pma-bar h2{flex:1;min-width:120px;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--piecemaker-font-editorial,"EB Garamond",Georgia,serif);font-size:1.35rem;font-weight:500;letter-spacing:-.02em;color:var(--pma-ink)}
.pma-tabs{display:flex;align-items:center;gap:3px;padding:3px;border:1px solid var(--pma-glass-border);border-radius:9999px;background:var(--pma-glass-bg);box-shadow:var(--pma-glass-shadow);backdrop-filter:blur(20px)}
.pma-tab{display:flex;align-items:center;height:1.75rem;border:0;border-radius:9999px;background:transparent;color:var(--pma-muted);padding:0 .75rem;font:500 12px var(--piecemaker-font-ui,inherit);cursor:pointer;white-space:nowrap}
.pma-tab[aria-selected=true]{color:var(--pma-ink);font-weight:600;box-shadow:inset 0 0 0 1px rgb(var(--piecemaker-ink-rgb,17 24 39) / 22%)}
.pma-tab:hover[aria-selected=false]{color:var(--pma-text);background:rgb(255 255 255 / 10%)}
.pma-icon-button{display:inline-flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;padding:0;border:0;border-radius:9999px;background:transparent;color:var(--pma-muted);cursor:pointer;font-size:16px;line-height:1}
.pma-icon-button:hover{color:var(--pma-text);background:var(--pma-soft)}
.pma-pin{opacity:.35}
.pma-pin.on,.pma-pin[aria-pressed=true]{opacity:1;color:var(--pma-accent);background:var(--pma-soft)}
.pma .piecemaker-button[aria-pressed=true]{color:var(--pma-accent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--pma-accent) 55%,transparent),var(--pma-glass-shadow)}
.pma-select{height:1.75rem;max-width:100%;box-sizing:border-box;border:1px solid var(--pma-glass-border);border-radius:9999px;background:var(--pma-glass-bg);box-shadow:var(--pma-glass-shadow);backdrop-filter:blur(20px);color:var(--pma-text);padding:0 .625rem;font:500 12px var(--piecemaker-font-ui,inherit);cursor:pointer}
.pma-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px;padding:22px 24px}
.pma-card{display:flex;gap:12px;align-items:flex-start;padding:14px 16px;background:var(--pma-surface);border:1px solid var(--pma-border);border-radius:12px;box-shadow:var(--pma-glass-shadow);cursor:pointer}
.pma-card:hover{border-color:color-mix(in srgb,var(--pma-accent) 40%,var(--pma-border))}
.pma-card:focus-visible{outline:none;border-color:var(--pma-accent);box-shadow:0 0 0 2px rgb(0 136 255 / 40%),0 0 0 4px var(--pma-bg)}
.pma-card-icon{display:flex;width:36px;height:36px;flex:0 0 36px;align-items:center;justify-content:center;border-radius:10px;background:var(--pma-soft);color:var(--pma-muted);font-size:18px;line-height:1}
.pma-card-body{flex:1;min-width:0}
.pma-card h3{margin:0 0 4px;font-size:14px;font-weight:600;line-height:1.35;overflow-wrap:anywhere;color:var(--pma-ink)}
.pma-card p{margin:0 0 6px;color:var(--pma-muted);font-size:12px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.pma-muted{color:var(--pma-muted);font-size:12px}
.pma-empty{min-height:280px;display:flex;align-items:center;justify-content:center;text-align:center;padding:24px 16px;color:var(--pma-muted)}
.pma-error{margin:12px 22px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--pma-danger) 35%,var(--pma-border));border-radius:10px;background:color-mix(in srgb,var(--pma-danger) 6%,var(--pma-surface));color:var(--pma-danger);font-size:13px}
.pma-notice{margin:12px 22px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--pma-accent) 35%,var(--pma-border));border-radius:10px;background:color-mix(in srgb,var(--pma-accent) 6%,var(--pma-surface));color:var(--pma-text);font-size:13px}
.pma-git{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:14px 24px 0;padding:10px 14px;border:1px solid var(--pma-glass-border);border-radius:12px;background:var(--pma-glass-bg);box-shadow:var(--pma-glass-shadow)}
.pma-git-info{flex:1;min-width:220px;display:flex;flex-direction:column;gap:2px;font-size:12px;color:var(--pma-text);overflow-wrap:anywhere}
.pma-git-info b{color:var(--pma-ink);font-weight:600}
.pma-git .piecemaker-button{flex:0 0 auto}
.pma-git + .pma-grid{padding-top:14px}
.pma-view{flex:1;display:grid;grid-template-columns:1fr;min-height:0}
.pma-view.with-comments{grid-template-columns:1fr 300px}
.pma-view iframe{width:100%;height:100%;min-height:480px;border:0;background:#fff}
.pma-comments{border-left:1px solid var(--pma-border);background:var(--pma-surface);padding:12px 16px;overflow:auto}
.pma-comments h3{margin:0 0 8px;font-size:14px;font-weight:600;color:var(--pma-ink)}
.pma-comments form{display:flex;flex-direction:column;gap:6px;margin-bottom:12px}
.pma-textarea{width:100%;box-sizing:border-box;min-height:90px;border:1px solid var(--pma-border);border-radius:.75rem;background:var(--pma-bg);color:var(--pma-text);padding:9px 11px;font:inherit;resize:vertical}
.pma-comments ul{list-style:none;margin:0;padding:0}
.pma-comments summary{margin-bottom:8px;color:var(--pma-muted);font-size:12px;cursor:pointer}
.pma-thread{border:1px solid var(--pma-border);border-radius:10px;padding:9px 10px;margin-bottom:8px;background:var(--pma-bg)}
.pma-thread p{margin:0 0 4px;white-space:pre-wrap;font-size:13px;line-height:1.45}
.pma-thread p b{color:var(--pma-ink);font-weight:600}
.pma-thread.resolved{opacity:.6}
.pma-tag{display:inline-block;margin-bottom:4px;padding:1px 6px;border:1px solid var(--pma-border);border-radius:4px;background:var(--pma-soft);color:var(--pma-text);font-size:11px}
.pma-tab:focus-visible,.pma-icon-button:focus-visible,.pma-select:focus-visible,.pma-textarea:focus-visible,.pma-bar .piecemaker-button:focus-visible{outline:none;box-shadow:0 0 0 2px rgb(0 136 255 / 40%),0 0 0 4px var(--pma-bg)}
.pma-select:focus-visible,.pma-textarea:focus-visible{border-color:color-mix(in srgb,var(--pma-accent) 55%,var(--pma-border))}
@media (max-width:760px){
  .pma-bar{padding:8px 10px;gap:8px}
  .pma-grid{padding:14px}
  .pma-view.with-comments{grid-template-columns:1fr}
  .pma-comments{border-left:0;border-top:1px solid var(--pma-border)}
}
`;
