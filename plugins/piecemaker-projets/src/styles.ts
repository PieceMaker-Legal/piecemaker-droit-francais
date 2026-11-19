export const STYLES = `
.pmp-root nav,.pmp-composer{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;padding:.65rem;border-bottom:1px solid var(--ptr-border)}
.pmp-root [aria-pressed=true]{background:var(--ptr-text);color:var(--ptr-bg)}
.pmp-main{overflow:auto;flex:1;min-height:0;padding:1rem}
.pmp-main>div,.pmp-log,.pmp-composer{width:100%;max-width:52rem;margin:auto}
.pmp-log{display:flex;flex-direction:column;gap:.75rem}
.pmp-message,.pmp-card,.pmp-thread{border:1px solid var(--ptr-border);border-radius:.8rem;padding:.7rem;background:var(--ptr-surface);overflow-wrap:anywhere}
.pmp-message{align-self:flex-start;max-width:92%;min-width:min(12rem,80%)}
.pmp-message[data-author=user]{align-self:flex-end;background:var(--ptr-soft)}
.pmp-message p,.pmp-card p{white-space:pre-wrap;margin:.3rem 0}
.pmp-card,.pmp-thread{display:grid;gap:.45rem;margin:.45rem 0}
.pmp-thread{text-align:left;grid-template-columns:1fr auto;align-items:center;cursor:pointer;width:100%}
.pmp-thread:disabled{cursor:default}
.pmp-status:before{content:'●';margin-right:.3rem;color:var(--ptr-muted)}
.pmp-status[data-state=working]:before{color:#3489e8}
.pmp-status[data-state=blocked]:before,.pmp-status[data-state=review_ready]:before{color:#d99718}
.pmp-status[data-state=done]:before{color:#219664}
.pmp-status[data-state=failed]:before{color:#d75252}
.pmp-root label{display:grid;gap:.25rem}
.pmp-root textarea,.pmp-root input{border:1px solid var(--ptr-border);border-radius:.5rem;background:var(--ptr-bg);color:inherit;padding:.45rem;width:100%}
.pmp-composer{border-top:1px solid var(--ptr-border);border-bottom:0;flex-wrap:nowrap}
.pmp-root button:disabled,.pmp-root select:disabled,.pmp-root option:disabled{opacity:.55}
.pmp-message .ptr-button,.pmp-card .ptr-button{height:auto;min-height:1.75rem;white-space:normal}
.pmp-root th,.pmp-root td{border:1px solid var(--ptr-border);padding:.3rem}
.pmp-error{color:var(--ptr-danger);padding:0 .8rem}
`;
