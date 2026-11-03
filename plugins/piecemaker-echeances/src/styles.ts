export const STYLES = `
.pme{
  --font-sans:"Anthropic Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  --text-caption:400 .75rem/1.0625rem var(--font-sans);
  --text-footnote:400 .8125rem/1.0625rem var(--font-sans);
  --text-body:400 .875rem/1.25rem var(--font-sans);
  --text-heading:580 .9375rem/1.25rem var(--font-sans);
  --h-control:2rem;--h-control-sm:1.75rem;--radius:.5rem;--radius-sm:.375rem;--radius-card:.75rem;
  --surface-0:#f9f9f7;--surface-1:#fcfcfb;--surface-2:#fff;
  --text-primary:#0b0b0b;--text-secondary:#52514e;--text-muted:#898781;--text-disabled:rgba(11,11,11,.35);
  --text-accent:#184f95;--text-danger:#8e2626;--text-success:#006300;--text-warning:#734500;
  --border:rgba(11,11,11,.1);--border-strong:rgba(11,11,11,.2);--border-stronger:rgba(11,11,11,.4);
  --bg-neutral:rgba(11,11,11,.05);--bg-neutral-hover:rgba(11,11,11,.1);--fill-control:rgba(11,11,11,.1);
  --fill-primary:#0b0b0b;--on-primary:#fff;--fill-primary-hover:#383835;
  --fill-secondary:hsl(0 0% 100% / .1);--fill-secondary-ring:rgba(11,11,11,.1);--fill-field:hsl(0 0% 100% / .5);
  --fill-accent:#2a78d6;--bg-accent:#cde2fb;--bg-danger:#fad6d6;--bg-warning:#f9dca4;--bg-success:#caeac7;
  --fill-danger:#d03b3b;--fill-warning:#fab219;
  --shadow-sm:0 1px 2px 0 rgba(11,11,11,.06),0 2px 8px 0 rgba(11,11,11,.08);
  --shadow-popover:0 8px 24px rgb(0 0 0 / .12),0 2px 6px rgb(0 0 0 / .08);
  --focus-shadow:inset 0 0 0 1px #f9f9f7,0 0 0 1px #2a78d6,0 0 6px 1px #cde2fb;
  --ring:0 0 0 1px rgba(11,11,11,.1);
  --muted:var(--text-muted);--ko:var(--text-danger);--warn:var(--text-warning);
  --ptr-bg:var(--surface-0);--ptr-surface:var(--surface-1);--ptr-soft:var(--bg-neutral);--ptr-border:var(--border);
  --ptr-text:var(--text-primary);--ptr-muted:var(--text-muted);--ptr-accent:var(--text-accent);--ptr-danger:var(--text-danger);--ptr-warning:var(--text-warning);
  height:100%;display:flex;flex-direction:column;min-height:0;overflow-wrap:anywhere;
  background:var(--surface-0);color:var(--text-primary);font:var(--text-body);
  -webkit-font-smoothing:antialiased;color-scheme:light
}
.pme[data-theme=dark]{
  color-scheme:dark;
  --surface-0:#0b0b0b;--surface-1:#151515;--surface-2:#1a1a19;
  --text-primary:#f0efec;--text-secondary:#c3c2b7;--text-muted:#898781;--text-disabled:rgba(255,255,255,.35);
  --text-accent:#6da7ec;--text-danger:#ec7e7e;--text-success:#0ca30c;--text-warning:#db9300;
  --border:rgba(255,255,255,.1);--border-strong:rgba(255,255,255,.2);--border-stronger:rgba(255,255,255,.4);
  --bg-neutral:rgba(255,255,255,.05);--bg-neutral-hover:rgba(255,255,255,.1);--fill-control:rgba(255,255,255,.1);
  --fill-primary:#fff;--on-primary:#0b0b0b;--fill-primary-hover:#e1e0d9;
  --fill-secondary:rgba(255,255,255,.1);--fill-secondary-ring:#00000000;--fill-field:rgba(255,255,255,.05);
  --bg-accent:#032042;--bg-danger:#3c0e0e;--bg-warning:#311a00;--bg-success:#11260f;
  --shadow-sm:0 1px 2px 0 rgba(11,11,11,.06),0 2px 8px 0 rgba(0,0,0,.24);
  --shadow-popover:0 8px 24px rgb(0 0 0 / .32),0 2px 6px rgb(0 0 0 / .2);
  --focus-shadow:inset 0 0 0 1px #0b0b0b,0 0 0 1px #2a78d6,0 0 6px 1px rgba(24,79,149,.6);
  --ring:inset 0 0 0 1px rgba(255,255,255,.1)
}
.pme *{box-sizing:border-box}
.pme :where(a,button,input,textarea,select,summary,[tabindex]):focus-visible{outline:2px solid transparent;box-shadow:var(--focus-shadow)}

.pme .ptr-button,.pme-band button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:var(--h-control-sm);padding:0 .5rem;border:0;border-radius:var(--radius);background:var(--fill-secondary);box-shadow:0 0 0 1px var(--fill-secondary-ring);color:var(--text-primary);font:var(--text-footnote);font-weight:500;white-space:nowrap;cursor:pointer;filter:none;transition:background-color 120ms cubic-bezier(.165,.84,.44,1)}
.pme .ptr-button:hover,.pme-band button:hover{background:var(--bg-neutral-hover);filter:none}
.pme .ptr-button:active,.pme-band button:active{transform:scale(.98)}
.pme .ptr-button:disabled,.pme-band button:disabled{color:var(--text-disabled);opacity:1;cursor:default;pointer-events:none}
.pme .ptr-button-primary,.pme[data-theme] .ptr-button-primary{background:var(--fill-primary);color:var(--on-primary);box-shadow:none}
.pme .ptr-button-primary:hover{background:var(--fill-primary-hover)}
.pme .ptr-button-primary:disabled{background:var(--bg-neutral)}
.pme .ptr-button-danger{background:var(--fill-danger);color:#fff;box-shadow:none}
.pme .ptr-button-danger:hover{background:var(--fill-danger);filter:brightness(1.08)}
.pme .ptr-icon-button{width:var(--h-control-sm);height:var(--h-control-sm);border-radius:var(--radius);color:var(--text-secondary)}
.pme .ptr-icon-button:hover{background:var(--bg-neutral);color:var(--text-primary)}
.pme .ptr-input,.pme .ptr-select,.pme .ptr-textarea{border:0;border-radius:var(--radius);background:var(--fill-field);box-shadow:0 0 0 1px var(--border-strong);color:var(--text-primary);font:var(--text-body);padding:6px 10px}
.pme .ptr-input,.pme .ptr-select{height:var(--h-control)}
.pme .ptr-input:focus-visible,.pme .ptr-select:focus-visible,.pme .ptr-textarea:focus-visible{box-shadow:var(--focus-shadow)}
.pme .ptr-field{gap:6px}
.pme .ptr-label{font:var(--text-caption);font-weight:500;color:var(--text-muted);text-transform:none;letter-spacing:0}
.pme .ptr-check{gap:6px;font:var(--text-footnote);color:var(--text-secondary)}
.pme .ptr-check input{width:15px;height:15px;accent-color:var(--fill-accent)}
.pme .ptr-fieldset{border:0;border-radius:var(--radius-card);box-shadow:inset 0 0 0 1px var(--border)}
.pme .ptr-menu-list{gap:0;padding:4px;border:0;border-radius:var(--radius);background:var(--surface-2);box-shadow:var(--shadow-popover)}
.pme .ptr-menu-item{height:var(--h-control-sm);padding:0 .5rem;border-radius:var(--radius-sm);color:var(--text-primary);font:var(--text-footnote)}
.pme .ptr-menu-item:hover{background:var(--bg-neutral)}
.pme .ptr-overlay{background:rgb(0 0 0 / .4)}
.pme .ptr-modal{border:0;border-radius:var(--radius-card);background:var(--surface-1);box-shadow:var(--ring),var(--shadow-popover)}
.pme .ptr-modal-header,.pme .ptr-modal-footer{padding:12px 16px;border-color:var(--border)}
.pme .ptr-modal-header h2{font:var(--text-heading)}
.pme .ptr-modal-body{padding:16px;gap:12px}
.pme .ptr-toast{border-radius:var(--radius);background:var(--fill-primary);color:var(--on-primary);font:var(--text-footnote);box-shadow:var(--shadow-popover)}
.pme .ptr-toast-error{background:var(--fill-danger);color:#fff}

.pme-tabs{flex:none;display:flex;align-items:center;padding:12px clamp(16px,2.5vw,32px);border-bottom:1px solid var(--border)}
.pme-tab{height:calc(var(--h-control-sm) - 4px);padding:0 .5rem;border:0;border-radius:calc(var(--radius) - 2px);background:transparent;color:var(--text-secondary);font:var(--text-footnote);font-weight:500;cursor:pointer}
.pme-tab:hover{color:var(--text-primary)}
.pme-tab[aria-selected=true]{background:var(--surface-2);color:var(--text-primary);box-shadow:var(--shadow-sm)}
.pme-segmented{display:inline-flex;gap:2px;padding:2px;border-radius:var(--radius);background:var(--fill-control)}

.pme-band:empty{display:none}
.pme-band{flex:none;max-height:40%;overflow:auto;padding:8px clamp(16px,2.5vw,32px);border-bottom:1px solid var(--border);font:var(--text-footnote)}
.pme-prompt{float:right;margin-left:8px}
.pme-band summary{cursor:pointer;line-height:var(--h-control-sm);color:var(--text-secondary);font-weight:500}
.pme-band summary.pme-erreur{color:var(--text-danger)}
.pme-band ul{margin:4px 0;padding:0;list-style:none;display:flex;flex-direction:column;gap:2px}
.pme-dossier{padding:8px 0;border-top:1px solid var(--border)}
.pme-dossier-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pme-dossier-head strong{margin-right:auto;font-weight:580}
.pme li.pme-erreur{color:var(--text-danger)}
.pme li.pme-manque{color:var(--text-warning)}
.pme-frame{flex:1;min-height:0;width:100%;border:0;background:var(--surface-0)}

.pme-view{flex:1;min-height:0;overflow:auto;padding:16px clamp(16px,2.5vw,32px);display:flex;flex-direction:column;gap:16px}
.pme-view--frame{padding:0;gap:0;overflow:hidden}
.pme-spacer{flex:1}
.pme-board{display:flex;align-items:flex-start;gap:12px;overflow-x:auto;padding:2px 2px 8px;margin:-2px;scrollbar-width:thin;scrollbar-color:var(--border-strong) transparent}
.pme-col{flex:1 0 264px;max-width:380px;min-width:0;display:flex;flex-direction:column;gap:8px;padding:8px;border-radius:var(--radius-card);background:var(--bg-neutral)}
.pme-board--two .pme-col{flex-basis:280px;max-width:none}
.pme-col h3{display:flex;align-items:center;gap:8px;min-height:var(--h-control-sm);margin:0;padding:0 4px;font:var(--text-footnote);font-weight:580;color:var(--text-primary);text-transform:none;letter-spacing:0}
.pme-col h3 .pme-muted{font-weight:400;font-variant-numeric:tabular-nums}
.pme-col>p{margin:0;padding:0 4px}
.pme-col h3 .ptr-check{margin-left:auto;cursor:pointer}
.pme-card{display:flex;flex-direction:column;gap:8px;padding:12px;border:0;border-radius:var(--radius);background:var(--surface-1);box-shadow:var(--ring);transition:box-shadow 120ms cubic-bezier(.165,.84,.44,1)}
.pme-card{cursor:pointer}
.pme-card:hover{box-shadow:0 0 0 1px var(--border-stronger)}
.pme-card.is-excluded{opacity:.6}
.pme-card-head{display:flex;align-items:flex-start;gap:8px}
.pme-card-title{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.pme-card-title strong{font:var(--text-body);font-weight:580}
.pme-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.pme-muted{color:var(--text-muted)}
.pme-small{font:var(--text-caption);margin:0}
.pme-card p{margin:0;font:var(--text-footnote)}
.pme-card p.pme-small{font:var(--text-caption)}
.pme-ok{color:var(--text-success)}
.pme-erreur{color:var(--text-danger)}
.pme-manque{color:var(--text-warning)}
.pme-checks{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:4px;font:var(--text-footnote)}
.pme-checks .is-ok{color:var(--text-muted)}
.pme-checks .is-ko{color:var(--text-primary)}
.pme-badged{position:relative}
.pme-badge{position:absolute;bottom:calc(100% + 2px);left:50%;transform:translateX(-50%);height:18px;padding:0 6px;border-radius:var(--radius-sm);background:var(--bg-danger);color:var(--text-danger);font:var(--text-caption);font-weight:500;line-height:18px;white-space:nowrap;pointer-events:none}
.pme-alertes{font:var(--text-footnote)}
.pme-alertes summary{cursor:pointer;font-weight:500}
.pme-alertes ul{margin:6px 0 0;padding-left:18px;display:flex;flex-direction:column;gap:4px}
.pme-docs{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px}
.pme-docs li{display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:var(--radius);background:var(--bg-neutral);font:var(--text-footnote)}
.pme-doc-head,.pme-doc-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.pme-doc-head strong{flex:1;font-weight:580}
.pme-pill{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 8px;border:0;border-radius:var(--radius-sm);background:var(--bg-neutral);color:var(--text-secondary);font:var(--text-caption);font-weight:500;white-space:nowrap}
button.pme-pill{cursor:pointer}
button.pme-pill:hover{filter:brightness(.96)}
.pme-pill--run{background:var(--bg-accent);color:var(--text-accent)}
.pme-pill--todo{background:var(--bg-warning);color:var(--text-warning)}
.pme-pill--done{background:var(--bg-success);color:var(--text-success)}
.pme-pill--ko{background:var(--bg-danger);color:var(--text-danger)}
.pme-task,.pme-next{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font:var(--text-footnote)}
.pme-next-text{flex:1;min-width:0}
.pme-link{border:0;padding:0;border-radius:4px;background:transparent;color:var(--text-accent);font:var(--text-footnote);font-weight:500;cursor:pointer}
.pme-link--muted{color:var(--text-muted)}
.pme-link:hover{text-decoration:underline}
.pme-menus{display:flex;gap:8px;flex-wrap:wrap}
.pme-new-type{display:flex;flex-direction:column;gap:12px}
.pme-empty{margin:0;padding:56px 24px;text-align:center;border-radius:var(--radius-card);box-shadow:inset 0 0 0 1px var(--border);color:var(--text-secondary)}
.pme-question{margin:0;white-space:pre-wrap;font:var(--text-footnote);max-height:240px;overflow:auto;color:var(--text-secondary)}
.pme-demande{display:flex;flex-direction:column;gap:8px;padding-top:8px;border-top:1px solid var(--border)}
.pme-choix{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;border:0}
.pme-choix legend{margin-bottom:4px;font:var(--text-footnote);font-weight:580}
.pme-done summary{cursor:pointer;font:var(--text-footnote);font-weight:580;color:var(--text-secondary)}
.pme-zone{position:relative;flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden;container-type:inline-size}
.pme-drawer-matter{flex:1;min-height:0;width:100%;border:0}
.pme-drawer-body.has-matter{flex:none;max-height:45%;border-bottom:1px solid var(--border)}
.pme-drawer{position:absolute;inset-block:0;right:0;z-index:40;width:min(500px,100%);display:flex;flex-direction:column;background:var(--surface-2);border-left:1px solid var(--border);box-shadow:var(--shadow-popover);transform:translateX(100%);visibility:hidden;transition:transform 300ms cubic-bezier(.32,.72,0,1),visibility 0s linear 300ms}
@container (max-width:760px){.pme-drawer{width:100%}}
.pme-drawer.is-open{transform:none;visibility:visible;transition-delay:0s}
.pme-drawer-head{display:flex;align-items:flex-start;gap:8px;padding:20px 20px 16px;border-bottom:1px solid var(--border)}
.pme-drawer-titles{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.pme-drawer-eyebrow{font:var(--text-caption);color:var(--text-muted)}
.pme-drawer-title{font:var(--text-heading)}
.pme-drawer-body{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:16px;padding:20px;font:var(--text-footnote)}
.pme-drawer-body p{margin:0}
.pme-version{display:flex;flex-direction:column;gap:12px}
.pme-version h4{margin:0;font:var(--text-caption);font-weight:500;color:var(--text-muted)}
.pme-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:16px}
.pme-step{display:grid;grid-template-columns:20px 1fr;gap:10px;align-items:start}
.pme-step-body{display:flex;flex-direction:column;gap:8px;min-width:0}
.pme-step-body>strong{font:var(--text-body);font-weight:580;line-height:20px}
.pme-bulle{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;box-shadow:inset 0 0 0 1.5px var(--border-stronger);font:var(--text-caption);font-weight:700}
.pme-bulle.is-done{background:var(--text-success);color:#fff;box-shadow:none}
.pme-done-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;margin-top:12px}
`;
