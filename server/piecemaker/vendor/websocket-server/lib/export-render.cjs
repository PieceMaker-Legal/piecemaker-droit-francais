/**
 * Rendu HTML imprimable (A4) pour l'export PDF/DOCX.
 *
 * Fonctions pures : aucune lecture disque, aucun appel git, aucun accès
 * réseau — uniquement des données en entrée, une chaîne HTML en sortie. Le
 * HTML produit ici est ensuite converti, ailleurs dans le pipeline
 * (`doc-generate.cjs`) : par pandoc dans le cas nominal, avec un repli
 * intégral sur LibreOffice (headless) si pandoc est absent du poste. C'est
 * précisément ce repli qui oblige à garder le CSS volontairement pauvre
 * (aucun flexbox/grid, aucune ressource externe) et les attributs HTML
 * dupliqués sur chaque `<table>` : le moteur de rendu de LibreOffice ne
 * supporte ni l'un ni l'autre autrement.
 *
 * Attention : le lecteur HTML de pandoc est bien plus strict que celui de
 * LibreOffice et jette intégralement le CSS, `@page` compris — la mise en
 * page du PDF vient donc des métadonnées passées à pandoc, pas de ce
 * fichier. Si le rendu pandoc casse, trois constructions d'ici sont à
 * surveiller en priorité : les `colspan` (séparateur de jour ~ligne 312 et
 * ligne de total ~ligne 340), le `<tfoot>` (~ligne 339), et les `<br>` en
 * cellule (~lignes 239 et 243).
 */

const { formatDurationFr } = require('../../piecemaker-plugin/scripts/lib/session-timing.cjs');

/**
 * Échappe une valeur pour insertion dans du HTML. Il n'existe pas d'équivalent
 * serveur : celui d'admin/app.js tourne dans le navigateur (DOM `String.prototype`
 * suffit là-bas), mais ce module est du CommonJS pur côté Node.
 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Décumule le champ `PieceMaker-Temps-Session` : ce trailer de commit est le
 * temps écoulé depuis le DÉBUT de la session (cumulatif), pas le temps propre
 * à l'acte. On restitue `ownMs` = la part imputable à chaque commit, en
 * soustrayant le cumul du commit précédent de la même session.
 *
 * Ne mute jamais l'entrée : on renvoie de nouveaux objets, dans l'ordre du
 * tableau reçu (le tri par session/horodatage est purement interne au calcul).
 */
function decumulateDurations(entries) {
  if (!Array.isArray(entries)) return [];

  // Regroupement par sessionId. Une entrée sans sessionId (vide/null) forme
  // sa propre session à elle seule : son ownMs est directement sa durée.
  const groups = new Map(); // sessionId -> [{ entry, index }]
  const solo = []; // indices des entrées sans sessionId

  entries.forEach((entry, index) => {
    const sessionId = entry && entry.sessionId ? entry.sessionId : null;
    if (!sessionId) {
      solo.push(index);
      return;
    }
    if (!groups.has(sessionId)) groups.set(sessionId, []);
    groups.get(sessionId).push({ entry, index });
  });

  const ownMsByIndex = new Array(entries.length).fill(0);

  for (const index of solo) {
    const durationMs = entries[index] && Number.isFinite(entries[index].durationMs)
      ? entries[index].durationMs
      : 0;
    ownMsByIndex[index] = durationMs;
  }

  for (const items of groups.values()) {
    // Tri croissant par horodatage : le cumul du trailer ne progresse que dans
    // ce sens ; un ordre différent dans le tableau d'origine ne fausse donc pas
    // le calcul (on ne réordonne que cette copie de travail).
    // Départage par le cumul lui-même quand les horodatages sont identiques :
    // git les stocke à la seconde, et le hook PostToolUse commite à chaque
    // Write/Edit — deux actes tombent donc couramment dans la même seconde.
    // Sans ce départage, l'ordre de `git log` (antichronologique) l'emporte,
    // le décumul part du plus grand cumul et impute tout le temps au premier
    // acte rencontré, les suivants étant ramenés à 0. Le compteur de session
    // ne pouvant que croître, il est ici plus fiable que l'horodatage.
    const sorted = [...items].sort((a, b) => {
      const ta = Date.parse(a.entry.timestamp) || 0;
      const tb = Date.parse(b.entry.timestamp) || 0;
      if (ta !== tb) return ta - tb;
      const da = Number.isFinite(a.entry.durationMs) ? a.entry.durationMs : 0;
      const db = Number.isFinite(b.entry.durationMs) ? b.entry.durationMs : 0;
      return da - db;
    });
    let previousCumulative = 0;
    for (const { entry, index } of sorted) {
      if (!Number.isFinite(entry.durationMs)) {
        // Pas de trailer de temps sur cet acte : on ne peut rien lui imputer.
        // Surtout, on ne touche pas `previousCumulative` — sinon l'acte
        // suivant se retrouverait à tort décumulé depuis 0, et gonflerait
        // artificiellement son propre temps.
        ownMsByIndex[index] = 0;
        continue;
      }
      const cumulative = entry.durationMs;
      // Un écart négatif signale des horodatages désordonnés ou une reprise de
      // session (le compteur repart plus bas) : on ramène à 0 plutôt que de
      // retrancher du temps qui n'existe pas.
      ownMsByIndex[index] = Math.max(0, cumulative - previousCumulative);
      previousCumulative = cumulative;
    }
  }

  return entries.map((entry, index) => ({ ...entry, ownMs: ownMsByIndex[index] }));
}

