#!/usr/bin/env node
// Carte des outils : lit le code source en direct et produit le graphe des
// instructions internes envoyées à l'agent (MCP, hérisson, injections de
// contexte, hooks dont le Stop). Chaque instruction éditable pointe vers un
// emplacement précis du fichier source ; l'éditer réécrit ce fichier.
//
// Usage :
//   node scripts/carte-outils/graph.mjs --embed   # régénère l'instantané dans docs/carte-outils.html
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PLUGIN = 'server/piecemaker/vendor/piecemaker-plugin';
const MCP_DIR = 'server/piecemaker/vendor/mcp';
const MCP_SERVERS = ['legifrance', 'features', 'artifacts', 'orchestrateur', 'fil'];
export const PAGE = 'docs/carte-outils.html';
const INJECTION = /additionalContext|systemMessage|permissionDecisionReason/;
const DESCRIPTION = /\bdescription:|\binstructions:/;
const LITERAL = /(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g;

const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (root, file) => fs.existsSync(path.join(root, file));

// Littéraux de texte (au moins une espace, 20 caractères) présents sur une ligne.
function textLiterals(line) {
  const found = [];
  for (const match of line.matchAll(LITERAL)) {
    const [, quote, raw] = match;
    if (raw.length >= 20 && /\s/.test(raw)) found.push({ quote, raw, col: match.index });
  }
  return found;
}

// Numéros de ligne (1-based) de chaque occurrence de `needle`, dans l'ordre.
function lineNumbersOf(text, needle) {
  return text.split('\n').flatMap((line, i) => (line.includes(needle) ? [i + 1] : []));
}

function instructionId(file, line, col) {
  return `${file}:${line}:${col}`;
}

export function buildGraph(root = ROOT) {
  const items = {};
  const nodes = new Map();
  const edges = [];
  const addNode = (id, kind, label, sub = '') => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, sub });
    return id;
  };
  const addItem = (item) => {
    items[item.id] = item;
    return item.id;
  };
  const addEdge = (from, to, label, itemIds = []) => {
    edges.push({ id: `e${edges.length + 1}`, from, to, label, items: itemIds });
  };

  addNode('moteur', 'moteur', 'Moteur PieceMaker', 'Claude, via le proxy');

  // --- MCP : descriptions des outils exposées au modèle --------------------
  for (const name of MCP_SERVERS) {
    const file = `${MCP_DIR}/${name}/server.mjs`;
    addNode(`mcp:${name}`, 'mcp', `MCP ${name}`, file);
    const itemIds = [];
    if (exists(root, file)) {
      read(root, file).split('\n').forEach((line, i) => {
        if (!DESCRIPTION.test(line)) return;
        for (const lit of textLiterals(line)) {
          itemIds.push(addItem({ id: instructionId(file, i + 1, lit.col), file, line: i + 1, col: lit.col, quote: lit.quote, raw: lit.raw, lang: 'js', label: `Description d'outil · ${name}` }));
        }
      });
    }
    addEdge('moteur', `mcp:${name}`, 'appelle ses outils', itemIds);
  }

  // --- Hooks (hooks.json) ---------------------------------------------------
  const hooksFile = `${PLUGIN}/hooks/hooks.json`;
  const hooksText = read(root, hooksFile);
  const hooks = JSON.parse(hooksText);
  const matcherLines = lineNumbersOf(hooksText, '"matcher"');
  let matcherIndex = 0;
  const scripts = new Set();
  for (const [event, groups] of Object.entries(hooks.hooks)) {
    groups.forEach((group, gi) => {
      const matcher = group.matcher;
      const hookId = addNode(`hook:${event}:${gi}`, 'hook', matcher ? `${event} · ${matcher}` : event, 'hooks.json');
      const matcherItems = [];
      if (matcher !== undefined) {
        const line = matcherLines[matcherIndex++];
        const text = hooksText.split('\n')[line - 1];
        const col = text.indexOf('"', text.indexOf('"matcher"') + 9);
        matcherItems.push(addItem({ id: instructionId(hooksFile, line, col), file: hooksFile, line, col, quote: '"', raw: matcher, lang: 'json', label: `Déclencheur (matcher) · ${event}` }));
      }
      addEdge('moteur', hookId, event, matcherItems);
      for (const hook of group.hooks || []) {
        const script = /scripts\/([\w.-]+)/.exec(hook.command || '')?.[1];
        if (!script) continue;
        scripts.add(script);
        addNode(`script:${script}`, 'script', script, `${PLUGIN}/scripts/${script}`);
        addEdge(hookId, `script:${script}`, 'exécute');
        for (const name of MCP_SERVERS) {
          if (matcher && matcher.includes(name) && matcher.includes('mcp')) addEdge(`mcp:${name}`, hookId, 'déclenche');
        }
      }
      if (matcher && /research-maker/.test(matcher)) {
        addNode('agent:research-maker', 'agent', 'Sous-agent research-maker', `${PLUGIN}/agents/research-maker.md`);
        addEdge(hookId, 'agent:research-maker', 'surveille');
      }
    });
  }

  // --- Injections de contexte dans les scripts ------------------------------
  for (const script of scripts) {
    const file = `${PLUGIN}/scripts/${script}`;
    if (!exists(root, file)) continue;
    const itemIds = [];
    read(root, file).split('\n').forEach((line, i) => {
      if (!INJECTION.test(line)) return;
      for (const lit of textLiterals(line)) {
        itemIds.push(addItem({ id: instructionId(file, i + 1, lit.col), file, line: i + 1, col: lit.col, quote: lit.quote, raw: lit.raw, lang: 'js', label: `Injection de contexte · ${script}` }));
      }
    });
    if (itemIds.length) {
      addNode(`inj:${script}`, 'injection', `Injections · ${script}`, file);
      addEdge(`script:${script}`, `inj:${script}`, 'injecte', itemIds);
    }
  }

  // --- Hérisson (herisson.json) ---------------------------------------------
  const herissonFile = `${PLUGIN}/herisson.json`;
  const herissonText = read(root, herissonFile);
  const herisson = JSON.parse(herissonText);
  addNode('script:herisson.mjs', 'script', 'herisson.mjs', `${PLUGIN}/scripts/herisson.mjs`);
  for (const feature of herisson.features) {
    const featureId = addNode(`feature:${feature.nom}`, 'feature', `Hérisson · ${feature.nom}`, `${herissonFile}`);
    const itemIds = [];
    if (feature.motif) {
      const raw = JSON.stringify(feature.motif).slice(1, -1);
      const needle = `"motif": "${raw}"`;
      const idx = herissonText.indexOf(needle);
      if (idx >= 0) {
        const line = herissonText.slice(0, idx).split('\n').length;
        const col = idx + '"motif": '.length;
        itemIds.push(addItem({ id: instructionId(herissonFile, line, col), file: herissonFile, line, col, quote: '"', raw, lang: 'json', label: `Motif · ${feature.nom}` }));
      }
    }
    addEdge('script:herisson.mjs', featureId, 'vérifie', itemIds);
  }

  return {
    generatedAt: new Date().toISOString(),
    nodes: [...nodes.values()],
    edges,
    items,
  };
}

