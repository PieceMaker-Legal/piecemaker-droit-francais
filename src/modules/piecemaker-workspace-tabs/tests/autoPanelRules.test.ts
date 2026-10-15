import { describe, expect, it } from 'vitest';

import { autoPanelTarget, draftFromResult, panelShowDecision } from '@/modules/piecemaker-workspace-tabs/autoPanelRules';

describe('autoPanelTarget', () => {
  it('ouvre le .docx traité par docx-cli', () => {
    expect(autoPanelTarget('Bash', { command: 'docx replace "Actes/Assignation Dupont.docx" --find a --replace b' })).toEqual({ kind: 'file', path: 'Actes/Assignation Dupont.docx' });
    expect(autoPanelTarget('Bash', { command: 'cd Actes && docx read conclusions.docx' })).toEqual({ kind: 'file', path: 'conclusions.docx' });
    expect(autoPanelTarget('Bash', { command: '~/.local/bin/docx track-changes list Mes\\ conclusions.docx' })).toEqual({ kind: 'file', path: 'Mes conclusions.docx' });
  });

  it('ignore les commandes Bash sans docx-cli ou sans fichier', () => {
    expect(autoPanelTarget('Bash', { command: 'ls *.docx' })).toBeNull();
    expect(autoPanelTarget('Bash', { command: 'pandoc acte.docx -o acte.md' })).toBeNull();
    expect(autoPanelTarget('Bash', { command: 'docx --version' })).toBeNull();
  });

  it('affiche le plan quel que soit le fournisseur', () => {
    expect(autoPanelTarget('ExitPlanMode', { plan: '# Plan\n\n1. Rédiger', planFilePath: '/Users/jean/.claude/plans/vif-ruisseau.md' })).toEqual({ kind: 'plan', plan: { kind: 'proposed', file: '/Users/jean/.claude/plans/vif-ruisseau.md', markdown: '# Plan\n\n1. Rédiger' } });
    expect(autoPanelTarget('exit_plan_mode', JSON.stringify({ plan: '# Plan Codex' }))).toEqual({ kind: 'plan', plan: { kind: 'proposed', file: null, markdown: '# Plan Codex' } });
    expect(autoPanelTarget('Write', { file_path: '/Users/jean/.claude/plans/vif-ruisseau.md', content: '# Plan' })).toEqual({ kind: 'plan', plan: { kind: 'written', file: '/Users/jean/.claude/plans/vif-ruisseau.md', markdown: '# Plan' } });
    expect(autoPanelTarget('write_file', JSON.stringify({ path: '/Users/jean/.vibe/plans/1783013478-keen-rustic-vale.md', content: '# Plan Vibe' }))).toEqual({ kind: 'plan', plan: { kind: 'written', file: '/Users/jean/.vibe/plans/1783013478-keen-rustic-vale.md', markdown: '# Plan Vibe' } });
    expect(autoPanelTarget('edit', { file_path: '/Users/jean/.vibe/plans/1783013478-keen-rustic-vale.md', old_string: 'a', new_string: 'b' })).toEqual({ kind: 'plan', plan: { kind: 'edited', file: '/Users/jean/.vibe/plans/1783013478-keen-rustic-vale.md', find: 'a', replace: 'b', all: false } });
  });

  it('ne prend pas pour un plan un fichier ordinaire', () => {
    expect(autoPanelTarget('Write', { file_path: 'Dossier/plans/plan.md', content: '# Plan' })).toBeNull();
    expect(autoPanelTarget('write_file', { path: '/Users/jean/.vibe/plans/notes.txt', content: 'x' })).toBeNull();
  });

  it('ouvre le .docx écrit ou édité par l’agent', () => {
    expect(autoPanelTarget('Write', { file_path: 'Actes/Assignation.docx', content: 'x' })).toEqual({ kind: 'file', path: 'Actes/Assignation.docx' });
    expect(autoPanelTarget('write_file', JSON.stringify({ path: 'Actes/conclusions.docx', content: 'x' }))).toEqual({ kind: 'file', path: 'Actes/conclusions.docx' });
    expect(autoPanelTarget('Edit', { file_path: 'Actes/Assignation.docx', old_string: 'a', new_string: 'b' })).toEqual({ kind: 'file', path: 'Actes/Assignation.docx' });
    expect(autoPanelTarget('Write', { file_path: 'notes.md', content: 'x' })).toBeNull();
  });

  it('ouvre la chronologie quand le SQL modifie les pièces', () => {
    expect(autoPanelTarget('mcp__piecemaker__sql', { requete: "UPDATE piecemaker_nodes SET doc_date='2024-03-01' WHERE id='doc:1'" })).toEqual({ kind: 'dossier', view: 'chronology' });
    expect(autoPanelTarget('mcp__piecemaker__sql', { requete: "INSERT INTO piecemaker_nodes(project_id, id, kind, label) VALUES (dossier(), 'p:1', 'person', 'Jean Dupont')" })).toEqual({ kind: 'dossier', view: 'general' });
    expect(autoPanelTarget('mcp__piecemaker__sql', { requete: 'SELECT label FROM piecemaker_nodes' })).toBeNull();
  });

  it('suit les outils PieceMaker quel que soit le préfixe du fournisseur', () => {
    expect(autoPanelTarget('mcp__piecemaker__chronologie', { action: 'lister' })).toEqual({ kind: 'dossier', view: 'chronology' });
    expect(autoPanelTarget('piecemaker.chronologie', {})).toEqual({ kind: 'dossier', view: 'chronology' });
    expect(autoPanelTarget('mcp__piecemaker__tabular_review', { action: 'preparer' })).toEqual({ kind: 'tabular-review', review: null, awaitDraft: true });
    expect(autoPanelTarget('mcp__piecemaker__tabular_review', { action: 'preparer', projet: 'p-1' })).toEqual({ kind: 'tabular-review', review: null, draft: 'p-1' });
    expect(autoPanelTarget('mcp__piecemaker__tabular_review', { action: 'ouvrir', projet: 'p-1' })).toEqual({ kind: 'tabular-review', review: null, draft: 'p-1' });
    expect(autoPanelTarget('mcp__piecemaker__tabular_review', { action: 'modeles' })).toBeNull();
    expect(autoPanelTarget('mcp__piecemaker__tabular_review', { action: 'ouvrir', fichier: 'Tabular Review/26-10-11 - Analyse.json' })).toEqual({ kind: 'tabular-review', review: '26-10-11 - Analyse.json' });
    expect(autoPanelTarget('mcp__legifrance__sql', { requete: 'UPDATE piecemaker_nodes SET doc_date=NULL' })).toBeNull();
  });

  it('lit le projet préparé dans le résultat de tabular_review', () => {
    expect(draftFromResult('{"projet":"3f2a-b1","nom":"Exemple"}')).toBe('3f2a-b1');
    expect(draftFromResult([{ type: 'text', text: '{"projet":"p-2"}' }])).toBe('p-2');
    expect(draftFromResult('Action inconnue')).toBeNull();
  });

  it('obéit à afficher', () => {
    expect(autoPanelTarget('mcp__piecemaker__afficher', { fichier: 'Pièces/contrat.pdf' })).toEqual({ kind: 'file', path: 'Pièces/contrat.pdf' });
    expect(autoPanelTarget('mcp__piecemaker__afficher', { volet: 'chronologie' })).toEqual({ kind: 'dossier', view: 'chronology' });
    expect(autoPanelTarget('mcp__piecemaker__afficher', { volet: 'dossier' })).toEqual({ kind: 'dossier', view: 'general' });
    expect(autoPanelTarget('mcp__piecemaker__afficher', { volet: 'tabular-review', review: 'revue.json' })).toEqual({ kind: 'tabular-review', review: 'revue.json' });
    expect(autoPanelTarget('mcp__piecemaker__afficher', { volet: 'tampon' })).toEqual({ kind: 'tampon' });
    expect(autoPanelTarget('mcp__piecemaker__afficher', { volet: 'chronologie', fermer: true })).toBeNull();
    expect(autoPanelTarget('mcp__piecemaker__afficher', {})).toBeNull();
  });

  it('ouvre les volets depuis le script Skill-PieceMaker', () => {
    expect(autoPanelTarget('Bash', { command: '.agents/skills/Skill-PieceMaker/scripts/pm afficher --fichier Pièces/contrat.pdf' })).toEqual({ kind: 'file', path: 'Pièces/contrat.pdf' });
    expect(autoPanelTarget('run_terminal_command', { command: "scripts/pm afficher --volet chronologie" })).toEqual({ kind: 'dossier', view: 'chronology' });
    expect(autoPanelTarget('Bash', { command: 'scripts/pm afficher --volet dossier' })).toEqual({ kind: 'dossier', view: 'general' });
    expect(autoPanelTarget('Bash', { command: 'scripts/pm chronologie lister' })).toEqual({ kind: 'dossier', view: 'chronology' });
    expect(autoPanelTarget('Bash', { command: 'scripts/pm tabular_review ouvrir --fichier "Tabular Review/26-10-11 - Analyse.json"' })).toEqual({ kind: 'tabular-review', review: '26-10-11 - Analyse.json' });
    expect(autoPanelTarget('Bash', { command: "scripts/pm sql --requete \"UPDATE piecemaker_nodes SET doc_date='2024-03-01' WHERE id='doc:1'\"" })).toEqual({ kind: 'dossier', view: 'chronology' });
    expect(autoPanelTarget('Bash', { command: 'node .agents/skills/Skill-PieceMaker/scripts/pm.mjs afficher --fichier Pièces/contrat.pdf' })).toEqual({ kind: 'file', path: 'Pièces/contrat.pdf' });
    expect(autoPanelTarget('Bash', { command: 'scripts/pm conversion --force' })).toBeNull();
    expect(autoPanelTarget('Bash', { command: 'scripts/pm afficher --volet tampon' })).toEqual({ kind: 'tampon' });
    expect(autoPanelTarget('Bash', { command: 'scripts/pm afficher --fermer --volet chronologie' })).toBeNull();
    expect(autoPanelTarget('Bash', { command: ['/bin/zsh', '-lc', '.agents/skills/Skill-PieceMaker/scripts/pm tabular_review lister'] })).toEqual({ kind: 'tabular-review', review: null });
    expect(autoPanelTarget('Bash', { command: "/bin/zsh -lc '.agents/skills/Skill-PieceMaker/scripts/pm tabular_review lister'" })).toEqual({ kind: 'tabular-review', review: null });
    expect(autoPanelTarget('exec', { cmd: 'scripts/pm afficher --volet tampon' })).toEqual({ kind: 'tampon' });
  });

  it('ignore les autres outils', () => {
    expect(autoPanelTarget('Read', { file_path: 'acte.docx' })).toBeNull();
    expect(autoPanelTarget('mcp__piecemaker__conversion', {})).toBeNull();
  });
});

