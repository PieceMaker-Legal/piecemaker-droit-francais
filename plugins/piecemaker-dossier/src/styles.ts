export const PLUGIN_STYLES = `
.pmd-root{
  height:100%;
  display:flex;
  flex-direction:column;
  background:hsl(var(--background));
  color:var(--piecemaker-text,#374151);
  font:14px/1.45 var(--piecemaker-font-ui,Inter,ui-sans-serif,system-ui,sans-serif);
  --pmd-bg:hsl(var(--background));
  --pmd-surface:hsl(var(--card));
  --pmd-soft:hsl(var(--muted));
  --pmd-border:var(--piecemaker-border,#e5e7eb);
  --pmd-text:var(--piecemaker-text,#374151);
  --pmd-muted:var(--piecemaker-muted,#6b7280);
  --pmd-ink:var(--piecemaker-ink,#111827);
  --pmd-accent:var(--piecemaker-blue,rgb(0 136 255));
  --pmd-danger:#9f3b3b;
  --pmd-client:#4b5563;
  --pmd-adverse:#6b5e58;
  --pmd-radius:12px;
  --pmd-glass-bg:var(--liquid-glass-background-subtle,rgb(255 255 255 / .78));
  --pmd-glass-border:var(--liquid-glass-border-subtle,rgb(229 231 235 / .9));
  --pmd-glass-shadow:var(--liquid-glass-shadow-subtle,inset 0 1px 0 rgb(255 255 255 / .8),0 1px 2px rgb(15 23 42 / .05));
}
.pmd-root[data-theme=dark]{
  --pmd-bg:hsl(var(--background));
  --pmd-surface:hsl(var(--card));
  --pmd-soft:hsl(var(--muted));
  --pmd-border:hsl(var(--border));
  --pmd-text:hsl(var(--foreground));
  --pmd-muted:hsl(var(--muted-foreground));
  --pmd-ink:hsl(var(--foreground));
  --pmd-danger:#d7a3a3;
  --pmd-client:#9ca3af;
  --pmd-adverse:#b8a9a2;
  --pmd-glass-bg:var(--liquid-glass-background-subtle,rgb(24 28 36 / .72));
  --pmd-glass-border:var(--liquid-glass-border-subtle,rgb(255 255 255 / .08));
  --pmd-glass-shadow:var(--liquid-glass-shadow-subtle,inset 0 1px 0 rgb(255 255 255 / .06),0 1px 2px rgb(0 0 0 / .35));
}
.pmd-root[data-theme=dark] .piecemaker-button--glass{color:var(--pmd-text)}
.pmd-header{display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--pmd-border)}
.pmd-tabs{display:flex;align-items:center;gap:3px;padding:3px;border:1px solid var(--pmd-glass-border);border-radius:9999px;background:var(--pmd-glass-bg);box-shadow:var(--pmd-glass-shadow);backdrop-filter:blur(20px)}
.pmd-tab{display:flex;flex-shrink:0;align-items:center;gap:6px;height:1.75rem;box-sizing:border-box;border:0;border-radius:9999px;background:transparent;color:var(--pmd-muted);padding:0 .75rem;font:500 12px var(--piecemaker-font-ui,inherit);cursor:pointer;white-space:nowrap;outline:0}
.pmd-tab svg{width:14px;height:14px;flex-shrink:0}
.pmd-tab[aria-selected=true]{color:var(--pmd-ink);box-shadow:inset 0 0 0 1px rgb(var(--piecemaker-ink-rgb,17 24 39) / 22%);font-weight:600}
.pmd-tab:hover[aria-selected=false]{color:var(--pmd-text);background:rgb(255 255 255 / 10%)}
.pmd-button{display:inline-flex;align-items:center;justify-content:center;gap:.375rem;height:1.75rem;padding-inline:.75rem;border:1px solid var(--pmd-glass-border);border-radius:9999px;background:var(--pmd-glass-bg);box-shadow:var(--pmd-glass-shadow);color:var(--pmd-text);font:500 12px var(--piecemaker-font-ui,inherit);cursor:pointer;white-space:nowrap;backdrop-filter:blur(20px);transition:filter 150ms ease,transform 150ms ease}
.pmd-button:hover{filter:brightness(.97);color:var(--pmd-text)}
.pmd-button:active{transform:scale(.98)}
.pmd-button:disabled{cursor:not-allowed;opacity:.4}
.pmd-button-primary{background:rgb(3 7 18 / 88%);border-color:transparent;color:#fff;box-shadow:none;backdrop-filter:none}
.pmd-button-danger{color:var(--pmd-danger)}
.pmd-tab:focus-visible,.pmd-button:focus-visible,.pmd-icon-button:focus-visible,.pmd-profile-menu-trigger:focus-visible{outline:none;box-shadow:0 0 0 2px rgb(0 136 255 / 40%),0 0 0 4px var(--pmd-bg)}
.pmd-icon-button{display:inline-flex;align-items:center;justify-content:center;width:1.5rem;height:1.5rem;padding:0;border:0;border-radius:9999px;background:transparent;color:var(--pmd-muted);cursor:pointer}
.pmd-icon-button:hover{color:var(--pmd-text);background:var(--pmd-soft)}
.pmd-icon-button svg{display:block;width:16px;height:16px}
.pmd-spacer{flex:1}
.pmd-scan-status{margin-left:auto;display:flex;height:32px;flex-shrink:0;align-items:center;gap:8px;border:1px solid var(--pmd-glass-border);border-radius:9999px;padding:0 6px 0 12px;background:var(--pmd-glass-bg);box-shadow:var(--pmd-glass-shadow);backdrop-filter:blur(20px);font-size:12px}
.pmd-status-icon{display:inline-flex;color:var(--pmd-muted)}
.pmd-status-icon svg{width:14px;height:14px}
.pmd-status-label{white-space:nowrap;color:var(--pmd-muted);font-weight:500}
.pmd-scan-button{height:1.5rem;gap:6px}
.pmd-scan-button svg{width:12px;height:12px}
.pmd-scan-progress{display:flex;min-width:128px;align-items:center;gap:8px}
.pmd-scan-progress-label{white-space:nowrap;color:var(--pmd-muted);font-size:11px;font-variant-numeric:tabular-nums}
.pmd-scan-progress-track{display:block;flex:1;height:3px;overflow:hidden;border-radius:999px;background:var(--pmd-soft)}
.pmd-scan-progress-bar{display:block;height:100%;border-radius:999px;background:var(--pmd-accent);transition:width .5s}
.pmd-scan-cancel{display:flex;width:18px;height:18px;align-items:center;justify-content:center;border:0;border-radius:999px;background:transparent;color:var(--pmd-muted);cursor:pointer;font-size:14px;line-height:1}
.pmd-scan-cancel:hover{background:var(--pmd-soft);color:var(--pmd-text)}
.pmd-workspace{min-height:0;display:flex;flex:1;overflow:hidden}
.pmd-content{min-width:0;min-height:0;flex:1;overflow:auto;padding:22px 24px}
.pmd-content:has(.pmd-general){padding:18px 22px}
.pmd-toolbar{display:flex;align-items:flex-end;gap:12px;margin-bottom:20px}
.pmd-title{margin:0;font-family:var(--piecemaker-font-editorial,EB Garamond,Georgia,serif);font-size:1.35rem;font-weight:500;letter-spacing:-.02em;color:var(--pmd-ink)}
.pmd-subtitle{margin-top:4px;color:var(--pmd-muted);font-size:12px}
.pmd-error{margin:12px 22px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--pmd-danger) 35%,var(--pmd-border));border-radius:10px;background:color-mix(in srgb,var(--pmd-danger) 6%,var(--pmd-surface));color:var(--pmd-danger);font-size:13px}
.pmd-empty,.pmd-no-parties{min-height:280px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;color:var(--pmd-muted)}
.pmd-no-parties{border:1px dashed var(--pmd-border);border-radius:16px;background:color-mix(in srgb,var(--pmd-soft) 40%,transparent);padding:32px 24px}
.pmd-no-parties svg{width:22px;height:22px;color:var(--pmd-muted)}
.pmd-no-parties h3{margin:14px 0 0;font-size:1.35rem;font-weight:500;color:var(--pmd-ink)}
.pmd-no-parties p{max-width:380px;margin:8px 0 18px;font-size:13px;line-height:1.6}
.pmd-card{background:var(--pmd-surface);border:1px solid var(--pmd-border);border-radius:var(--pmd-radius);padding:14px 16px}
.pmd-card-head{display:flex;gap:10px;align-items:flex-start}
.pmd-card-title{font-size:14px;font-weight:600;line-height:1.35;overflow-wrap:anywhere;color:var(--pmd-ink)}
.pmd-agents-button,.pmd-small-button{display:inline-flex;align-items:center;gap:6px}
.pmd-small-button{height:32px;padding:0 12px;font-size:12px}
.pmd-small-button svg{width:14px;height:14px}
.pmd-general{display:flex;min-height:0;height:100%;flex-direction:column;gap:18px}
.pmd-general-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
.pmd-party-layout{display:grid;min-height:0;grid-template-columns:minmax(0,1fr) minmax(220px,300px);flex:1;gap:22px}
.pmd-party-layout[data-tiers-collapsed=true]{grid-template-columns:minmax(0,1fr) 40px}
.pmd-party-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;min-height:0;overflow:auto;align-content:start}
.pmd-party-column{display:flex;flex-direction:column;gap:12px}
.pmd-party-column>h3{margin:0 2px 2px;font-size:1.2rem;font-weight:500;letter-spacing:-.02em;color:var(--pmd-ink)}
.pmd-column-empty{border:1px dashed var(--pmd-border);border-radius:var(--pmd-radius);padding:14px 16px;color:var(--pmd-muted);font-size:12px}
button.pmd-column-empty{display:flex;width:100%;box-sizing:border-box;flex-direction:column;align-items:flex-start;gap:4px;background:transparent;font:inherit;text-align:left;cursor:pointer}
button.pmd-column-empty:hover{border-color:color-mix(in srgb,var(--pmd-accent) 40%,var(--pmd-border));background:color-mix(in srgb,var(--pmd-soft) 55%,transparent)}
button.pmd-column-empty[data-drop-active=true]{border-color:var(--pmd-accent);background:color-mix(in srgb,var(--pmd-accent) 6%,var(--pmd-surface))}
button.pmd-column-empty span{font-size:12px;color:var(--pmd-text)}
button.pmd-column-empty small{color:var(--pmd-muted);font-size:11px}
.pmd-profile-card{position:relative;display:flex;flex-direction:column;overflow:visible;border:1px solid var(--pmd-border);border-radius:16px;background:var(--pmd-surface);box-shadow:var(--pmd-glass-shadow)}
.pmd-profile-card:has(.pmd-profile-menu[data-open=true]){z-index:20}
.pmd-profile-card[data-side=client]{border-left:2px solid var(--pmd-client)}
.pmd-profile-card[data-side=adverse]{border-left:2px solid var(--pmd-adverse)}
.pmd-profile-accent{display:none}
.pmd-profile-card .pmd-card-head{padding:14px 16px 10px}
.pmd-kind-icon{display:flex;width:36px;height:36px;flex:0 0 36px;align-items:center;justify-content:center;border-radius:10px;background:var(--pmd-soft);color:var(--pmd-muted)}
.pmd-kind-icon svg{width:18px;height:18px}
.pmd-profile-heading{min-width:0;flex:1}
.pmd-profile-kind{margin-top:3px;color:var(--pmd-muted);font-size:11px}
.pmd-profile-menu-wrap{position:relative;margin-left:auto}
.pmd-profile-menu-trigger{display:flex;width:28px;height:28px;align-items:center;justify-content:center;border:0;border-radius:999px;background:transparent;color:var(--pmd-muted);cursor:pointer}
.pmd-profile-menu-trigger:hover{background:var(--pmd-soft);color:var(--pmd-text)}
.pmd-profile-menu-trigger svg{width:16px;height:16px}
.pmd-profile-menu{position:absolute;z-index:8;top:32px;right:0;display:none;min-width:156px;border:1px solid var(--pmd-glass-border);border-radius:12px;background:var(--pmd-bg);padding:4px;box-shadow:0 12px 32px rgb(15 23 42 / .12)}
.pmd-profile-menu[data-open=true]{display:block}
.pmd-profile-menu button{display:flex;width:100%;align-items:center;gap:8px;border:0;border-radius:8px;background:transparent;color:var(--pmd-text);padding:8px 10px;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.pmd-profile-menu button:hover{background:var(--pmd-soft)}
.pmd-profile-menu button svg{width:14px;height:14px}
.pmd-profile-menu .pmd-menu-danger{color:var(--pmd-danger)}
.pmd-party-line{padding:0 16px 12px}
.pmd-party-badge{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--pmd-glass-border);border-radius:999px;background:var(--pmd-glass-bg);padding:4px 6px 4px 10px;color:var(--pmd-muted);font-size:11px;font-weight:500}
.pmd-party-badge[data-side=client]{color:var(--pmd-client)}
.pmd-party-badge[data-side=adverse]{color:var(--pmd-adverse)}
.pmd-party-badge-remove{display:flex;width:16px;height:16px;align-items:center;justify-content:center;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;font:inherit;line-height:1}
.pmd-party-badge-remove:hover{background:var(--pmd-soft)}
.pmd-relations-box{margin:0 16px 12px;padding:10px;border:1px dashed var(--pmd-border);border-radius:12px;background:color-mix(in srgb,var(--pmd-soft) 35%,transparent)}
.pmd-relations-box:hover{border-color:color-mix(in srgb,var(--pmd-accent) 35%,var(--pmd-border))}
.pmd-related{display:flex;align-items:flex-start;gap:8px;border:1px solid var(--pmd-border);border-radius:10px;background:var(--pmd-surface);padding:8px 10px}
.pmd-related>div{min-width:0;flex:1}
.pmd-related span,.pmd-related strong,.pmd-related small{display:block}
.pmd-related span{color:var(--pmd-muted);font-size:10px;letter-spacing:.04em;text-transform:uppercase}
.pmd-related strong{margin-top:3px;overflow-wrap:anywhere;font-size:12px;font-weight:600;color:var(--pmd-ink)}
.pmd-related small{margin-top:4px;color:var(--pmd-muted);font-size:11px}
.pmd-related>button{border:0;background:transparent;color:var(--pmd-muted);cursor:pointer}
.pmd-related>button:hover{color:var(--pmd-danger)}
.pmd-related-separator{height:8px}
.pmd-relation-empty,.pmd-drop-hint{text-align:center;color:var(--pmd-muted);font-size:11px;line-height:1.45}
.pmd-drop-hint{margin-top:8px;font-size:10px}
.pmd-hint{margin:0;color:var(--pmd-muted);font-size:12px;line-height:1.5}
.pmd-company-enrichment{margin:0 16px 14px;padding-top:10px;border-top:1px solid var(--pmd-border)}
.pmd-company-enrichment-row{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.pmd-company-enrichment-row p{min-width:0;flex:1 1 120px;margin:0;color:var(--pmd-muted);font-size:11px}
.pmd-company-enrichment-row .pmd-button{height:28px;padding:0 10px;font-size:11px}
.pmd-company-enrichment-row .pmd-button svg{width:14px;height:14px}
.pmd-bodacc-accordion{border:1px solid var(--pmd-border);border-radius:10px;overflow:hidden;background:color-mix(in srgb,var(--pmd-soft) 30%,transparent)}
.pmd-bodacc-accordion summary{padding:8px 12px;color:var(--pmd-muted);font-size:11px;cursor:pointer}
.pmd-bodacc-content{padding:0 12px 12px}
.pmd-bodacc-status,.pmd-bodacc-summary{margin:8px 0 0;color:var(--pmd-muted);font-size:11px}
.pmd-bodacc-error{color:var(--pmd-danger)}
.pmd-bodacc-alerts{display:grid;gap:6px;margin-top:10px}
.pmd-bodacc-alerts span{border-radius:8px;background:color-mix(in srgb,var(--pmd-danger) 8%,var(--pmd-surface));color:var(--pmd-danger);padding:8px 10px;font-size:11px}
.pmd-bodacc-list{display:grid;gap:8px;margin-top:10px}
.pmd-bodacc-announcement{border:1px solid var(--pmd-border);border-radius:10px;background:var(--pmd-surface);padding:10px 12px}
.pmd-bodacc-announcement-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.pmd-bodacc-announcement-head strong{font-size:12px;font-weight:600;color:var(--pmd-ink)}
.pmd-bodacc-announcement-head time{color:var(--pmd-muted);font-size:10px}
.pmd-bodacc-announcement dl{display:grid;gap:5px;margin:8px 0 0}
.pmd-bodacc-announcement dl div{display:grid;grid-template-columns:82px minmax(0,1fr);gap:8px;font-size:11px}
.pmd-bodacc-announcement dt{color:var(--pmd-muted);font-size:10px;letter-spacing:.04em;text-transform:uppercase}
.pmd-bodacc-announcement dd{margin:0;overflow-wrap:anywhere}
.pmd-bodacc-announcement a,.pmd-company-result-link{display:inline-block;margin-top:8px;color:var(--pmd-accent);font-size:11px}
.pmd-company-result{display:grid;gap:8px;border-bottom:1px solid var(--pmd-border);padding:12px 2px}
.pmd-company-result:last-child{border-bottom:0}
.pmd-company-result h4{margin:0;font-size:13px;font-weight:600;color:var(--pmd-ink)}
.pmd-company-result>p{margin:0;color:var(--pmd-muted);font-size:11px;line-height:1.45}
.pmd-company-result dl{display:grid;gap:5px;margin:0}
.pmd-company-result dl div{display:grid;grid-template-columns:72px minmax(0,1fr);gap:7px;font-size:11px}
.pmd-company-result dt{color:var(--pmd-muted);font-size:10px;letter-spacing:.04em;text-transform:uppercase}
.pmd-company-result dd{min-width:0;margin:0;overflow-wrap:anywhere}
.pmd-company-result details{font-size:11px}
.pmd-company-result details summary{color:var(--pmd-muted);cursor:pointer}
.pmd-company-result details pre{max-height:180px;overflow:auto;margin:7px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--pmd-muted);font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace}
.pmd-company-validate{width:100%;font-size:11px}
.pmd-tiers-column{display:flex;min-width:0;min-height:0;flex-direction:column;overflow:hidden;border:1px solid var(--pmd-border);border-radius:16px;background:var(--pmd-surface)}
.pmd-tiers-toggle{display:flex;min-height:46px;flex-shrink:0;align-items:center;gap:8px;border:0;border-bottom:1px solid var(--pmd-border);background:transparent;color:var(--pmd-text);padding:10px 14px;text-align:left;cursor:pointer}
.pmd-tiers-toggle:hover{background:var(--pmd-soft)}
.pmd-tiers-chevron{width:15px;height:15px;flex-shrink:0;color:var(--pmd-muted)}
.pmd-tiers-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin:0;font-family:var(--piecemaker-font-editorial,EB Garamond,Georgia,serif);font-size:1.05rem;font-weight:500;letter-spacing:-.02em;text-transform:none;color:var(--pmd-ink)}
.pmd-tiers-count{display:flex;min-width:22px;height:22px;align-items:center;justify-content:center;margin-left:auto;border:1px solid var(--pmd-border);border-radius:999px;background:var(--pmd-soft);color:var(--pmd-muted);font-size:10px;font-weight:500}
.pmd-tiers-content{display:flex;flex:1;flex-direction:column;gap:8px;min-height:0;overflow:auto;padding:10px;scrollbar-width:thin;scrollbar-color:var(--pmd-border) transparent}
.pmd-tiers-column[data-collapsed=true] .pmd-tiers-toggle{height:100%;flex-direction:column;justify-content:flex-start;padding:12px 7px;border-bottom:0}
.pmd-tiers-column[data-collapsed=true] .pmd-tiers-label{display:none}
.pmd-tiers-column[data-collapsed=true] .pmd-tiers-toggle .pmd-tiers-count{margin-left:0}
.pmd-tiers-column[data-collapsed=true] .pmd-tiers-content{display:none}
.pmd-tiers-content>.pmd-profile-card{min-height:0;flex-shrink:0;border-radius:12px;box-shadow:none}
.pmd-tiers-content>.pmd-profile-card .pmd-card-head{align-items:center;gap:8px;padding:10px 10px 10px 12px}
.pmd-tiers-content>.pmd-profile-card .pmd-kind-icon{width:30px;height:30px;flex-basis:30px;border-radius:8px}
.pmd-tiers-content>.pmd-profile-card .pmd-kind-icon svg{width:15px;height:15px}
.pmd-tiers-content>.pmd-profile-card .pmd-card-title{font-size:12px}
.pmd-tiers-content>.pmd-profile-card .pmd-profile-kind{font-size:10px}
.pmd-summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:22px}
.pmd-metric{padding:14px 16px;border:1px solid var(--pmd-border);border-radius:14px;background:var(--pmd-surface);box-shadow:var(--pmd-glass-shadow)}
.pmd-metric strong{display:block;font-family:var(--piecemaker-font-editorial,EB Garamond,Georgia,serif);font-size:1.6rem;font-weight:500;letter-spacing:-.03em;color:var(--pmd-ink)}
.pmd-metric span{color:var(--pmd-muted);font-size:11px}
.pmd-chronology-section+.pmd-chronology-section{margin-top:28px}
.pmd-chronology-section-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:14px}
.pmd-chronology-section-heading h3{margin:0;font-size:1.15rem;font-weight:500;letter-spacing:-.02em;color:var(--pmd-ink)}
.pmd-chronology-section-heading p{margin:4px 0 0;color:var(--pmd-muted);font-size:12px}
.pmd-section-count{display:flex;min-width:24px;height:24px;align-items:center;justify-content:center;border:1px solid var(--pmd-border);border-radius:999px;background:var(--pmd-soft);color:var(--pmd-muted);font-size:11px}
.pmd-timeline{position:relative;display:grid;gap:14px;padding-left:118px}
.pmd-timeline:before{content:'';position:absolute;left:102px;top:12px;bottom:12px;width:1px;background:var(--pmd-border)}
.pmd-chronology-event{position:relative;cursor:pointer}
.pmd-chronology-marker{position:absolute;left:-21px;top:18px;width:8px;height:8px;border:2px solid var(--pmd-bg);border-radius:50%;background:color-mix(in srgb,var(--pmd-ink) 35%,var(--pmd-border))}
.pmd-chronology-event[data-dated=false] .pmd-chronology-marker{background:var(--pmd-muted)}
.pmd-chronology-date{position:absolute;right:calc(100% + 32px);top:14px;width:86px;color:var(--pmd-muted);font-size:11px;font-weight:500;text-align:right}
.pmd-chronology-document{border-radius:14px;padding:14px 16px}
.pmd-document-heading{min-width:0;flex:1}
.pmd-document-meta{margin-top:4px;color:var(--pmd-muted);font-size:11px}
.pmd-document-fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px;margin:12px 0 0}
.pmd-document-fields div{border-radius:8px;background:var(--pmd-soft);padding:8px 10px}
.pmd-document-fields dt{color:var(--pmd-muted);font-size:10px;letter-spacing:.04em;text-transform:uppercase}
.pmd-document-fields dd{margin:4px 0 0;font-size:12px}
.pmd-document-related{margin-top:12px;padding-top:10px;border-top:1px solid var(--pmd-border)}
.pmd-document-related-label{color:var(--pmd-muted);font-size:10px;letter-spacing:.04em;text-transform:uppercase}
.pmd-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.pmd-badge{background:var(--pmd-soft);border:1px solid var(--pmd-border);border-radius:999px;padding:3px 8px;color:var(--pmd-text);font-size:11px}
.pmd-badge-muted{color:var(--pmd-muted)}
.pmd-chronology-event [data-edit-document]{position:relative;z-index:1}
.pmd-modal{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:20px;background:rgb(17 24 39 / .16)}
.pmd-dialog{width:min(680px,100%);max-height:85%;overflow:auto;border:1px solid var(--pmd-glass-border);border-radius:1rem;background:var(--pmd-bg);padding:20px;box-shadow:0 18px 50px rgb(15 23 42 / .12)}
.pmd-dialog-compact{width:min(400px,100%);padding:22px}
.pmd-confirm{display:grid;gap:14px}
.pmd-confirm .pmd-title{font-size:1.25rem}
.pmd-confirm .pmd-form-actions{margin-top:2px}
.pmd-form{display:grid;gap:12px}
.pmd-form-section{display:grid;gap:12px;padding-bottom:16px;border-bottom:1px solid var(--pmd-border)}
.pmd-form-section:last-of-type{border-bottom:0;padding-bottom:0}
.pmd-form-section h3{margin:0;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--pmd-muted)}
.pmd-form-note{margin:0;color:var(--pmd-muted);font-size:12px;line-height:1.5}
.pmd-form label{display:grid;gap:5px;color:var(--pmd-muted);font-size:12px}
.pmd-input,.pmd-select,.pmd-textarea{width:100%;box-sizing:border-box;border:1px solid var(--pmd-border);border-radius:.75rem;background:var(--pmd-surface);color:var(--pmd-text);padding:9px 11px;font:inherit;box-shadow:none}
.pmd-input:focus,.pmd-select:focus,.pmd-textarea:focus,.pmd-mapping-input:focus{border-color:color-mix(in srgb,var(--pmd-accent) 55%,var(--pmd-border));outline:2px solid rgb(0 136 255 / 18%)}
.pmd-textarea{min-height:90px;resize:vertical}
.pmd-alias-editor{display:flex;min-height:42px;flex-wrap:wrap;align-items:center;gap:6px;border:1px solid var(--pmd-border);border-radius:10px;background:var(--pmd-surface);padding:6px}
.pmd-alias-pills{display:flex;flex-wrap:wrap;gap:6px}
.pmd-alias-pill{display:inline-flex;max-width:100%;align-items:center;gap:5px;border:1px solid var(--pmd-border);border-radius:999px;background:var(--pmd-soft);color:var(--pmd-text);padding:4px 6px 4px 9px;font-size:11px;overflow-wrap:anywhere}
.pmd-alias-pill button{display:inline-flex;width:17px;height:17px;align-items:center;justify-content:center;border:0;border-radius:50%;background:transparent;color:var(--pmd-muted);padding:0;cursor:pointer;font:inherit;line-height:1}
.pmd-alias-pill button:hover{background:var(--pmd-bg);color:var(--pmd-danger)}
.pmd-alias-input{min-width:150px;flex:1;border:0;background:transparent;padding:4px;outline:0}
.pmd-current-relations{border:1px solid var(--pmd-border);border-radius:12px;background:color-mix(in srgb,var(--pmd-soft) 40%,transparent);padding:0 10px 10px}
.pmd-group{display:flex;align-items:center;gap:7px;margin:12px 0 9px;font-size:11px;color:var(--pmd-muted);letter-spacing:.04em;text-transform:uppercase}
.pmd-group-count{display:inline-flex;min-width:20px;height:20px;align-items:center;justify-content:center;border:1px solid var(--pmd-border);border-radius:999px;background:var(--pmd-surface);color:var(--pmd-muted);font-size:10px;letter-spacing:0}
.pmd-relation-list{display:grid;gap:7px}
.pmd-relation-row{display:flex;width:100%;box-sizing:border-box;align-items:center;gap:10px;border:1px solid var(--pmd-border);border-radius:10px;background:var(--pmd-surface);color:var(--pmd-text);padding:9px 10px;text-align:left;cursor:pointer}
.pmd-relation-row:hover{border-color:color-mix(in srgb,var(--pmd-accent) 40%,var(--pmd-border));background:color-mix(in srgb,var(--pmd-soft) 50%,var(--pmd-surface))}
.pmd-relation-copy{min-width:0;flex:1}
.pmd-relation-type,.pmd-relation-target,.pmd-relation-kind{display:block}
.pmd-relation-type{color:var(--pmd-muted);font-size:10px;font-weight:600;letter-spacing:.04em}
.pmd-relation-target{margin-top:3px;overflow-wrap:anywhere;font-size:12px;font-weight:600;color:var(--pmd-ink)}
.pmd-relation-kind{margin-top:3px;color:var(--pmd-muted);font-size:10px}
.pmd-relation-remove{display:flex;width:22px;height:22px;flex-shrink:0;align-items:center;justify-content:center;border-radius:50%;color:var(--pmd-muted);font-size:16px;line-height:1}
.pmd-relation-row:hover .pmd-relation-remove{background:color-mix(in srgb,var(--pmd-danger) 10%,transparent);color:var(--pmd-danger)}
.pmd-form-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
.pmd-terms-editor{display:grid;gap:4px}
.pmd-terms-list{max-height:340px;overflow-y:auto;align-content:flex-start}
.pmd-terms-status{min-height:16px;color:var(--pmd-muted);font-size:12px}
.pmd-terms-status[data-error=true]{color:var(--pmd-danger)}
.pmd-party-picker{width:100%}
.pmd-party-picker-options{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.pmd-party-picker-option{display:flex;align-items:center;gap:10px;border:1px solid var(--pmd-border);border-radius:12px;background:var(--pmd-surface);color:var(--pmd-text);padding:12px;text-align:left;cursor:pointer}
.pmd-party-picker-option:hover{border-color:color-mix(in srgb,var(--pmd-accent) 35%,var(--pmd-border));background:var(--pmd-soft)}
.pmd-party-picker-option strong,.pmd-party-picker-option small{display:block}
.pmd-party-picker-option strong{font-size:13px;font-weight:600;color:var(--pmd-ink)}
.pmd-party-picker-option small{margin-top:3px;color:var(--pmd-muted);font-size:11px}
.pmd-party-picker-icon{display:flex;width:32px;height:32px;flex-shrink:0;align-items:center;justify-content:center;border-radius:9px;background:var(--pmd-soft);color:var(--pmd-muted);font-size:16px}
.pmd-siren-suggestions{display:grid;gap:4px;margin-top:4px;padding:5px;border:1px solid var(--pmd-border);border-radius:10px;background:var(--pmd-bg);box-shadow:0 8px 20px rgb(15 23 42 / .08)}
.pmd-siren-suggestion{border:0;border-radius:7px;background:transparent;color:var(--pmd-text);padding:7px 8px;font:inherit;font-size:12px;text-align:left;cursor:pointer}
.pmd-siren-suggestion:hover{background:var(--pmd-soft)}
.pmd-siren-no-match{padding:6px;color:var(--pmd-muted);font-size:11px}
.pmd-back-button{padding:5px 8px;font-size:12px}
.pmd-dialog:has(.pmd-mapping-dialog){display:flex;width:min(1024px,100%);max-height:90%;overflow:hidden;padding:0}
.pmd-mapping-dialog{display:flex;min-height:0;width:100%;flex-direction:column}
.pmd-mapping-header,.pmd-mapping-footer{display:flex;flex-shrink:0;align-items:center;gap:10px;padding:16px 20px}
.pmd-mapping-header{border-bottom:1px solid var(--pmd-border)}
.pmd-mapping-header h2{flex:1;margin:0;font-size:1.3rem;font-weight:500;letter-spacing:-.02em;color:var(--pmd-ink)}
.pmd-mapping-footer{justify-content:flex-end;border-top:1px solid var(--pmd-border)}
.pmd-mapping-body{min-height:0;flex:1;overflow:auto;padding:18px 20px}
.pmd-mapping-body>p{margin:0 0 20px;color:var(--pmd-muted);font-size:12px;line-height:1.55}
.pmd-mapping-category+.pmd-mapping-category{margin-top:22px}
.pmd-mapping-category>header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
.pmd-mapping-category h3{margin:0;font-size:13px;font-weight:600;color:var(--pmd-ink)}
.pmd-mapping-category h3 span{margin-left:7px;color:var(--pmd-muted);font-size:12px;font-weight:400}
.pmd-mapping-category>div{display:grid;gap:8px}
.pmd-mapping-legend{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1fr) minmax(0,1.5fr) 32px;gap:8px;padding:0 8px 6px;color:var(--pmd-muted);font-size:10px;letter-spacing:.04em;text-transform:uppercase}
.pmd-mapping-row{display:grid!important;grid-template-columns:minmax(0,.9fr) minmax(0,1fr) minmax(0,1.5fr) 32px;gap:8px;align-items:start;width:100%;border:1px solid var(--pmd-border);border-radius:10px;background:var(--pmd-surface);color:var(--pmd-text);padding:8px;text-align:left;cursor:default}
.pmd-mapping-row .pmd-alias-editor{min-height:0;padding:4px;background:var(--pmd-bg)}
.pmd-mapping-input{min-width:0;width:100%;box-sizing:border-box;border:1px solid var(--pmd-border);border-radius:8px;background:var(--pmd-bg);color:var(--pmd-text);padding:7px 9px;font:12px inherit}
.pmd-mapping-actions{position:relative;display:flex;align-items:center;justify-content:flex-end;min-width:32px;width:32px;border:0!important;background:transparent!important;padding:0!important;overflow:visible!important}
.pmd-mapping-actions .pmd-profile-menu-wrap{display:flex;margin-left:0}
.pmd-mapping-actions .pmd-profile-menu[data-drop=up]{top:auto;bottom:34px}
.pmd-dialog-columns{display:flex;min-height:0;gap:18px}
.pmd-dialog-columns>.pmd-form{min-width:0;flex:1}
.pmd-company-search{display:flex;width:340px;min-width:280px;max-height:calc(85vh - 96px);flex-direction:column;overflow:hidden;border:1px solid var(--pmd-border);border-radius:12px;background:var(--pmd-surface)}
.pmd-company-search[hidden]{display:none}
.pmd-company-search-header{display:flex;flex-shrink:0;align-items:center;border-bottom:1px solid var(--pmd-border);padding:12px}
.pmd-company-search-header h3{margin:0;font-size:13px;font-weight:600;color:var(--pmd-ink)}
.pmd-company-search-header p{margin:3px 0 0;color:var(--pmd-muted);font-size:11px}
.pmd-company-search-results{min-height:0;overflow:auto;padding:10px}
.pmd-company-search-status{margin:8px 2px;color:var(--pmd-muted);font-size:11px}
.pmd-company-search-error{color:var(--pmd-danger)}
.pmd-dialog:has(.pmd-document-dialog){display:flex;width:min(1152px,100%);height:min(85vh,900px);max-height:85vh;box-sizing:border-box;overflow:hidden;padding:0;background:transparent;border:0;box-shadow:none}
.pmd-document-dialog{display:flex;height:100%;width:100%;box-sizing:border-box;max-height:100%;flex-direction:column;overflow:hidden;border:1px solid var(--pmd-border);border-radius:16px;background:var(--pmd-bg);color:var(--pmd-text);box-shadow:0 18px 50px rgb(15 23 42 / .16)}
.pmd-sr-only{position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;padding:0}
.pmd-document-dialog-body{display:flex;min-height:0;flex:1}
.pmd-document-preview-pane{display:flex;min-width:0;flex:1;flex-direction:column;border-right:1px solid var(--pmd-border)}
.pmd-document-preview-header,.pmd-document-form-header{display:flex;min-height:48px;flex-shrink:0;align-items:center;gap:8px;border-bottom:1px solid var(--pmd-border);padding:12px 16px}
.pmd-document-file-icon{color:var(--pmd-muted)}
.pmd-document-file-name{min-width:0;margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600;color:var(--pmd-ink)}
.pmd-document-preview{min-height:0;flex:1;overflow:auto;background:color-mix(in srgb,var(--pmd-soft) 45%,transparent);padding:16px 24px}
.pmd-document-preview pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font:14px/1.65 var(--piecemaker-font-ui,Inter,ui-sans-serif,system-ui,sans-serif)}
.pmd-document-muted{margin:0;color:var(--pmd-muted);font-size:12px}
.pmd-highlight-person{border-radius:3px;background:color-mix(in srgb,var(--pmd-ink) 8%,transparent);padding:0 2px}
.pmd-highlight-date{border-radius:3px;background:color-mix(in srgb,var(--pmd-accent) 12%,transparent);padding:0 2px}
.pmd-highlight-fact{border-radius:3px;background:var(--pmd-soft);padding:0 2px}
.pmd-document-form{display:flex;width:380px;flex-shrink:0;flex-direction:column}
.pmd-document-form-header h3{margin:0;font-size:13px;font-weight:600;color:var(--pmd-ink)}
.pmd-document-form-body{min-height:0;flex:1;overflow:auto;padding:16px}
.pmd-document-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.pmd-document-grid label,.pmd-document-form-section>span{display:grid;gap:5px;color:var(--pmd-muted);font-size:11px;font-weight:600}
.pmd-document-grid .pmd-document-wide{grid-column:1/-1}
.pmd-document-form-section{margin-top:18px}
.pmd-document-entities{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;border:1px solid var(--pmd-border);border-radius:10px;padding:8px}
.pmd-document-entity{display:inline-flex;height:32px;align-items:center;justify-content:center;gap:7px;border:1px solid var(--pmd-border);border-radius:999px;background:var(--pmd-bg);color:var(--pmd-text);padding:0 12px;font:500 12px inherit;cursor:pointer}
.pmd-document-entity:hover{background:var(--pmd-soft)}
.pmd-document-entity.is-selected{border-color:transparent;background:var(--pmd-soft);color:var(--pmd-ink)}
.pmd-document-section-heading{display:flex;align-items:center;justify-content:space-between;gap:8px}
.pmd-document-field-row{display:flex;align-items:center;gap:8px;margin-top:8px}
.pmd-document-field-row .pmd-input:first-child{width:33%}
.pmd-document-field-row .pmd-input:nth-child(2){flex:1}
.pmd-document-form-actions{display:flex;flex-shrink:0;justify-content:flex-end;gap:8px;border-top:1px solid var(--pmd-border);padding:12px 16px}
.pmd-document-dialog .pmd-button{height:34px;padding:0 12px;font-size:12px}
.pmd-document-dialog .pmd-input,.pmd-document-dialog .pmd-select{height:36px;padding:7px 9px;font-size:12px}
@media(max-width:900px){.pmd-dialog-columns{display:block}.pmd-company-search{width:auto;max-height:38vh;margin-top:16px}}
@media(max-width:760px){
  .pmd-content{padding:14px}
  .pmd-header{gap:8px;padding:8px 10px}
  .pmd-status-label{display:none}
  .pmd-scan-progress{min-width:80px}
  .pmd-party-layout{display:flex;flex-direction:column;overflow:visible}
  .pmd-party-columns{grid-template-columns:1fr;overflow:visible}
  .pmd-tiers-column[data-collapsed=true] .pmd-tiers-toggle{height:auto;flex-direction:row;padding:10px 12px}
  .pmd-tiers-column[data-collapsed=true] .pmd-tiers-label{display:block}
  .pmd-tiers-column[data-collapsed=true] .pmd-tiers-toggle .pmd-tiers-count{margin-left:auto}
  .pmd-timeline{padding-left:20px}
  .pmd-timeline:before{left:5px}
  .pmd-chronology-marker{left:-19px}
  .pmd-chronology-date{position:static;width:auto;margin:0 0 6px;text-align:left}
  .pmd-document-dialog{height:100%;max-height:100%;border-radius:0}
  .pmd-document-dialog-body{flex-direction:column}
  .pmd-document-preview-pane{min-height:240px;border-right:0;border-bottom:1px solid var(--pmd-border)}
  .pmd-document-form{width:auto;min-height:280px}
  .pmd-document-grid{grid-template-columns:1fr}
}
`;
