export const STYLES = `
.pma { --pma-bg: #fbfaf7; --pma-fg: #1d1c1a; --pma-muted: #6b675f; --pma-line: #e4e0d8; --pma-card: #fff; --pma-accent: #8a4b2a; --pma-danger: #a3261b;
  height: 100%; display: flex; flex-direction: column; background: var(--pma-bg); color: var(--pma-fg); font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; overflow: auto; }
.pma[data-theme="dark"] { --pma-bg: #171614; --pma-fg: #ece9e3; --pma-muted: #a29d93; --pma-line: #2e2c28; --pma-card: #1f1e1b; --pma-accent: #e09a6f; --pma-danger: #f08a80; }
.pma-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 10px 16px; border-bottom: 1px solid var(--pma-line); position: sticky; top: 0; background: var(--pma-bg); z-index: 1; }
.pma-bar h2 { font-size: 15px; margin: 0; flex: 1; min-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pma button, .pma select { font: inherit; color: inherit; background: var(--pma-card); border: 1px solid var(--pma-line); border-radius: 6px; padding: 4px 10px; cursor: pointer; }
.pma button[aria-pressed="true"], .pma button[aria-selected="true"] { border-color: var(--pma-accent); color: var(--pma-accent); }
.pma-tabs { display: flex; gap: 4px; }
.pma-pin { opacity: .35; } .pma-pin.on { opacity: 1; }
.pma-danger { color: var(--pma-danger) !important; }
.pma-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; padding: 16px; }
.pma-card { display: flex; gap: 12px; align-items: flex-start; padding: 14px; background: var(--pma-card); border: 1px solid var(--pma-line); border-radius: 10px; cursor: pointer; }
.pma-card:hover, .pma-card:focus-visible { border-color: var(--pma-accent); outline: none; }
.pma-card-icon { font-size: 22px; line-height: 1; }
.pma-card-body { flex: 1; min-width: 0; }
.pma-card h3 { font-size: 14px; margin: 0 0 4px; }
.pma-card p { margin: 0 0 6px; color: var(--pma-muted); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.pma-muted { color: var(--pma-muted); font-size: 12px; }
.pma-empty, .pma-error { padding: 24px 16px; color: var(--pma-muted); }
.pma-error { color: var(--pma-danger); padding: 8px 16px; margin: 0; }
.pma-view { flex: 1; display: grid; grid-template-columns: 1fr; min-height: 0; }
.pma-view.with-comments { grid-template-columns: 1fr 300px; }
.pma-view iframe { width: 100%; height: 100%; min-height: 480px; border: 0; background: #fff; }
.pma-comments { border-left: 1px solid var(--pma-line); padding: 12px; overflow: auto; }
.pma-comments h3 { margin: 0 0 8px; font-size: 14px; }
.pma-comments form { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.pma-comments textarea { font: inherit; color: inherit; background: var(--pma-card); border: 1px solid var(--pma-line); border-radius: 6px; padding: 6px; resize: vertical; }
.pma-comments ul { list-style: none; margin: 0; padding: 0; }
.pma-thread { border: 1px solid var(--pma-line); border-radius: 8px; padding: 8px; margin-bottom: 8px; background: var(--pma-card); }
.pma-thread p { margin: 0 0 4px; white-space: pre-wrap; }
.pma-thread.resolved { opacity: .6; }
.pma-tag { display: inline-block; font-size: 11px; color: var(--pma-accent); margin-bottom: 4px; }
@media (max-width: 720px) { .pma-view.with-comments { grid-template-columns: 1fr; } .pma-comments { border-left: 0; border-top: 1px solid var(--pma-line); } }
`;
