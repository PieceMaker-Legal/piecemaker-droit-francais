const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

const mike = createRequire('/app/package.json');
const yaml = mike('yaml');
const JSZip = mike('jszip');
const source = mike('/app/dist/lib/workflowCatalogSource.js');
const originalPrepare = source.prepareWorkflowCatalog;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');

function skillMarkdown(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\s*\n([\s\S]*)$/.exec(content);
  if (!match) throw new Error('Le skill doit contenir ses métadonnées YAML.');
  return { metadata: yaml.parse(match[1]), body: match[2] };
}

source.prepareWorkflowCatalog = async (...args) => {
  const prepared = await originalPrepare(...args);
  const catalog = JSON.parse(await fs.readFile(prepared.catalogPath, 'utf8'));
  const defaults = JSON.parse(await fs.readFile('/piecemaker-defaults/catalog.json', 'utf8'));
  for (const entry of defaults.defaults) {
    const workflow = catalog.workflows.find((item) => item.workflow_key === entry.key);
    if (!workflow) throw new Error(`Workflow par défaut manquant : ${entry.key}`);
    const directory = path.join('/piecemaker-defaults', entry.type === 'tabular' ? 'tabular-review-workflows' : 'assistant-workflows', entry.key);
    const translated = skillMarkdown(await fs.readFile(path.join(directory, 'SKILL.md'), 'utf8'));
    workflow.title = entry.title;
    workflow.description = translated.metadata.description;
    workflow.prompt_md = translated.body;
    workflow.language = 'Français';
    if (entry.quick_action) {
      workflow.quick_action_name = entry.title;
      workflow.quick_action_prompt = defaults.quick_actions.find((item) => item.key === entry.key).prompt;
    }
    if (entry.word_quick_action) workflow.word_quick_action_prompt = defaults.quick_actions.find((item) => item.key === entry.key).word_prompt;
    if (entry.type === 'tabular') {
      const columns = yaml.parse(await fs.readFile(path.join(directory, 'table-columns.yaml'), 'utf8'));
      workflow.columns_config = columns.table?.columns ?? columns.columns;
    }
    workflow.content_hash = hash(JSON.stringify(workflow));
  }
  const repository = 'PieceMaker-Legal/claude-for-legal-fr';
  const headers = { 'User-Agent': 'PieceMaker', Accept: 'application/vnd.github+json' };
  const revision = await fetch(`https://api.github.com/repos/${repository}/commits/main`, { headers, signal: AbortSignal.timeout(30000) });
  if (!revision.ok) throw new Error(`Catalogue français indisponible (${revision.status}).`);
  const { sha } = await revision.json();
  if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error('Révision du catalogue français invalide.');
  const response = await fetch(`https://codeload.github.com/${repository}/zip/${sha}`, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Archive française indisponible (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Archive française trop volumineuse.');
  const zip = await JSZip.loadAsync(bytes);
  const definitions = Object.values(zip.files).filter((entry) => !entry.dir && /\/skills\/[^/]+\/SKILL\.md$/.test(entry.name));
  for (const definition of definitions) {
    const parts = definition.name.split('/');
    const family = parts[parts.length - 4];
    const skill = parts[parts.length - 2];
    const key = `cflfr-${family}-${skill}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const raw = await definition.async('string');
    const parsed = skillMarkdown(raw);
    const prefix = definition.name.slice(0, -'SKILL.md'.length);
    const supports = Object.values(zip.files).filter((entry) => !entry.dir && entry.name.startsWith(prefix) && entry.name !== definition.name);
    const assets = [];
    for (const [index, file] of supports.entries()) {
      if (assets.length >= 50) throw new Error(`Trop de ressources dans ${key}.`);
      const content = await file.async('nodebuffer');
      if (content.length > 5 * 1024 * 1024) throw new Error(`Ressource trop volumineuse dans ${key}.`);
      const filename = file.name.slice(prefix.length).replaceAll('/', '__');
      const temporary_path = path.join(prepared.directory, `${key}-${index}`);
      await fs.writeFile(temporary_path, content, { mode: 0o600 });
      assets.push({ filename, file_type: path.extname(filename).slice(1) || 'txt', size_bytes: content.length, content_hash: hash(content), temporary_path });
    }
    const title = parsed.metadata.metadata?.['mike-display-name'] || parsed.metadata.name || skill;
    const workflow = {
      workflow_key: key, distribution: 'addon', version: String(parsed.metadata.metadata?.version || '1.0.0'),
      title, description: String(parsed.metadata.description || ''), type: 'assistant', prompt_md: parsed.body,
      columns_config: null, contributors: [{ name: 'Claude for Legal France', organisation: 'PieceMaker Legal', role: null, linkedin: null }],
      language: 'Français', practice: family, jurisdictions: ['France'], pack_key: `claude-for-legal-fr-${family}`,
      pack_title: `Claude for Legal France · ${family}`, pack_description: `https://github.com/${repository}`, pack_version: sha.slice(0, 12),
      default_sort_order: null, quick_action_name: null, quick_action_prompt: null, document_upload: false,
      word_quick_action: false, word_quick_action_prompt: null, assets,
    };
    workflow.content_hash = hash(JSON.stringify(workflow));
    catalog.workflows.push(workflow);
  }
  await fs.writeFile(prepared.catalogPath, JSON.stringify(catalog));
  return prepared;
};

const { createServerSupabase } = mike('/app/dist/lib/supabase.js');
const { syncWorkflowCatalog } = mike('/app/dist/lib/workflowCatalogSync.js');
syncWorkflowCatalog(createServerSupabase()).then((result) => process.stdout.write(`${JSON.stringify(result)}\n`)).catch((error) => {
  process.stderr.write(`Synchronisation des catalogues impossible : ${error.message}\n`);
  process.exitCode = 1;
});
