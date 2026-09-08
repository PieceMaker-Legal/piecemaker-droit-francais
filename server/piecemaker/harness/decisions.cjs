'use strict';

/**
 * Capture des décisions Légifrance lues via l'outil MCP `consulter_decision`,
 * repérées dans un corps de requête SORTANTE déjà analysé en JSON par le
 * proxy PII (`server/piecemaker/anonymizer/proxy.cjs`).
 *
 * Équivalent serveur du hook `decision-cache.mjs` de l'autre dépôt
 * (`piecemaker-plugin/scripts/decision-cache.mjs`, PostToolUse Claude Code) :
 * ce dépôt n'a pas de hook, tout le trafic IA (chat et terminal) traverse ce
 * proxy, qui est donc la position équivalente pour intercepter le même appel
 * d'outil. `consulter_decision` est la seule des trois façons dont le MCP
 * Légifrance restitue une décision à ne jamais l'écrire sur disque — sans
 * cette capture, une citation portant sur une décision lue par cet outil
 * resterait invérifiable (voir `citation-sources.cjs` côté vendor).
 *
 * Deux formes de charge utile à couvrir, selon le fournisseur :
 *  - **Anthropic Messages** (`payload.messages[]`) : un bloc assistant
 *    `{type:'tool_use', id, name, input}` porte le nom de l'outil et ses
 *    arguments, un bloc user `{type:'tool_result', tool_use_id, content}`
 *    porte la réponse — appariés par `tool_use_id` -> `id`.
 *  - **OpenAI Responses** (`payload.input[]`) : `{type:'function_call',
 *    call_id, name, arguments}` (arguments = JSON en chaîne) et
 *    `{type:'function_call_output', call_id, output}`, appariés par
 *    `call_id`.
 *
 * Extraction du texte intégral (ancrage sur la bannière `TEXTE INTÉGRAL:`
 * entre lignes de `=`, coupure avant la ligne finale `Lien:`), validation de
 * l'identifiant et règle de non-régression (on n'écrit que si le texte
 * capturé est strictement plus long que celui déjà en cache) : copiées à
 * l'identique de `decision-cache.mjs`. Seul le champ `source` change
 * (`proxy-piecemaker` au lieu de `consulter_decision`), pour qu'on distingue
 * dans le cache lequel des deux canaux a écrit l'entrée.
 *
 * Fail-open comme tout le reste du harnais : `captureDecisions` ne jette
 * jamais, quelle que soit la charge utile reçue.
 */

const fs = require('node:fs');
const path = require('node:path');

// Un identifiant de décision Légifrance ne contient jamais de séparateur de
// chemin ni de point : cette forme fermée interdit toute évasion du dossier
// de cache, quelle que soit la valeur renvoyée par l'outil.
const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

const ANCHOR_RE = /TEXTE INTÉGRAL\s*:/;
const SEPARATOR_LINE_RE = /^=+[ \t]*$/m;
const LIEN_LINE_RE = /^Lien\s*:.*$/m;
const TITRE_LINE_RE = /^D\u00c9CISION\s*:[ \t]*(.+)$/m;
const MAX_TITRE_LENGTH = 300;

/** `true` seulement pour le suffixe `consulter_decision` d'un outil MCP. */
function isConsulterDecisionTool(toolName) {
  return typeof toolName === 'string' && toolName.startsWith('mcp__') && toolName.endsWith('__consulter_decision');
}

/** `true` pour un résultat d'outil marqué en erreur, sous ses graphies usuelles. */
function isErrorResult(result) {
  if (!result || typeof result !== 'object') return false;
  return result.is_error === true || result.isError === true || result.success === false;
}

/**
 * Aplatit le contenu d'un résultat d'outil en une seule chaîne, quelle que
 * soit la forme reçue : un tableau de blocs `{type:'text', text}`, un objet
 * `{text}`, ou une chaîne brute.
 */
function flattenContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .filter((block) => block && typeof block === 'object' && block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n');
  }
  if (value && typeof value === 'object' && typeof value.text === 'string') return value.text;
  return '';
}

/**
 * Extrait le texte intégral encadré par le second séparateur `=` (celui qui
 * suit la ligne `TEXTE INTÉGRAL:`) jusqu'à la ligne `Lien:` finale (exclue),
 * trimé. Si l'ancre `TEXTE INTÉGRAL:` est absente, conserve le texte complet
 * reçu tel quel — une source plus large qu'aucune source, la vérification
 * reste exacte dans les deux cas.
 */
function extractFullText(raw) {
  if (typeof raw !== 'string' || !raw) return '';

  const anchorMatch = ANCHOR_RE.exec(raw);
  if (!anchorMatch) return raw;

  const afterAnchor = raw.slice(anchorMatch.index + anchorMatch[0].length);
  const sepMatch = SEPARATOR_LINE_RE.exec(afterAnchor);
  if (!sepMatch) return raw;

  let body = afterAnchor.slice(sepMatch.index + sepMatch[0].length);
  const lienMatch = LIEN_LINE_RE.exec(body);
  if (lienMatch) body = body.slice(0, lienMatch.index);

  return body.trim();
}