// Réécrit une instruction dans son fichier source. Refuse si le texte d'origine
// n'est plus à la position connue, et annule si le fichier ne se valide plus.
export function applyEdit(root, id, newRaw) {
  if (/[\r\n]/.test(newRaw)) throw new Error('Une instruction tient sur une seule ligne.');
  const item = buildGraph(root).items[id];
  if (!item) throw new Error('Instruction introuvable dans le code.');
  const abs = path.join(root, item.file);
  const original = fs.readFileSync(abs, 'utf8');
  const lines = original.split('\n');
  const line = lines[item.line - 1];
  const start = item.col + 1;
  if (line.slice(start, start + item.raw.length) !== item.raw || line[start + item.raw.length] !== item.quote) {
    throw new Error('Le code a changé depuis la lecture. Rechargez la carte.');
  }
  lines[item.line - 1] = line.slice(0, start) + newRaw + line.slice(start + item.raw.length);
  fs.writeFileSync(abs, lines.join('\n'));
  try {
    if (item.lang === 'json') JSON.parse(fs.readFileSync(abs, 'utf8'));
    else execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
  } catch (error) {
    fs.writeFileSync(abs, original);
    const detail = String(error.stderr || error.message).split('\n').slice(0, 4).join('\n');
    throw new Error(`Modification refusée, le fichier ne se valide plus :\n${detail}`);
  }
  return { file: item.file, line: item.line };
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

// Commit des seuls fichiers d'instructions modifiés.
export function commitChanges(root, message) {
  const graph = buildGraph(root);
  const files = [...new Set(Object.values(graph.items).map((item) => item.file))];
  const changed = git(root, ['diff', '--name-only', '--', ...files]).split('\n').filter(Boolean);
  if (!changed.length) return { committed: false, reason: 'Aucun changement à commiter.' };
  git(root, ['add', '--', ...changed]);
  const subject = (message || '').trim() || `chore(carte-outils): ajuster ${changed.length} fichier(s) d'instructions`;
  git(root, ['commit', '-m', subject]);
  return { committed: true, files: changed, subject, commit: git(root, ['rev-parse', '--short', 'HEAD']) };
}

// Met l'instantané dans la page publiée (lecture seule hors serveur local).
export function embedSnapshot(root = ROOT) {
  const page = path.join(root, PAGE);
  const json = JSON.stringify(buildGraph(root)).replace(/<\//g, '<\\/');
  const html = fs.readFileSync(page, 'utf8').replace(
    /(<script id="snapshot" type="application\/json">)[\s\S]*?(<\/script>)/,
    (_, open, close) => `${open}${json}${close}`,
  );
  fs.writeFileSync(page, html);
  return page;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--embed')) {
    console.log(`Instantané écrit dans ${embedSnapshot()}`);
  } else {
    const graph = buildGraph();
    console.log(JSON.stringify({ nodes: graph.nodes.length, edges: graph.edges.length, instructions: Object.keys(graph.items).length }, null, 2));
  }
}
