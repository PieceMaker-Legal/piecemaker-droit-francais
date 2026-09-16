// plugins/piecemaker-tamponnage/src/index.ts
var ApiError = class extends Error {
  status;
  constructor(message, status) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
};
var BASE = "/api/piecemaker";
var DEFAULT_STAMP_CONFIG = {
  topText: "CABINET",
  bottomText: "PI\xC8CE COMMUNIQU\xC9E",
  shape: "circle",
  border: "double",
  font: "sans",
  color: "#1f4f45",
  lineWidth: 10
};
var STYLE_TEXT = `
.pm-stamp{box-sizing:border-box;height:100%;overflow:auto;color:var(--pm-text);background:var(--pm-bg);font:13px/1.45 Inter,ui-sans-serif,system-ui,sans-serif}
.pm-stamp *{box-sizing:border-box}.pm-stamp-main{max-width:960px;margin:auto;padding:24px;display:grid;gap:20px}.pm-stamp-card{border:1px solid var(--pm-border);border-radius:10px;background:var(--pm-card);box-shadow:0 1px 2px #0000000d}.pm-stamp-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 20px;border-bottom:1px solid var(--pm-border)}.pm-stamp-title{display:flex;align-items:center;gap:10px;margin:0;font-size:16px;font-weight:650}.pm-stamp-title svg{width:18px;height:18px;flex:none;color:var(--pm-accent)}.pm-stamp-subtitle{margin:5px 0 0;color:var(--pm-muted);font-size:12px}.pm-stamp-body{padding:18px 20px}.pm-stamp-footer{display:flex;flex-wrap:wrap;gap:8px;padding:14px 20px;border-top:1px solid var(--pm-border)}.pm-stamp-builder{display:flex;gap:20px;align-items:flex-start}.pm-stamp-preview{width:160px;height:160px;display:flex;align-items:center;justify-content:center;flex:none;border:1px dashed var(--pm-border);border-radius:8px;background:var(--pm-soft)}.pm-stamp-preview img{width:100%;height:100%;object-fit:contain;padding:8px}.pm-stamp-preview span{padding:12px;text-align:center;color:var(--pm-muted);font-size:11px}.pm-stamp-form{display:grid;gap:13px;flex:1;padding:14px;border:1px solid var(--pm-border);border-radius:8px;background:var(--pm-soft)}.pm-stamp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.pm-stamp-label{display:grid;gap:5px;color:var(--pm-muted);font-size:11px;font-weight:650}.pm-stamp-input,.pm-stamp-select{width:100%;height:34px;border:1px solid var(--pm-border);border-radius:6px;padding:6px 8px;background:var(--pm-card);color:var(--pm-text);font:inherit}.pm-stamp-color{padding:3px;cursor:pointer}.pm-stamp-range{height:34px;padding:0;cursor:pointer}.pm-stamp-choice{display:flex;flex-wrap:wrap;gap:6px}.pm-stamp-choice-label{margin-bottom:5px;color:var(--pm-muted);font-size:11px;font-weight:650}.pm-stamp-choice button,.pm-stamp-button{min-height:32px;border:1px solid var(--pm-border);border-radius:6px;padding:6px 10px;background:var(--pm-card);color:var(--pm-text);font:500 12px inherit;cursor:pointer}.pm-stamp-choice button:hover,.pm-stamp-button:hover{background:var(--pm-hover)}.pm-stamp-choice button.active{border-color:var(--pm-accent);background:var(--pm-accent-soft);color:var(--pm-accent)}.pm-stamp-button{display:inline-flex;align-items:center;justify-content:center;gap:7px;background:var(--pm-accent);border-color:var(--pm-accent);color:#fff}.pm-stamp-button.secondary{background:var(--pm-card);border-color:var(--pm-border);color:var(--pm-text)}.pm-stamp-button.danger{background:transparent;border-color:var(--pm-danger);color:var(--pm-danger)}.pm-stamp-button:disabled{cursor:default;opacity:.55}.pm-stamp-badge{white-space:nowrap;border:1px solid var(--pm-border);border-radius:999px;padding:4px 8px;color:var(--pm-muted);font-size:11px}.pm-stamp-badge.active{background:var(--pm-accent-soft);border-color:transparent;color:var(--pm-accent)}.pm-stamp-alert{display:flex;gap:8px;margin-top:12px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--pm-danger) 30%,transparent);border-radius:7px;background:color-mix(in srgb,var(--pm-danger) 10%,transparent);color:var(--pm-danger);font-size:12px}.pm-stamp-muted{color:var(--pm-muted);font-size:12px}.pm-stamp-case{display:flex;align-items:center;gap:10px}.pm-stamp-case .pm-stamp-select{max-width:280px}.pm-stamp-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.pm-stamp-section-label{margin:0 0 6px;color:var(--pm-muted);font-size:11px;font-weight:650}.pm-stamp-list{height:260px;overflow:auto;border:1px solid var(--pm-border);border-radius:7px;padding:6px}.pm-stamp-piece{width:100%;display:flex;align-items:center;gap:8px;border:0;border-radius:6px;padding:7px 8px;text-align:left;background:transparent;color:var(--pm-text);font:inherit;cursor:pointer}.pm-stamp-piece:hover{background:var(--pm-hover)}.pm-stamp-piece.selected{background:var(--pm-accent-soft)}.pm-stamp-number{display:inline-flex;width:21px;height:21px;flex:none;align-items:center;justify-content:center;border-radius:50%;background:var(--pm-accent);color:#fff;font-size:11px}.pm-stamp-piece-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pm-stamp-status{flex:none;border:1px solid var(--pm-border);border-radius:999px;padding:2px 5px;color:var(--pm-muted);font-size:10px}.pm-stamp-order{display:flex;align-items:center;gap:7px;border:1px solid var(--pm-border);border-radius:6px;padding:5px 7px}.pm-stamp-order+.pm-stamp-order{margin-top:5px}.pm-stamp-order-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pm-stamp-icon-button{width:25px;height:25px;border:0;border-radius:5px;background:transparent;color:var(--pm-muted);cursor:pointer}.pm-stamp-icon-button:hover{background:var(--pm-hover);color:var(--pm-text)}.pm-stamp-icon-button:disabled{opacity:.35;cursor:default}.pm-stamp-result{margin-top:16px;border:1px solid var(--pm-border);border-radius:7px;padding:12px;background:var(--pm-soft)}.pm-stamp-result ul{display:grid;gap:5px;margin:10px 0 0;padding:0;list-style:none}.pm-stamp-result li{display:flex;gap:7px;font-size:12px}.pm-stamp-ok{color:var(--pm-success)}.pm-stamp-fail{color:var(--pm-danger)}.pm-stamp-hidden{display:none!important}
@media(max-width:720px){.pm-stamp-main{padding:14px}.pm-stamp-builder,.pm-stamp-columns{grid-template-columns:1fr;display:grid}.pm-stamp-preview{width:140px;height:140px}.pm-stamp-grid{grid-template-columns:1fr}.pm-stamp-header,.pm-stamp-case{align-items:flex-start;flex-direction:column}.pm-stamp-case .pm-stamp-select{max-width:none}}
`;
function icon(name) {
  const paths = {
    stamp: '<circle cx="12" cy="12" r="8"/><path d="M8 12h8M12 8v8"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M5 20h14"/>',
    save: '<path d="M5 3h12l2 2v16H5zM8 3v6h8V3M8 21v-6h8v6"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V3h6v4"/>',
    folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    cross: '<path d="m6 6 12 12M18 6 6 18"/>',
    up: '<path d="m6 14 6-6 6 6"/>',
    down: '<path d="m6 10 6 6 6-6"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] || character);
}
function errorMessage(cause) {
  return cause instanceof Error ? cause.message : String(cause);
}
async function request(path, init = {}) {
  const token = localStorage.getItem("auth-token");
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...token ? { Authorization: `Bearer ${token}` } : {},
      ...init.headers || {}
    }
  });
  const refreshed = response.headers.get("X-Refreshed-Token");
  if (refreshed) {
    localStorage.setItem("auth-token", refreshed);
    window.dispatchEvent(new CustomEvent("auth-token-refreshed", { detail: refreshed }));
  }
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : null;
  } catch {
    throw new Error(response.ok ? "R\xE9ponse illisible du serveur PieceMaker." : raw.slice(0, 200) || response.statusText);
  }
  if (!response.ok) throw new ApiError(payload?.error || `Erreur ${response.status}`, response.status);
  return payload;
}
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Lecture du fichier impossible."));
    reader.readAsDataURL(file);
  });
}
var CANVAS_SIZE = 600;
var CENTER = CANVAS_SIZE / 2;
var FONT_FAMILIES = { sans: "Arial, Helvetica, sans-serif", serif: 'Georgia, "Times New Roman", serif', mono: '"Courier New", Courier, monospace' };
function roundedRectPath(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}
function traceBorder(context, shape, inset) {
  const radius = 276 - inset;
  if (shape === "circle") {
    context.beginPath();
    context.arc(CENTER, CENTER, radius, 0, Math.PI * 2);
    context.stroke();
  } else if (shape === "oval") {
    context.beginPath();
    context.ellipse(CENTER, CENTER, radius, radius * 0.72, 0, 0, Math.PI * 2);
    context.stroke();
  } else if (shape === "rounded") {
    roundedRectPath(context, 24 + inset, 90 + inset, 552 - inset * 2, 420 - inset * 2, 58);
    context.stroke();
  } else {
    context.strokeRect(24 + inset, 90 + inset, 552 - inset * 2, 420 - inset * 2);
  }
}
function fitFontSize(context, text, maxWidth, preferredSize, family) {
  let size = preferredSize;
  do {
    context.font = `700 ${size}px ${family}`;
    if (context.measureText(text).width <= maxWidth) return size;
    size -= 1;
  } while (size > 18);
  return 18;
}
function straightText(context, text, y, maxWidth, preferredSize, family) {
  if (!text) return;
  const size = fitFontSize(context, text, maxWidth, preferredSize, family);
  context.font = `700 ${size}px ${family}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, CENTER, y);
}
function curvedText(context, text, family, radius, centerAngle, direction) {
  if (!text) return;
  const characters = [...text];
  let fontSize = 58;
  let widths = [];
  let totalWidth = 0;
  do {
    context.font = `700 ${fontSize}px ${family}`;
    widths = characters.map((character) => context.measureText(character).width + fontSize * 0.06);
    totalWidth = widths.reduce((sum, width) => sum + width, 0);
    fontSize -= 1;
  } while (totalWidth / radius > Math.PI * 1.25 && fontSize > 24);
  const totalAngle = totalWidth / radius;
  let angle = centerAngle - direction * totalAngle / 2;
  context.textAlign = "center";
  context.textBaseline = "middle";
  characters.forEach((character, index) => {
    const characterAngle = widths[index] / radius;
    angle += direction * characterAngle / 2;
    context.save();
    context.translate(CENTER + Math.cos(angle) * radius, CENTER + Math.sin(angle) * radius);
    context.rotate(angle + (direction === 1 ? Math.PI / 2 : -Math.PI / 2));
    context.fillText(character, 0, 0);
    context.restore();
    angle += direction * characterAngle / 2;
  });
}
function renderStampDataUrl(config) {
  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Le canvas 2D est indisponible dans ce navigateur.");
  context.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  context.strokeStyle = config.color;
  context.fillStyle = config.color;
  context.lineWidth = config.lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  const family = FONT_FAMILIES[config.font];
  traceBorder(context, config.shape, 0);
  if (config.border === "double") traceBorder(context, config.shape, 24);
  if (config.shape === "circle" || config.shape === "oval") {
    const radius = config.shape === "circle" ? 205 : 185;
    const verticalScale = config.shape === "circle" ? 1 : 0.76;
    context.save();
    context.translate(CENTER, CENTER);
    context.scale(1, verticalScale);
    context.translate(-CENTER, -CENTER);
    context.font = `700 58px ${family}`;
    curvedText(context, config.topText, family, radius, -Math.PI / 2, 1);
    curvedText(context, config.bottomText, family, radius, Math.PI / 2, -1);
    context.restore();
    context.beginPath();
    context.arc(96, CENTER, 7, 0, Math.PI * 2);
    context.arc(504, CENTER, 7, 0, Math.PI * 2);
    context.fill();
  } else {
    straightText(context, config.topText, 205, 470, 72, family);
    straightText(context, config.bottomText, 405, 470, 52, family);
  }
  return canvas.toDataURL("image/png");
}
function themeVariables(theme) {
  return theme === "dark" ? "--pm-bg:#111827;--pm-card:#182235;--pm-soft:#202c40;--pm-border:#334155;--pm-text:#e5e7eb;--pm-muted:#94a3b8;--pm-hover:#29384f;--pm-accent:#60a5fa;--pm-accent-soft:#1e3a5f;--pm-danger:#f87171;--pm-success:#4ade80;" : "--pm-bg:#fff;--pm-card:#fff;--pm-soft:#f8fafc;--pm-border:#e2e8f0;--pm-text:#0f172a;--pm-muted:#64748b;--pm-hover:#f1f5f9;--pm-accent:#2563eb;--pm-accent-soft:#eff6ff;--pm-danger:#dc2626;--pm-success:#16a34a;";
}
function statusLabel(status) {
  return { ready: "Pr\xEAte", "awaiting-scan": "Non scann\xE9e", "not-converted": "Non convertie" }[status];
}
function button(label, action, options = {}) {
  return `<button type="button" class="pm-stamp-button ${options.className || ""}" data-action="${action}" ${options.disabled ? "disabled" : ""}>${options.icon ? icon(options.icon) : ""}${label}</button>`;
}
function choiceButtons(stateValue, options, field) {
  return options.map((option) => `<button type="button" class="${stateValue === option.id ? "active" : ""}" data-field="${field}" data-value="${option.id}">${option.label}</button>`).join("");
}
function renderBuilder(state) {
  const displayedImage = state.pendingImage || state.savedImage;
  const dirty = Boolean(state.pendingImage);
  const badge = state.loadingStamp ? "" : `<span class="pm-stamp-badge ${displayedImage && !dirty ? "active" : ""}">${dirty ? "Non enregistr\xE9" : displayedImage ? "Enregistr\xE9" : "Aucun tampon"}</span>`;
  return `<section class="pm-stamp-card"><header class="pm-stamp-header"><div><h2 class="pm-stamp-title">${icon("stamp")}Tampon du cabinet</h2><p class="pm-stamp-subtitle">Une seule image pour tout le cabinet, appos\xE9e sur chaque pi\xE8ce tamponn\xE9e.</p></div>${badge}</header><div class="pm-stamp-body">${state.loadingStamp ? '<p class="pm-stamp-muted">Chargement du tampon\u2026</p>' : `<div class="pm-stamp-builder"><div><div class="pm-stamp-preview">${displayedImage ? `<img src="${displayedImage}" alt="Aper\xE7u du tampon">` : "<span>Aucun tampon configur\xE9</span>"}</div><input class="pm-stamp-hidden" data-file type="file" accept="image/png,image/jpeg">${button("Importer", "import", { icon: "upload", className: "secondary" })}</div><div class="pm-stamp-form"><div class="pm-stamp-grid"><label class="pm-stamp-label">Mention haute<input class="pm-stamp-input" data-config="topText" maxlength="40" value="${escapeHtml(state.config.topText)}"></label><label class="pm-stamp-label">Mention basse<input class="pm-stamp-input" data-config="bottomText" maxlength="40" value="${escapeHtml(state.config.bottomText)}"></label></div><div><div class="pm-stamp-choice-label">Forme</div><div class="pm-stamp-choice">${choiceButtons(state.config.shape, [{ id: "circle", label: "Cercle" }, { id: "oval", label: "Ovale" }, { id: "rounded", label: "Rectangle arrondi" }, { id: "rect", label: "Rectangle" }], "shape")}</div></div><div class="pm-stamp-grid"><div><div class="pm-stamp-choice-label">Contour</div><div class="pm-stamp-choice">${choiceButtons(state.config.border, [{ id: "double", label: "Double" }, { id: "single", label: "Simple" }], "border")}</div></div><div><div class="pm-stamp-choice-label">Police</div><div class="pm-stamp-choice">${choiceButtons(state.config.font, [{ id: "sans", label: "Sans serif" }, { id: "serif", label: "Serif" }, { id: "mono", label: "Machine \xE0 \xE9crire" }], "font")}</div></div></div><div class="pm-stamp-grid"><label class="pm-stamp-label">Couleur<input class="pm-stamp-input pm-stamp-color" data-config="color" type="color" value="${escapeHtml(state.config.color)}"></label><label class="pm-stamp-label">\xC9paisseur (${state.config.lineWidth}px)<input class="pm-stamp-input pm-stamp-range" data-config="lineWidth" type="range" min="4" max="20" value="${state.config.lineWidth}"></label></div>${button("G\xE9n\xE9rer le tampon", "generate", { icon: "stamp", className: "secondary" })}</div></div>`}${state.stampError ? `<div class="pm-stamp-alert">${escapeHtml(state.stampError)}</div>` : ""}</div>${!state.loadingStamp ? `<footer class="pm-stamp-footer">${button("Enregistrer le tampon", "save", { icon: "save", disabled: !dirty || state.savingStamp })}${dirty ? button("Annuler", "discard", { className: "secondary", disabled: state.savingStamp }) : ""}${state.savedImage && !dirty ? button("Supprimer le tampon", "delete", { icon: "trash", className: "danger", disabled: state.deletingStamp }) : ""}</footer>` : ""}</section>`;
}
function renderPieces(state) {
  const selectedCase = state.cases.find((entry) => entry.path === state.selectedCaseId) || null;
  const selected = new Set(state.selectedOrder);
  const originals = state.loadingOriginals ? '<p class="pm-stamp-muted">Chargement des pi\xE8ces\u2026</p>' : state.error && selectedCase ? `<div class="pm-stamp-alert">${escapeHtml(state.error)}</div>` : state.originals.length > 0 ? `<div class="pm-stamp-columns"><div><p class="pm-stamp-section-label">Pi\xE8ces du dossier \u2014 cliquer pour ajouter au bordereau</p><div class="pm-stamp-list">${state.originals.map((piece) => {
    const number = state.selectedOrder.indexOf(piece.path);
    return `<button type="button" class="pm-stamp-piece ${selected.has(piece.path) ? "selected" : ""}" data-piece="${escapeHtml(piece.path)}">${number >= 0 ? `<span class="pm-stamp-number">${number + 1}</span>` : icon("file")}<span class="pm-stamp-piece-name">${escapeHtml(piece.path)}</span>${piece.status !== "ready" ? `<span class="pm-stamp-status">${statusLabel(piece.status)}</span>` : ""}</button>`;
  }).join("")}</div></div><div><p class="pm-stamp-section-label">Bordereau (${state.selectedOrder.length} pi\xE8ce${state.selectedOrder.length > 1 ? "s" : ""})</p><div class="pm-stamp-list">${state.selectedOrder.length === 0 ? '<p class="pm-stamp-muted">Aucune pi\xE8ce s\xE9lectionn\xE9e.</p>' : state.selectedOrder.map((path, index) => {
    const piece = state.originals.find((entry) => entry.path === path);
    return `<div class="pm-stamp-order"><span class="pm-stamp-order-name">Pi\xE8ce n\xB0${index + 1} \u2014 ${escapeHtml(piece?.name || path)}</span><button class="pm-stamp-icon-button" type="button" data-move="${index}:-1" aria-label="Monter" ${index === 0 ? "disabled" : ""}>${icon("up")}</button><button class="pm-stamp-icon-button" type="button" data-move="${index}:1" aria-label="Descendre" ${index === state.selectedOrder.length - 1 ? "disabled" : ""}>${icon("down")}</button><button class="pm-stamp-icon-button" type="button" data-remove="${escapeHtml(path)}" aria-label="Retirer">${icon("cross")}</button></div>`;
  }).join("")}</div></div></div>` : '<p class="pm-stamp-muted">Ce dossier ne contient aucune pi\xE8ce originale.</p>';
  const caseOptions = state.cases.map((entry) => `<option value="${escapeHtml(entry.path)}" ${entry.path === state.selectedCaseId ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("");
  return `<section class="pm-stamp-card"><header class="pm-stamp-header"><div><h2 class="pm-stamp-title">${icon("file")}Pi\xE8ces \xE0 tamponner</h2></div>${state.cases.length > 0 ? `<div class="pm-stamp-case"><label class="pm-stamp-muted" for="pm-case">Dossier</label><select id="pm-case" class="pm-stamp-select" data-case>${caseOptions}</select></div>` : ""}</header><div class="pm-stamp-body">${state.loadingCases ? '<p class="pm-stamp-muted">Chargement des dossiers\u2026</p>' : state.error ? `<div class="pm-stamp-alert">${escapeHtml(state.error)}</div>` : state.cases.length === 0 ? '<p class="pm-stamp-muted">Aucun dossier enregistr\xE9. Enregistrez-en un depuis la section \xAB Dossiers \xBB.</p>' : !selectedCase ? '<p class="pm-stamp-muted">S\xE9lectionnez un dossier ci-dessus.</p>' : originals}${selectedCase && state.runResult ? `<div class="pm-stamp-result"><div class="pm-stamp-case"><strong>${escapeHtml(state.runResult.message)}</strong>${button("Ouvrir \xAB Pi\xE8ces tamponn\xE9es \xBB", "reveal", { icon: "folder", className: "secondary", disabled: state.revealing })}</div><ul>${state.runResult.results.map((result) => `<li class="${result.success ? "pm-stamp-ok" : "pm-stamp-fail"}">${icon(result.success ? "check" : "cross")}<span>Pi\xE8ce n\xB0${result.pieceNumber} \u2014 ${escapeHtml(result.filename)}${result.error ? `<small>${escapeHtml(result.error)}</small>` : ""}</span></li>`).join("")}</ul></div>` : ""}</div>${selectedCase && state.originals.length > 0 ? `<footer class="pm-stamp-footer">${button(state.running ? "Tamponnage en cours\u2026" : `Tamponner ${state.selectedOrder.length || ""} pi\xE8ce${state.selectedOrder.length > 1 ? "s" : ""}`.trim(), "run", { icon: "stamp", disabled: state.running || state.selectedOrder.length === 0 })}</footer>` : ""}</section>`;
}
function render(state, root) {
  root.style.cssText = themeVariables(state.context.theme);
  root.innerHTML = `<main class="pm-stamp-main" aria-label="Tampon et pi\xE8ces">${renderBuilder(state)}${renderPieces(state)}</main>`;
}
var states = /* @__PURE__ */ new WeakMap();
async function loadStamp(state, root) {
  state.loadingStamp = true;
  render(state, root);
  try {
    const response = await request("/tampon/load");
    state.savedImage = response.tamponImage;
  } catch (cause) {
    if (!(cause instanceof ApiError && cause.status === 404)) state.stampError = errorMessage(cause);
  } finally {
    state.loadingStamp = false;
    if (!state.disposed) render(state, root);
  }
}
async function loadCases(state, root) {
  const sequence = ++state.loadSequence;
  state.loadingCases = true;
  state.error = null;
  render(state, root);
  try {
    const overview = await request("/repository");
    let cases = overview.folders || [];
    let selected = state.context.project ? cases.find((entry) => entry.location === state.context.project?.path) || null : null;
    if (state.context.project && !selected) {
      const registered = await request("/repository/cases/selected", { method: "POST", body: JSON.stringify({ folder: state.context.project.path }) });
      selected = registered.folder;
      cases = [...cases.filter((entry) => entry.path !== selected?.path), selected];
    }
    if (sequence !== state.loadSequence || state.disposed) return;
    state.cases = cases;
    state.selectedCaseId = selected?.path || cases[0]?.path || null;
    state.selectedOrder = [];
    state.runResult = null;
    await loadOriginals(state, root);
  } catch (cause) {
    if (sequence === state.loadSequence) state.error = errorMessage(cause);
  } finally {
    if (sequence === state.loadSequence && !state.disposed) {
      state.loadingCases = false;
      render(state, root);
    }
  }
}
async function loadOriginals(state, root) {
  if (!state.selectedCaseId) {
    state.originals = [];
    return;
  }
  state.loadingOriginals = true;
  render(state, root);
  try {
    const response = await request(`/repository/case?case=${encodeURIComponent(state.selectedCaseId)}`);
    state.originals = response.folder.originals || [];
  } catch (cause) {
    state.originals = [];
    state.error = errorMessage(cause);
  } finally {
    state.loadingOriginals = false;
    if (!state.disposed) render(state, root);
  }
}
async function handleAction(state, root, action) {
  if (action === "import") {
    root.querySelector("[data-file]")?.click();
    return;
  }
  if (action === "generate") {
    try {
      state.pendingImage = renderStampDataUrl(state.config);
      state.stampError = null;
    } catch (cause) {
      state.stampError = errorMessage(cause);
    }
    render(state, root);
    return;
  }
  if (action === "discard") {
    state.pendingImage = null;
    state.stampError = null;
    render(state, root);
    return;
  }
  if (action === "save" && state.pendingImage) {
    state.savingStamp = true;
    state.stampError = null;
    render(state, root);
    try {
      await request("/tampon/save", { method: "POST", body: JSON.stringify({ tamponImage: state.pendingImage }) });
      state.savedImage = state.pendingImage;
      state.pendingImage = null;
    } catch (cause) {
      state.stampError = errorMessage(cause);
    } finally {
      state.savingStamp = false;
      if (!state.disposed) render(state, root);
    }
    return;
  }
  if (action === "delete") {
    state.deletingStamp = true;
    state.stampError = null;
    render(state, root);
    try {
      await request("/tampon/delete", { method: "DELETE" });
      state.savedImage = null;
      state.pendingImage = null;
    } catch (cause) {
      state.stampError = errorMessage(cause);
    } finally {
      state.deletingStamp = false;
      if (!state.disposed) render(state, root);
    }
    return;
  }
  if (action === "run") {
    const selectedCase = state.cases.find((entry) => entry.path === state.selectedCaseId);
    if (!selectedCase || state.selectedOrder.length === 0) return;
    state.running = true;
    state.error = null;
    state.runResult = null;
    render(state, root);
    try {
      state.runResult = await request("/stamping", { method: "POST", body: JSON.stringify({ pieces: state.selectedOrder, documentId: selectedCase.path, folder: selectedCase.location }) });
    } catch (cause) {
      state.error = errorMessage(cause);
    } finally {
      state.running = false;
      if (!state.disposed) render(state, root);
    }
    return;
  }
  if (action === "reveal") {
    const selectedCase = state.cases.find((entry) => entry.path === state.selectedCaseId);
    if (!selectedCase) return;
    state.revealing = true;
    render(state, root);
    try {
      await request("/reveal", { method: "POST", body: JSON.stringify({ target: "files", case: selectedCase.path, path: "Pi\xE8ces tamponn\xE9es" }) });
    } catch (cause) {
      state.error = errorMessage(cause);
    } finally {
      state.revealing = false;
      if (!state.disposed) render(state, root);
    }
  }
}
function mount(container, api) {
  const style = document.createElement("style");
  style.textContent = STYLE_TEXT;
  const root = document.createElement("div");
  root.className = "pm-stamp";
  container.replaceChildren(style, root);
  const state = {
    context: api.context,
    cases: [],
    selectedCaseId: null,
    originals: [],
    selectedOrder: [],
    savedImage: null,
    pendingImage: null,
    config: { ...DEFAULT_STAMP_CONFIG },
    loadingCases: false,
    loadingOriginals: false,
    loadingStamp: false,
    savingStamp: false,
    deletingStamp: false,
    running: false,
    revealing: false,
    error: null,
    stampError: null,
    runResult: null,
    disposed: false,
    loadSequence: 0,
    unsubscribe: null
  };
  states.set(container, state);
  root.addEventListener("click", (event) => {
    const target = event.target;
    const actionTarget = target.closest("[data-action]");
    if (actionTarget) void handleAction(state, root, actionTarget.dataset.action || "");
    const fieldTarget = target.closest("[data-field]");
    if (fieldTarget) {
      const field = fieldTarget.dataset.field;
      state.config = { ...state.config, [field]: fieldTarget.dataset.value };
      render(state, root);
    }
    const pieceTarget = target.closest("[data-piece]");
    if (pieceTarget) {
      const path = pieceTarget.dataset.piece || "";
      state.selectedOrder = state.selectedOrder.includes(path) ? state.selectedOrder.filter((entry) => entry !== path) : [...state.selectedOrder, path];
      render(state, root);
    }
    const moveTarget = target.closest("[data-move]");
    if (moveTarget) {
      const [indexText, directionText] = (moveTarget.dataset.move || "").split(":");
      const index = Number(indexText);
      const targetIndex = index + Number(directionText);
      if (targetIndex >= 0 && targetIndex < state.selectedOrder.length) {
        const next = [...state.selectedOrder];
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        state.selectedOrder = next;
        render(state, root);
      }
    }
    const removeTarget = target.closest("[data-remove]");
    if (removeTarget) {
      state.selectedOrder = state.selectedOrder.filter((entry) => entry !== removeTarget.dataset.remove);
      render(state, root);
    }
  });
  root.addEventListener("change", (event) => {
    const target = event.target;
    if (target.matches("[data-case]")) {
      state.selectedCaseId = target.value || null;
      state.selectedOrder = [];
      state.runResult = null;
      void loadOriginals(state, root);
    }
    if (target.matches("[data-file]")) {
      const file = target instanceof HTMLInputElement ? target.files?.[0] : void 0;
      target.value = "";
      if (!file) return;
      if (file.type !== "image/png" && file.type !== "image/jpeg") {
        state.stampError = "Format non support\xE9. Utilisez une image PNG ou JPEG.";
        render(state, root);
        return;
      }
      void readFileAsDataUrl(file).then((image) => {
        state.pendingImage = image;
        state.stampError = null;
        render(state, root);
      }).catch((cause) => {
        state.stampError = errorMessage(cause);
        render(state, root);
      });
    }
    const configTarget = target.closest("[data-config]");
    if (configTarget) {
      const field = configTarget.dataset.config;
      const value = field === "lineWidth" ? Number(configTarget.value) : configTarget.value;
      state.config = { ...state.config, [field]: value };
      render(state, root);
    }
  });
  state.unsubscribe = api.onContextChange((context) => {
    if (state.disposed) return;
    state.context = context;
    void loadCases(state, root);
  });
  render(state, root);
  void loadStamp(state, root);
  void loadCases(state, root);
}
function unmount(container) {
  const state = states.get(container);
  if (state) {
    state.disposed = true;
    state.unsubscribe?.();
    states.delete(container);
  }
  container.replaceChildren();
}
export {
  mount,
  unmount
};