/**
 * Renvoie le titre lisible de la décision (« Cour de cassation, civile,
 * Chambre commerciale, 23 janvier 2016, … ») porté par la ligne `DÉCISION:`
 * en tête du résultat d'outil, avant la bannière `TEXTE INTÉGRAL:`.
 * Chaîne vide si l'entête est absent : l'appelant retombe sur l'identifiant.
 */
function extractDecisionTitle(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  const anchorMatch = ANCHOR_RE.exec(raw);
  const header = anchorMatch ? raw.slice(0, anchorMatch.index) : raw;
  const match = TITRE_LINE_RE.exec(header);
  if (!match) return '';
  return match[1].trim().slice(0, MAX_TITRE_LENGTH);
}

function cacheFile(decisionsDir, id) {
  return path.join(decisionsDir, `${id}.json`);
}

function existingCachedLength(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof parsed?.texte === 'string' ? parsed.texte.length : -1;
  } catch {
    return -1;
  }
}

/** mkdir -p qui ne jette jamais — l'appelant vérifie la valeur de retour. */
function ensureDirSafe(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Écrit le cache pour une décision reconnue (identifiant + contenu brut du
 * résultat d'outil déjà appariés par l'appelant). Renvoie `true` si une
 * écriture a eu lieu.
 */
function writeDecisionCache(rawId, rawContent, { decisionsDir, session }) {
  const id = typeof rawId === 'string' ? rawId.trim() : '';
  if (!id || !ID_RE.test(id)) return false;

  const raw = flattenContent(rawContent);
  const texte = extractFullText(raw).trim();
  if (!texte) return false;
  const titre = extractDecisionTitle(raw);

  const file = cacheFile(decisionsDir, id);
  // Ne réécrit que si le texte capturé est strictement plus long que celui
  // déjà en cache : un appel ultérieur plus pauvre (erreur, troncature) ne
  // doit jamais dégrader une source déjà meilleure.
  if (texte.length <= existingCachedLength(file)) return false;

  if (!ensureDirSafe(decisionsDir)) return false;
  fs.writeFileSync(
    file,
    `${JSON.stringify(
      {
        kind: 'legifrance-decision',
        id,
        titre: titre || undefined,
        texte,
        caracteres: texte.length,
        source: 'proxy-piecemaker',
        session: session || null,
        at: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  return true;
}

/** Forme Anthropic Messages : `payload.messages[].content[]`. */
function captureFromAnthropicMessages(payload, options) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];

  // Le nom de l'outil n'est porté que par le bloc `tool_use` (assistant) :
  // on l'indexe par `id` pour l'apparier au `tool_result` (user) correspondant.
  const toolUseInputs = new Map();
  for (const message of messages) {
    const blocks = Array.isArray(message?.content) ? message.content : [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object' || block.type !== 'tool_use') continue;
      if (!isConsulterDecisionTool(block.name)) continue;
      toolUseInputs.set(block.id, block.input);
    }
  }
  if (!toolUseInputs.size) return 0;

  let count = 0;
  for (const message of messages) {
    const blocks = Array.isArray(message?.content) ? message.content : [];
    for (const block of blocks) {
      if (!block || typeof block !== 'object' || block.type !== 'tool_result') continue;
      const input = toolUseInputs.get(block.tool_use_id);
      if (!input) continue; // pas un appel `consulter_decision` reconnu
      if (isErrorResult(block)) continue;
      const rawId = input?.text_id ?? input?.id;
      if (writeDecisionCache(rawId, block.content, options)) count += 1;
    }
  }
  return count;
}

/** Forme OpenAI Responses : `payload.input[]`. */
function captureFromResponsesInput(payload, options) {
  const items = Array.isArray(payload.input) ? payload.input : [];

  const callInputs = new Map();
  for (const item of items) {
    if (!item || typeof item !== 'object' || item.type !== 'function_call') continue;
    if (!isConsulterDecisionTool(item.name)) continue;
    let input = {};
    try {
      input = JSON.parse(item.arguments);
    } catch {
      input = {};
    }
    callInputs.set(item.call_id, input);
  }
  if (!callInputs.size) return 0;

  let count = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object' || item.type !== 'function_call_output') continue;
    const input = callInputs.get(item.call_id);
    if (!input) continue; // pas un appel `consulter_decision` reconnu
    if (isErrorResult(item)) continue;
    const rawId = input?.text_id ?? input?.id;
    if (writeDecisionCache(rawId, item.output, options)) count += 1;
  }
  return count;
}

/**
 * Repère les résultats de l'outil `consulter_decision` dans `payload` (déjà
 * analysé en JSON) et écrit leur texte intégral dans
 * `<decisionsDir>/<id>.json`. Renvoie le nombre de décisions effectivement
 * écrites. Ne jette jamais : une charge utile inattendue renvoie simplement 0.
 */
function captureDecisions(payload, options = {}) {
  try {
    const { decisionsDir } = options;
    if (!payload || typeof payload !== 'object' || !decisionsDir) return 0;
    return (
      captureFromAnthropicMessages(payload, options) +
      captureFromResponsesInput(payload, options)
    );
  } catch {
    return 0;
  }
}

module.exports = {
  ID_RE,
  isConsulterDecisionTool,
  extractFullText,
  extractDecisionTitle,
  captureDecisions,
};