describe('panelShowDecision', () => {
  const empty = { panels: [], document: null, focus: {} };

  it('n’écrase pas une analyse tabulaire plus précise', () => {
    const open = {
      panels: ['plugin:piecemaker-tabular-review'],
      document: null,
      focus: { 'plugin:piecemaker-tabular-review': { file: '/dossier/Tabular Review/analyse.json' } },
    };
    expect(panelShowDecision({ kind: 'tabular-review', review: null }, open)).toBe('skip');
    expect(panelShowDecision({ kind: 'tabular-review', review: 'analyse.json' }, open)).toBe('skip');
    expect(panelShowDecision({ kind: 'tabular-review', review: 'autre.json' }, open)).toBe('apply');
    expect(panelShowDecision({ kind: 'tabular-review', review: null, draft: 'p-1' }, open)).toBe('apply');
    expect(panelShowDecision({ kind: 'tabular-review', review: null }, empty)).toBe('apply');
  });

  it('laisse un fichier déjà visible et ouvre un autre', () => {
    const open = { panels: ['files'], document: '/dossier/Actes/lettre.docx', focus: {} };
    expect(panelShowDecision({ kind: 'file', path: '/dossier/Actes/lettre.docx' }, open)).toBe('skip');
    expect(panelShowDecision({ kind: 'file', path: 'Actes/lettre.docx' }, open)).toBe('skip');
    expect(panelShowDecision({ kind: 'file', path: '/dossier/Actes/autre.docx' }, open)).toBe('apply');
  });
});