/** Enveloppe HTML commune : squelette + CSS inline, sobre pour LibreOffice. */
function documentHtml({ title, byline, subtitle, bodyHtml }) {
  const safeTitle = escapeHtml(title || '');
  const safeByline = byline ? escapeHtml(byline) : '';
  const safeSubtitle = subtitle ? escapeHtml(subtitle) : '';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>
  @page { size: A4; margin: 2cm; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10pt;
    color: #1a1a1a;
    line-height: 1.35;
  }
  h1 {
    color: #183153;
    font-size: 19pt;
    margin: 0 0 6px 0;
    padding-bottom: 7px;
    border-bottom: 3px solid #2f6f9f;
  }
  .export-byline {
    font-size: 10pt;
    color: #183153;
    margin: 0 0 5px 0;
  }
  .export-subtitle {
    font-size: 9pt;
    color: #555555;
    margin: 0 0 18px 0;
  }
  h2 {
    font-size: 12pt;
    margin: 20px 0 8px 0;
    border-bottom: 1px solid #999999;
    padding-bottom: 2px;
  }
  /* Le CSS ci-dessous sert à la lecture du HTML dans un navigateur. À
     l'import, LibreOffice ignore la largeur et les bordures déclarées en CSS :
     seuls les attributs HTML width/border/cellspacing posés sur chaque table
     survivent à la conversion. Les deux sont donc nécessaires — ne retirer ni
     l'un ni l'autre. Ces attributs sont inutiles à pandoc (qui jette tout le
     CSS et ignore ces attributs HTML de toute façon), mais indispensables au
     repli LibreOffice : à conserver pour cette seule raison. */
  table {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 12px;
    font-size: 9pt;
  }
  th, td {
    border: 1px solid #bbbbbb;
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
  }
  th {
    background-color: #e8e8e8;
    font-weight: bold;
  }
  tfoot td {
    font-weight: bold;
    background-color: #f2f2f2;
  }
  .export-daysep td {
    background-color: #f2f2f2;
    font-weight: bold;
  }
  .export-task-title {
    font-weight: bold;
    color: #183153;
    font-size: 10pt;
  }
  .export-task-comment {
    margin-top: 4px;
    color: #3f4852;
  }
  .export-task-files-label {
    margin-top: 6px;
    color: #66717d;
    font-size: 8pt;
  }
  .export-task-files {
    margin: 2px 0 0 18px;
    padding: 0;
    color: #66717d;
    font-size: 8pt;
  }
  .export-task-time {
    text-align: right;
    white-space: nowrap;
    color: #183153;
    font-weight: bold;
  }
  .export-task-date {
    color: #3f4852;
    white-space: nowrap;
  }
  .export-timesheet th {
    background-color: #183153;
    color: #ffffff;
    border-color: #183153;
    padding: 7px 8px;
  }
  .export-timesheet td {
    border-color: #d7dee5;
    padding: 8px;
  }
  .export-timesheet tbody tr:nth-child(even) td {
    background-color: #f7f9fb;
  }
  .export-timesheet tfoot td {
    background-color: #eaf1f6;
    border-top: 2px solid #2f6f9f;
    padding: 8px;
  }
  .export-empty {
    color: #777777;
    font-style: italic;
  }
</style>
</head>
<body>
<h1>${safeTitle}</h1>
${safeByline ? `<p class="export-byline"><strong>${safeByline}</strong></p>` : ''}
${safeSubtitle ? `<p class="export-subtitle">${safeSubtitle}</p>` : ''}
${bodyHtml}
</body>
</html>`;
}

/** Rendu HTML papier de la feuille de temps (commits) d'un mois donné. */
function renderHistoryHtml(entries, { caseName, month } = {}) {
  const decumulated = decumulateDurations(Array.isArray(entries) ? entries : []);

  const monthLabel = formatMonthFr(month);
  const subtitle = `${caseName ? `Dossier « ${caseName} » — ` : ''}${monthLabel || (month || '')}`;
  const authors = [...new Set(decumulated
    .map((item) => String(item.author || '').trim())
    .filter(Boolean))];
  const byline = authors.length
    ? `${authors.length > 1 ? 'Auteurs' : 'Auteur'} : ${authors.join(', ')}`
    : '';

  const rows = [];
  let totalMs = 0;

  for (const item of decumulated) {
    const timestamp = item.timestamp ? new Date(item.timestamp) : null;
    const validDate = timestamp && !Number.isNaN(timestamp.getTime());
    const date = validDate
      ? timestamp.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : 'Date inconnue';

    const ownMs = Number.isFinite(item.ownMs) ? item.ownMs : 0;
    totalMs += ownMs;
    const tempsLabel = ownMs > 0 ? (formatDurationFr(ownMs) || '—') : '—';
    const comment = String(item.comment || '').trim();
    const commentHtml = comment
      ? `<div class="export-task-comment"><em>${escapeHtml(comment).replace(/\r?\n/g, '<br>')}</em></div>`
      : '';
    const files = Array.isArray(item.files) ? item.files : [];
    const filesHtml = files.length
      ? `<div class="export-task-files-label"><em>Fichiers modifiés :</em></div>
        <ul class="export-task-files">${files.map((file) => `<li>${escapeHtml(file)}</li>`).join('')}</ul>`
      : '<div class="export-task-files-label"><em>Fichiers modifiés : aucun</em></div>';

    rows.push(`<tr>
      <td width="18%" class="export-task-date"><strong>${escapeHtml(date)}</strong></td>
      <td width="64%"><strong class="export-task-title">${escapeHtml(item.subject || '')}</strong>${commentHtml}${filesHtml}</td>
      <td width="18%" class="export-task-time"><strong>${escapeHtml(tempsLabel)}</strong></td>
    </tr>`);
  }

  const totalLabel = totalMs > 0 ? (formatDurationFr(totalMs) || '—') : '—';

  const bodyHtml = `
<table class="export-timesheet" width="100%" border="1" cellspacing="0" cellpadding="7">
  <colgroup><col width="18%"><col width="64%"><col width="18%"></colgroup>
  <thead>
    <tr><th width="18%">Date</th><th width="64%">Tâches réalisées</th><th width="18%">Temps passé total</th></tr>
  </thead>
  <tbody>
    ${rows.length ? rows.join('\n') : '<tr><td colspan="3" class="export-empty">Aucune tâche pour cette période.</td></tr>'}
  </tbody>
  <tfoot>
    <tr><td colspan="2"><strong>Total du mois</strong></td><td class="export-task-time"><strong>${escapeHtml(totalLabel)}</strong></td></tr>
  </tfoot>
</table>`;

  return documentHtml({ title: 'Feuille de temps', byline, subtitle, bodyHtml });
}

/** `'2026-08'` → `'août 2026'`. Entrée invalide → null. */
function formatMonthFr(month) {
  if (typeof month !== 'string') return null;
  const match = month.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const [, year, monthNum] = match;
  const asDate = new Date(`${year}-${monthNum}-01T00:00:00Z`);
  if (Number.isNaN(asDate.getTime())) return null;
  return asDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

module.exports = {
  escapeHtml,
  documentHtml,
  decumulateDurations,
  renderHistoryHtml,
};
